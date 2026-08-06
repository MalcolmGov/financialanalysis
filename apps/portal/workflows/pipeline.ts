import { createHook, FatalError, getWritable } from "workflow";
import {
  ExtractionResultPointer,
  hookTokens,
  type ArtifactRef,
  type LockGateEvent,
  type PipelineInput,
  type ProgressEvent,
  type QaGateEvent,
  type ReviewGateEvent,
} from "@rs/contracts";
import {
  buildExport,
  detectDnaArtifact,
  extractBlueprint,
  generatePrototypeArtifact,
  lockBlueprint,
  mapContent,
  persistArtifactStub,
  persistExtractionResult,
  recordEvent,
  runQa,
  seedExtractionJob,
  setProjectStatus,
  unlockBlueprint,
} from "./steps";

/**
 * resultsPipeline — the SINGLE consolidated orchestrator for all nine steps.
 *
 * One durable run per project. Four human gates as hooks (dna, review, lock,
 * qa). The review→lock→qa loop carries a cycle counter: a QA change-request
 * UNLOCKS the blueprint and returns to review — it never kills the run. Only a
 * genuinely unrecoverable document (encrypted, corrupt) throws FatalError.
 *
 * Orchestration only — every side effect lives in a "use step" function.
 */
export async function resultsPipeline(input: PipelineInput) {
  "use workflow";

  const { project_id: projectId, run_id: runId } = input;

  // ── Steps 2–3: extraction, then design DNA ─────────────────────────────────
  await setProjectStatus(runId, projectId, "extracting");
  const extraction = await runExtraction(input);

  await setProjectStatus(runId, projectId, "dna_detecting");
  const dna = await detectDnaArtifact(runId, projectId, extraction);

  // Gate A — DNA card approval (owner corrects measured DNA before generation).
  await setProjectStatus(runId, projectId, "dna_review");
  using dnaHook = createHook<{ approve: boolean }>({
    token: hookTokens.dna(projectId, 1),
  });
  await emit(runId, "awaiting.dna");
  await dnaHook;

  // ── Step 4: first prototype ────────────────────────────────────────────────
  await setProjectStatus(runId, projectId, "prototype_generating");
  await generatePrototypeArtifact(runId, projectId, dna, extraction, 1);

  // ── Steps 5–8: the review → lock → QA cycle ────────────────────────────────
  let cycle = 1;
  while (true) {
    await setProjectStatus(runId, projectId, "in_review", cycle);
    let approvedPrototypeId: string | null = null;
    let lockedBlueprintId: string | null = null;

    using reviewHook = createHook<ReviewGateEvent>({
      token: hookTokens.review(projectId, cycle),
    });
    await emit(runId, "awaiting.review");

    for await (const evt of reviewHook) {
      if (evt.type === "refine") {
        await refinePrototype(runId, projectId, cycle, evt);
      } else if (evt.type === "approve") {
        await setProjectStatus(runId, projectId, "blueprint_extracting");
        const blueprint = await extractBlueprint(
          runId,
          projectId,
          cycle,
          evt.prototype_version_id,
        );

        await setProjectStatus(runId, projectId, "blueprint_proposed");
        using lockHook = createHook<LockGateEvent>({
          token: hookTokens.lock(projectId, cycle),
        });
        await emit(runId, "awaiting.lock");
        const decision = await lockHook;

        if (decision.type === "confirm_lock") {
          const blueprintVersionId = blueprint.meta.blueprintVersionId as string;
          await lockBlueprint(runId, projectId, blueprintVersionId, decision);
          approvedPrototypeId = evt.prototype_version_id;
          lockedBlueprintId = blueprintVersionId;
          break; // leave the review loop
        }
        await setProjectStatus(runId, projectId, "in_review", cycle); // lock rejected
      } else if (evt.type === "cancel") {
        await setProjectStatus(runId, projectId, "cancelled");
        return { status: "cancelled" as const };
      }
    }

    // ── Step 7: content mapping + blueprint-constrained composition ───────────
    await setProjectStatus(runId, projectId, "mapping");
    const sitePlan = await mapContent(runId, projectId, extraction, lockedBlueprintId!);

    // ── Step 8: QA + human sign-off ───────────────────────────────────────────
    await setProjectStatus(runId, projectId, "qa_running");
    await runQa(runId, projectId, extraction, lockedBlueprintId!, sitePlan);

    await setProjectStatus(runId, projectId, "qa_review");
    using qaHook = createHook<QaGateEvent>({ token: hookTokens.qa(projectId, cycle) });
    await emit(runId, "awaiting.qa");
    const qa = await qaHook;

    if (qa.type === "approve") {
      await setProjectStatus(runId, projectId, "exporting");
      const actorUserId =
        (qa as { actor?: { id?: string } }).actor?.id ?? qa.actor_user_id ?? "operator";
      const bundle = await buildExport(runId, projectId, {
        actorUserId,
        qaReportId: qa.qa_report_id,
      });
      await setProjectStatus(runId, projectId, "exported");
      await emit(runId, "run.completed");
      return { status: "exported" as const, bundle };
    }

    // change_request → unlock the blueprint, bump cycle, back to review.
    await unlockBlueprint(runId, projectId, cycle, lockedBlueprintId!, qa);
    cycle += 1;
  }
}

// ── Steps ─────────────────────────────────────────────────────────────────────
// Extraction, DNA, prototype, blueprint, mapping, QA and static export are real
// steps imported from ./steps. Chat-based refinement remains a typed stub.

async function emit(runId: string, type: ProgressEvent["type"], detail?: string) {
  "use step";
  const w = getWritable<ProgressEvent>().getWriter();
  try {
    await w.write({
      schema: "ProgressEvent@1",
      run_id: runId,
      ts: new Date().toISOString(),
      type,
      detail,
    });
  } finally {
    w.releaseLock();
  }
  await recordEvent(runId, type, { detail });
}

/**
 * Seed the worker job (step), park on a workflow-level hook for the webhook,
 * then persist the real extraction.json ArtifactRef (step). createHook must
 * live in the workflow body — not inside a step — so the run can suspend.
 */
async function runExtraction(input: PipelineInput): Promise<ArtifactRef> {
  const jobId = `ext_${input.run_id}`;
  await seedExtractionJob(input, jobId);

  using hook = createHook<{
    status: "succeeded" | "failed";
    result_pointer?: unknown;
  }>({
    token: hookTokens.extraction(jobId),
  });
  await emit(input.run_id, "awaiting.extraction");
  const result = await hook;
  if (result.status !== "succeeded") {
    throw new FatalError(`extraction ${jobId} failed`);
  }
  // Validate shape early so a bad webhook fails before we touch Blob/DB.
  ExtractionResultPointer.parse(result.result_pointer);
  return persistExtractionResult(
    input.run_id,
    input.project_id,
    jobId,
    result.result_pointer,
  );
}

async function refinePrototype(
  runId: string,
  projectId: string,
  cycle: number,
  evt: Extract<ReviewGateEvent, { type: "refine" }>,
): Promise<ArtifactRef> {
  "use step";
  return persistArtifactStub(runId, projectId, "prototype", {
    cycle,
    mode: evt.force_mode ?? "patch",
    prompt: evt.prompt,
    note: "refinement — TODO",
  });
}

// Guard against an unrecoverable document class (kept for symmetry; the
// extraction step throws FatalError on encrypted/corrupt PDFs).
export { FatalError };
