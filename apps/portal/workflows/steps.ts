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

/**
 * Step 3 — design DNA. Real mode: probe (worker) + vision (opus-5) + reconcile.
 * MOCK mode: a stub artifact so the pipeline runs credential-free in dev.
 * Heavy AI/render deps are dynamic-imported so the WDK sandbox never analyses
 * them at the module level.
 */
export async function detectDnaArtifact(
  runId: string,
  projectId: string,
  extraction: ArtifactRef,
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] detecting design DNA`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "design_dna", { note: "MOCK DNA" });
  }
  const { getPrivate, signedSourceUrl, putPrivate } = await import("../lib/blob");
  const { detectDna } = await import("../lib/detect-dna");

  const extractionJson = JSON.parse((await getPrivate(extraction.blob_path)).toString("utf8"));
  const pageImages = await Promise.all(
    (extractionJson.pages ?? []).map((p: { image: { blob_path: string } }) => getPrivate(p.image.blob_path)),
  );
  const signed = await signedSourceUrl(extractionJson.source.blob_path);
  const { dna } = await detectDna({
    projectId,
    signedSourceUrl: signed,
    pageImages,
    pages: extractionJson.source.page_count ?? pageImages.length,
  });

  const artifactId = `art_design_dna_${runId}`;
  const path = `runs/${runId}/dna/${artifactId}.json`;
  const put = await putPrivate(path, JSON.stringify(dna), "application/json");
  await db().insert(schema.artifacts).values({
    runId, kind: "design_dna", version: dna.revision, blobPath: put.blob_path,
    sha256: put.sha256, bytes: put.bytes, contentType: "application/json", meta: { confidence: dna.confidence.overall },
  });
  return { schema: "ArtifactRef@1", artifact_id: artifactId, kind: "design_dna", version: dna.revision, blob_path: put.blob_path, sha256: put.sha256, bytes: put.bytes, content_type: "application/json", meta: { confidence: dna.confidence.overall } };
}

/**
 * Step 4 — prototype. Real mode: map extraction → content sample, run the studio
 * (opus-5), store both prototype forms + a prototype_versions row. MOCK: stub.
 */
export async function generatePrototypeArtifact(
  runId: string,
  projectId: string,
  dnaRef: ArtifactRef,
  extraction: ArtifactRef,
  version: number,
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] generating prototype v${version}`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "prototype", { version, note: "MOCK prototype" });
  }
  const { getPrivate, putPrivate } = await import("../lib/blob");
  const { runStudio } = await import("../lib/studio");
  const { buildContentSample } = await import("../lib/build-content");
  const { mapToDocModel } = await import("@rs/mapper");

  const dna = JSON.parse((await getPrivate(dnaRef.blob_path)).toString("utf8"));
  const extractionJson = JSON.parse((await getPrivate(extraction.blob_path)).toString("utf8"));

  const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const meta = {
    company: project?.companyName ?? extractionJson.source?.pdf_meta?.title ?? "Company",
    period_label: project?.periodLabel ?? "",
    doc_kind: "interim_unaudited" as const,
    currency: "ZAR",
  };
  const docModel = mapToDocModel(extractionJson, meta);
  const content = buildContentSample(docModel, extractionJson);

  const studio = await runStudio({ dna, content, brief: "Confident, understated, premium; mirror the printed report." });

  const base = `runs/${runId}/prototypes/v${version}`;
  const placeholder = await putPrivate(`${base}/placeholder.html`, studio.placeholderHtml, "text/html");
  const assembled = await putPrivate(`${base}/assembled.html`, studio.assembledHtml, "text/html");

  const versionId = `pv_${runId}_${version}`;
  await db().insert(schema.prototypeVersions).values({
    id: versionId, projectId, cycle: 1, versionNumber: version, parentVersionId: null,
    placeholderHtmlBlobKey: placeholder.blob_path, assembledHtmlBlobKey: assembled.blob_path,
    sha256: assembled.sha256, sizeBytes: assembled.bytes, refinementMode: "initial",
    model: "claude-opus-5", costUsdMicros: Math.round(studio.usage.cost_usd * 1e6), status: "ready",
  });
  await db().insert(schema.artifacts).values({
    runId, kind: "prototype", version, blobPath: assembled.blob_path, sha256: assembled.sha256,
    bytes: assembled.bytes, contentType: "text/html", meta: { versionId, placeholder: placeholder.blob_path },
  });
  return { schema: "ArtifactRef@1", artifact_id: versionId, kind: "prototype", version, blob_path: assembled.blob_path, sha256: assembled.sha256, bytes: assembled.bytes, content_type: "text/html", meta: { versionId } };
}

export const _limits = UPLOAD_LIMITS;
export { getRun };
