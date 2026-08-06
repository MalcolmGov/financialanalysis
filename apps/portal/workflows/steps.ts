import { getRun } from "workflow/api";
import { createHook } from "workflow";
import {
  hookTokens,
  UPLOAD_LIMITS,
  type ArtifactRef,
  type ExtractionJobSubmit,
  type PipelineInput,
  type ProjectStatus,
} from "@rs/contracts";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { env } from "../lib/env";
import { putPrivate, signedSourceUrl } from "../lib/blob";
import { submitExtraction } from "../lib/worker";

/**
 * Shared step helpers. All persist small facts; large bodies go to Blob and
 * only ArtifactRefs flow back into the workflow (keeps replay/streams cheap).
 * DB writes are skipped under MOCK_BLOB so the pipeline runs credential-free.
 */

export async function recordEvent(runId: string, type: string, payload: unknown) {
  console.log(`[run ${runId}] event ${type}`);
  if (env.MOCK_BLOB) return;
  await db().insert(schema.runEvents).values({ runId, type, payload: payload as object });
}

export async function setProjectStatus(
  runId: string,
  projectId: string,
  status: ProjectStatus,
  cycle?: number,
) {
  console.log(`[run ${runId}] status -> ${status}${cycle ? ` (cycle ${cycle})` : ""}`);
  if (env.MOCK_BLOB) return;
  await db()
    .update(schema.projects)
    .set({ status, ...(cycle ? { cycle } : {}), updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  await db()
    .update(schema.pipelineRuns)
    .set({ currentStep: status })
    .where(eq(schema.pipelineRuns.id, runId));
}

/** Placeholder artifact for a not-yet-built subsystem — a real ArtifactRef shape. */
export async function persistArtifactStub(
  runId: string,
  projectId: string,
  kind: ArtifactRef["kind"],
  meta: Record<string, unknown>,
): Promise<ArtifactRef> {
  const artifactId = `art_${kind}_${runId}_${Date.now()}`;
  const body = JSON.stringify({ stub: true, kind, ...meta });
  const path = `runs/${runId}/${kind}/${artifactId}.json`;
  const put = await putPrivate(path, body, "application/json");
  const ref: ArtifactRef = {
    schema: "ArtifactRef@1",
    artifact_id: artifactId,
    kind,
    version: 1,
    blob_path: put.blob_path,
    sha256: put.sha256,
    bytes: put.bytes,
    content_type: "application/json",
    meta,
  };
  if (!env.MOCK_BLOB) {
    await db().insert(schema.artifacts).values({
      runId,
      kind,
      version: 1,
      blobPath: put.blob_path,
      sha256: put.sha256,
      bytes: put.bytes,
      contentType: "application/json",
      meta,
    });
  }
  console.log(`[run ${runId}] artifact ${kind} ${artifactId}`);
  return ref;
}

/** Seed the shared extraction_jobs queue and hand the job to the worker. */
export async function seedExtractionJob(input: PipelineInput, jobId: string) {
  console.log(`[run ${input.run_id}] seeding extraction job ${jobId}`);
  if (env.MOCK_BLOB) return;

  const [doc] = await db()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, input.document_id));
  if (!doc) throw new Error(`document ${input.document_id} not found`);

  const submit: ExtractionJobSubmit = {
    schema_version: "1.0",
    job_id: jobId,
    org_id: input.org_id,
    project_id: input.project_id,
    source: {
      signed_url: await signedSourceUrl(doc.blobPath),
      blob_path: doc.blobPath,
      sha256: doc.sha256,
      size_bytes: doc.sizeBytes,
    },
    output_prefix: `runs/${input.run_id}/extraction/`,
    options: {
      ocr: "auto",
      ocr_langs: ["en"],
      table_mode: "accurate",
      images_scale: 2.0,
      page_range: null,
      document_timeout_s: 3600,
    },
    webhook: {
      url: `${env.APP_BASE_URL}/api/hooks/extraction`,
      hmac_key_id: "whk_1",
    },
  };

  // Idempotent on job_id — a retried step re-attaches rather than double-submits.
  await db()
    .insert(schema.extractionJobs)
    .values({
      jobId,
      orgId: input.org_id,
      projectId: input.project_id,
      submit,
      status: "queued",
    })
    .onConflictDoNothing();
  await submitExtraction(submit);
}

/**
 * Await extraction completion. The worker posts a webhook to
 * /api/hooks/extraction which resumeHooks token extraction:{jobId}. We block on
 * that hook; a durable poll fallback would sit alongside in production.
 */
export async function waitForExtraction(
  runId: string,
  projectId: string,
  jobId: string,
): Promise<ArtifactRef> {
  console.log(`[run ${runId}] awaiting extraction ${jobId}`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "extraction_result", {
      jobId,
      note: "MOCK extraction — worker not invoked",
    });
  }
  using hook = createHook<{ status: "succeeded" | "failed"; result_pointer?: unknown }>({
    token: hookTokens.extraction(jobId),
  });
  const result = await hook;
  if (result.status !== "succeeded") {
    throw new Error(`extraction ${jobId} failed`);
  }
  return persistArtifactStub(runId, projectId, "extraction_result", {
    jobId,
    result_pointer: result.result_pointer,
  });
}

export const _limits = UPLOAD_LIMITS;
export { getRun };
