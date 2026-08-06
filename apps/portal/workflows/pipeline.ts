import { createHook, FatalError, getWritable } from "workflow";
import {
  hookTokens,
  type ArtifactRef,
  type LockGateEvent,
  type PipelineInput,
  type ProgressEvent,
  type QaGateEvent,
  type ReviewGateEvent,
} from "@rs/contracts";
import {
  detectDnaArtifact,
  generatePrototypeArtifact,
  persistArtifactStub,
  recordEvent,
  seedExtractionJob,
  setProjectStatus,
  waitForExtraction,
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
          await lockBlueprint(runId, projectId, blueprint.artifact_id, decision);
          approvedPrototypeId = evt.prototype_version_id;
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
    await mapContent(runId, projectId, approvedPrototypeId!);

    // ── Step 8: QA + human sign-off ───────────────────────────────────────────
    await setProjectStatus(runId, projectId, "qa_running");
    await runQa(runId, projectId);

    await setProjectStatus(runId, projectId, "qa_review");
    using qaHook = createHook<QaGateEvent>({ token: hookTokens.qa(projectId, cycle) });
    await emit(runId, "awaiting.qa");
    const qa = await qaHook;

    if (qa.type === "approve") {
      await setProjectStatus(runId, projectId, "exporting");
      const bundle = await buildExport(runId, projectId);
      await setProjectStatus(runId, projectId, "exported");
      await emit(runId, "run.completed");
      return { status: "exported" as const, bundle };
    }

    // change_request → unlock the blueprint, bump cycle, back to review.
    await unlockBlueprint(runId, projectId, cycle, qa);
    cycle += 1;
  }
}

// ── Steps ─────────────────────────────────────────────────────────────────────
// Extraction is real (submit + await webhook via hook, poll fallback). The
// creative steps are typed stubs that persist placeholder artifacts so the
// end-to-end control flow, gates and streaming are exercisable now; each is
// replaced by its subsystem in later phases.

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

async function runExtraction(input: PipelineInput): Promise<ArtifactRef> {
  "use step";
  const jobId = `ext_${input.run_id}`;
  await seedExtractionJob(input, jobId);
  // The worker fires a webhook to /api/hooks/extraction which resumeHooks
  // token extraction:{jobId}; waitForExtraction awaits it with a poll fallback.
  return waitForExtraction(input.run_id, input.project_id, jobId);
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

async function extractBlueprint(
  runId: string,
  projectId: string,
  cycle: number,
  prototypeVersionId: string,
): Promise<ArtifactRef> {
  "use step";
  return persistArtifactStub(runId, projectId, "blueprint", {
    cycle,
    source: prototypeVersionId,
    note: "blueprint extraction — TODO",
  });
}

async function lockBlueprint(
  runId: string,
  projectId: string,
  blueprintArtifactId: string,
  _decision: Extract<LockGateEvent, { type: "confirm_lock" }>,
): Promise<void> {
  "use step";
  await setProjectStatus(runId, projectId, "locked");
  await recordEvent(runId, "blueprint.locked", { blueprintArtifactId });
}

async function mapContent(runId: string, projectId: string, prototypeId: string): Promise<ArtifactRef> {
  "use step";
  return persistArtifactStub(runId, projectId, "site_plan", { prototypeId, note: "mapping — TODO" });
}

async function runQa(runId: string, projectId: string): Promise<ArtifactRef> {
  "use step";
  return persistArtifactStub(runId, projectId, "qa_report", { note: "QA gates — TODO" });
}

async function buildExport(runId: string, projectId: string): Promise<ArtifactRef> {
  "use step";
  return persistArtifactStub(runId, projectId, "export_bundle", { note: "static export — TODO" });
}

async function unlockBlueprint(
  runId: string,
  projectId: string,
  cycle: number,
  qa: Extract<QaGateEvent, { type: "change_request" }>,
): Promise<void> {
  "use step";
  await setProjectStatus(runId, projectId, "change_requested");
  await recordEvent(runId, "blueprint.unlocked", { cycle, reason: qa.reason, scope: qa.scope });
}

// Guard against an unrecoverable document class (kept for symmetry; the
// extraction step throws FatalError on encrypted/corrupt PDFs).
export { FatalError };
