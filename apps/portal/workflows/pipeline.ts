import { createHook, FatalError, getWritable } from "workflow";
import {
  ExtractionResultPointer,
  hookTokens,
  type ArtifactRef,
  type PipelineInput,
  type ProgressEvent,
  type ReviewGateEvent,
} from "@rs/contracts";
import { eq } from "drizzle-orm";
import {
  buildPrototypeExport,
  detectDnaArtifact,
  generatePrototypeArtifact,
  persistExtractionResult,
  recordEvent,
  refinePrototype,
  seedExtractionJob,
  setProjectStatus,
} from "./steps";

/**
 * resultsPipeline — prototype-as-product path.
 *
 * Upload → extract → DNA approve → generate prototype → refine* → approve &
 * export the signed-off HTML. Blueprint lock / mapping / QA remain in steps.ts
 * but are not on this operator path.
 */
export async function resultsPipeline(input: PipelineInput) {
  "use workflow";

  const { project_id: projectId, run_id: runId } = input;
  const cycle = await loadProjectCycle(projectId);

  await setProjectStatus(runId, projectId, "extracting");
  const extraction = await runExtraction(input);

  await setProjectStatus(runId, projectId, "dna_detecting");
  const dna = await detectDnaArtifact(runId, projectId, extraction);

  await setProjectStatus(runId, projectId, "dna_review");
  using dnaHook = createHook<{ approve: boolean }>({
    token: hookTokens.dna(projectId, cycle),
  });
  await emit(runId, "awaiting.dna");
  await dnaHook;

  await setProjectStatus(runId, projectId, "prototype_generating");
  await generatePrototypeArtifact(runId, projectId, dna, extraction, 1);

  await setProjectStatus(runId, projectId, "in_review", cycle);
  using reviewHook = createHook<ReviewGateEvent>({
    token: hookTokens.review(projectId, cycle),
  });
  await emit(runId, "awaiting.review");

  for await (const evt of reviewHook) {
    if (evt.type === "refine") {
      await refinePrototype(runId, projectId, cycle, evt);
      continue;
    }
    if (evt.type === "cancel") {
      await setProjectStatus(runId, projectId, "cancelled");
      return { status: "cancelled" as const };
    }
    if (evt.type === "approve") {
      await setProjectStatus(runId, projectId, "exporting");
      const actorUserId =
        (evt as { actor?: { id?: string } }).actor?.id ?? evt.actor_user_id ?? "operator";
      const bundle = await buildPrototypeExport(runId, projectId, evt.prototype_version_id, {
        actorUserId,
      });
      await setProjectStatus(runId, projectId, "exported");
      await emit(runId, "run.completed");
      return { status: "exported" as const, bundle };
    }
  }

  return { status: "cancelled" as const };
}

async function loadProjectCycle(projectId: string): Promise<number> {
  "use step";
  const { getDb, schema } = await import("../lib/db/workflow-db");
  const db = await getDb();
  const [row] = await db
    .select({ cycle: schema.projects.cycle })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return row?.cycle ?? 1;
}

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
    await setProjectStatus(input.run_id, input.project_id, "extraction_failed");
    await recordEvent(input.run_id, "extraction.failed", {
      jobId,
      status: result.status,
      result_pointer: result.result_pointer ?? null,
    });
    throw new FatalError(`extraction ${jobId} failed`);
  }
  ExtractionResultPointer.parse(result.result_pointer);
  return persistExtractionResult(
    input.run_id,
    input.project_id,
    jobId,
    result.result_pointer,
  );
}

export { FatalError };
