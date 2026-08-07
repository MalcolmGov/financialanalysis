import {
  ExtractionResultPointer,
  UPLOAD_LIMITS,
  type ArtifactRef,
  type Blueprint,
  type ExtractionJobSubmit,
  type LockGateEvent,
  type PipelineInput,
  type ProjectStatus,
  type QaGateEvent,
  type ReviewGateEvent,
} from "@rs/contracts";
import { and, desc, eq } from "drizzle-orm";
import { env } from "../lib/env";
import { putPrivate, signedSourceUrl } from "../lib/blob";
import { submitExtraction } from "../lib/worker";
import type { RefinePatch } from "../lib/refine";

/**
 * Shared step helpers. All persist small facts; large bodies go to Blob and
 * only ArtifactRefs flow back into the workflow (keeps replay/streams cheap).
 * DB writes are skipped under MOCK_BLOB so the pipeline runs credential-free.
 *
 * The DB is loaded LAZILY (loadDb) from the workflow-safe accessor
 * (lib/db/workflow-db), whose `postgres` driver is dynamic-imported so no
 * node-dependent module is statically reachable from the Workflow build graph.
 * loadDb returns a `db()` thunk so the call sites below read identically to a
 * plain drizzle client. These bodies only run inside step executions (Node).
 */
async function loadDb() {
  const { getDb, schema } = await import("../lib/db/workflow-db");
  const instance = await getDb();
  return { db: () => instance, schema };
}

export async function recordEvent(runId: string, type: string, payload: unknown) {
  "use step";
  console.log(`[run ${runId}] event ${type}`);
  if (env.MOCK_BLOB) return;
  const { db, schema } = await loadDb();
  await db().insert(schema.runEvents).values({ runId, type, payload: payload as object });
}

export async function setProjectStatus(
  runId: string,
  projectId: string,
  status: ProjectStatus,
  cycle?: number,
) {
  "use step";
  console.log(`[run ${runId}] status -> ${status}${cycle ? ` (cycle ${cycle})` : ""}`);
  if (env.MOCK_BLOB) return;
  const { db, schema } = await loadDb();
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
    const { db, schema } = await loadDb();
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
  "use step";
  console.log(`[run ${input.run_id}] seeding extraction job ${jobId}`);
  if (env.MOCK_BLOB) return;
  const { db, schema } = await loadDb();

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
 * Persist the worker's extraction.json as a real ArtifactRef after the
 * workflow-level extraction hook resumes. The webhook delivers a
 * result_pointer; we adopt that blob path (same private store) rather than
 * stubbing a placeholder JSON that breaks DNA/map/QA.
 */
export async function persistExtractionResult(
  runId: string,
  projectId: string,
  jobId: string,
  resultPointer: unknown,
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] persisting extraction result for ${jobId}`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "extraction_result", {
      jobId,
      note: "MOCK extraction — worker not invoked",
    });
  }

  const pointer = ExtractionResultPointer.parse(resultPointer);
  const { getPrivate, sha256 } = await import("../lib/blob");
  const body = await getPrivate(pointer.extraction_json_path);
  const parsed = JSON.parse(body.toString("utf8")) as { stub?: boolean; pages?: unknown[] };
  if (parsed.stub || !Array.isArray(parsed.pages)) {
    throw new Error(
      `extraction ${jobId} at ${pointer.extraction_json_path} is not a valid ExtractionResult (missing pages)`,
    );
  }

  const digest = await sha256(body);
  const artifactId = `art_extraction_${jobId}`;
  const ref: ArtifactRef = {
    schema: "ArtifactRef@1",
    artifact_id: artifactId,
    kind: "extraction_result",
    version: 1,
    blob_path: pointer.extraction_json_path,
    sha256: digest,
    bytes: body.byteLength,
    content_type: "application/json",
    meta: { jobId, result_pointer: pointer, pages: pointer.stats.pages },
  };

  const { db, schema } = await loadDb();
  // Idempotent on step retry — unique (run_id, kind, version).
  await db()
    .insert(schema.artifacts)
    .values({
      runId,
      kind: "extraction_result",
      version: 1,
      blobPath: ref.blob_path,
      sha256: ref.sha256,
      bytes: ref.bytes,
      contentType: "application/json",
      meta: ref.meta,
    })
    .onConflictDoNothing();
  console.log(`[run ${runId}] artifact extraction_result ${artifactId} (${pointer.stats.pages} pages)`);
  return ref;
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
  const { db, schema } = await loadDb();

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
  const { assembleAssets, runStudio } = await import("../lib/studio");
  const { pickBrandAssets, loadAssetUris } = await import("../lib/brand-assets");
  const { buildContentSample, highlightsText } = await import("../lib/build-content");
  const { extractKpis } = await import("../lib/enrich-kpis");
  const { mapToDocModel } = await import("@rs/mapper");
  const { db, schema } = await loadDb();

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
  const kpis = await extractKpis(highlightsText(docModel));
  const content = buildContentSample(docModel, extractionJson, { kpis });

  const brandBundle = pickBrandAssets(extractionJson, projectId);
  const brandPath = `runs/${runId}/assets/brand_assets.json`;
  const brandPut = await putPrivate(brandPath, JSON.stringify(brandBundle), "application/json");
  await db()
    .insert(schema.artifacts)
    .values({
      runId,
      kind: "brand_assets",
      version: 1,
      blobPath: brandPut.blob_path,
      sha256: brandPut.sha256,
      bytes: brandPut.bytes,
      contentType: "application/json",
      meta: {
        roles: brandBundle.assets.map((a) => a.role),
        origins: brandBundle.assets.map((a) => a.origin ?? null),
      },
    })
    .onConflictDoNothing();
  console.log(
    `[run ${runId}] brand_assets roles=${brandBundle.assets.map((a) => `${a.role}:${a.origin ?? "?"}`).join(",") || "none"}`,
  );
  const assetUris = await loadAssetUris(brandBundle, getPrivate);

  const studio = await runStudio({ dna, content, brief: "Confident, understated, premium; mirror the printed report." });
  const assembledHtml = assembleAssets(studio.placeholderHtml, assetUris);

  // project_id + version_number is unique — after a re-run / start-over residue,
  // allocate the next free number instead of always inserting v1.
  const [maxRow] = await db()
    .select({ n: schema.prototypeVersions.versionNumber })
    .from(schema.prototypeVersions)
    .where(eq(schema.prototypeVersions.projectId, projectId))
    .orderBy(desc(schema.prototypeVersions.versionNumber))
    .limit(1);
  const versionNumber = Math.max(version, (maxRow?.n ?? 0) + 1);

  const base = `runs/${runId}/prototypes/v${versionNumber}`;
  const placeholder = await putPrivate(`${base}/placeholder.html`, studio.placeholderHtml, "text/html");
  const assembled = await putPrivate(`${base}/assembled.html`, assembledHtml, "text/html");

  // prototype_versions.id is a real Postgres uuid column — a human-readable
  // string like `pv_${runId}_${version}` would fail the insert outright.
  const { randomUUID } = await import("node:crypto");
  const versionId = randomUUID();
  await db().insert(schema.prototypeVersions).values({
    id: versionId, projectId, cycle: 1, versionNumber, parentVersionId: null,
    placeholderHtmlBlobKey: placeholder.blob_path, assembledHtmlBlobKey: assembled.blob_path,
    sha256: assembled.sha256, sizeBytes: assembled.bytes, refinementMode: "initial",
    model: "claude-opus-5", costUsdMicros: Math.round(studio.usage.cost_usd * 1e6), status: "ready",
  });
  await db().insert(schema.artifacts).values({
    runId, kind: "prototype", version: versionNumber, blobPath: assembled.blob_path, sha256: assembled.sha256,
    bytes: assembled.bytes, contentType: "text/html", meta: { versionId, placeholder: placeholder.blob_path },
  });
  return { schema: "ArtifactRef@1", artifact_id: versionId, kind: "prototype", version: versionNumber, blob_path: assembled.blob_path, sha256: assembled.sha256, bytes: assembled.bytes, content_type: "text/html", meta: { versionId } };
}

/**
 * Step 5 — prototype refinement. Patch-first (sonnet search/replace on the
 * placeholder form) with optional full regen. Enforces numeral invariant +
 * conformance lint. Failures persist a `failed` version and leave the review
 * hook open so the operator can retry.
 */
export async function refinePrototype(
  runId: string,
  projectId: string,
  cycle: number,
  evt: Extract<ReviewGateEvent, { type: "refine" }>,
): Promise<ArtifactRef> {
  "use step";
  const mode = evt.force_mode ?? "patch";
  console.log(`[run ${runId}] refining prototype (cycle ${cycle}, mode ${mode})`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "prototype", {
      cycle,
      mode,
      prompt: evt.prompt,
      note: "MOCK refinement",
    });
  }

  const { getPrivate, putPrivate } = await import("../lib/blob");
  const { assembleAssets, runStudio } = await import("../lib/studio");
  const { ensureContentCoverage } = await import("../lib/content-coverage");
  const { resolveAssetUris } = await import("../lib/brand-assets");
  const { MODELS, generateStructured } = await import("../lib/anthropic");
  const {
    PATCH_SCHEMA,
    REFINE_SYSTEM,
    applyPatches,
    assertNumeralsUnchanged,
    PatchApplyError,
    NumeralGuardError,
  } = await import("../lib/refine");
  const { conformanceLint } = await import("@rs/render");
  const { randomUUID } = await import("node:crypto");
  const { db, schema } = await loadDb();

  const [parent] = evt.base_version_id
    ? await db()
        .select()
        .from(schema.prototypeVersions)
        .where(eq(schema.prototypeVersions.id, evt.base_version_id))
        .limit(1)
    : await db()
        .select()
        .from(schema.prototypeVersions)
        .where(
          and(
            eq(schema.prototypeVersions.projectId, projectId),
            eq(schema.prototypeVersions.status, "ready"),
          ),
        )
        .orderBy(desc(schema.prototypeVersions.versionNumber))
        .limit(1);
  if (!parent) {
    throw new Error(
      evt.base_version_id
        ? `base prototype version ${evt.base_version_id} not found`
        : `no ready prototype to refine for project ${projectId}`,
    );
  }

  const [head] = await db()
    .select({ versionNumber: schema.prototypeVersions.versionNumber })
    .from(schema.prototypeVersions)
    .where(eq(schema.prototypeVersions.projectId, projectId))
    .orderBy(desc(schema.prototypeVersions.versionNumber))
    .limit(1);
  const nextVersion = (head?.versionNumber ?? parent.versionNumber) + 1;
  const versionId = randomUUID();

  const parentPlaceholder = (await getPrivate(parent.placeholderHtmlBlobKey)).toString("utf8");

  const runArtifacts = await db().select().from(schema.artifacts).where(eq(schema.artifacts.runId, runId));
  const dnaRow = runArtifacts.find((a) => a.kind === "design_dna");
  if (!dnaRow) throw new Error(`no design_dna artifact for run ${runId}`);
  const dna = JSON.parse((await getPrivate(dnaRow.blobPath)).toString("utf8"));

  const brandRow = [...runArtifacts].reverse().find((a) => a.kind === "brand_assets");
  const extractionRow = [...runArtifacts].reverse().find((a) => a.kind === "extraction_result");
  const brandJson = brandRow
    ? JSON.parse((await getPrivate(brandRow.blobPath)).toString("utf8"))
    : null;
  const extractionForAssets = extractionRow
    ? JSON.parse((await getPrivate(extractionRow.blobPath)).toString("utf8"))
    : null;
  const { uris: assetUris } = await resolveAssetUris({
    projectId,
    bundleJson: brandJson,
    extractionJson: extractionForAssets,
    getPrivate,
  });

  let placeholderHtml = parentPlaceholder;
  let patches: RefinePatch[] | null = null;
  let model: string = MODELS.refine;
  let costUsd = 0;
  let failure: string | null = null;
  let lintReport: { passed: boolean; errors: unknown[]; warnings: unknown[] } | null = null;

  try {
    if (mode === "regen") {
      if (!extractionRow) throw new Error(`no extraction_result for regen on run ${runId}`);
      const { buildContentSample, highlightsText } = await import("../lib/build-content");
      const { extractKpis } = await import("../lib/enrich-kpis");
      const { mapToDocModel } = await import("@rs/mapper");
      const extractionJson = extractionForAssets ?? JSON.parse((await getPrivate(extractionRow.blobPath)).toString("utf8"));
      const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
      const meta = {
        company: project?.companyName ?? extractionJson.source?.pdf_meta?.title ?? "Company",
        period_label: project?.periodLabel ?? "",
        doc_kind: "interim_unaudited" as const,
        currency: "ZAR",
      };
      const docModel = mapToDocModel(extractionJson, meta);
      const kpis = await extractKpis(highlightsText(docModel));
      const content = buildContentSample(docModel, extractionJson, { kpis });
      const studio = await runStudio({
        dna,
        content,
        brief: `Operator refinement (full regen): ${evt.prompt}`,
      });
      placeholderHtml = studio.placeholderHtml;
      model = MODELS.generate;
      costUsd = studio.usage.cost_usd;
    } else {
      const generatePatches = async (feedback?: string) => {
        const user = [
          `OPERATOR PROMPT:\n${evt.prompt}`,
          feedback ? `\nPREVIOUS APPLY FAILURE (fix and retry):\n${feedback}` : "",
          `\nCURRENT PLACEHOLDER HTML:\n${parentPlaceholder}`,
        ].join("\n");
        return generateStructured<{ patches: RefinePatch[] }>({
          model: MODELS.refine,
          system: REFINE_SYSTEM,
          messages: [{ role: "user", content: user }],
          schema: PATCH_SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 8000,
          effort: "medium",
        });
      };

      let lastErr: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, usage } = await generatePatches(lastErr ?? undefined);
        costUsd += usage.cost_usd;
        patches = data.patches ?? [];
        try {
          placeholderHtml = applyPatches(parentPlaceholder, patches);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (attempt === 1) throw new PatchApplyError(lastErr);
        }
      }
    }

    assertNumeralsUnchanged(parentPlaceholder, placeholderHtml);
    // Re-pack full document content and inject any tables/letter the model omitted.
    if (extractionForAssets) {
      const { buildContentSample, highlightsText } = await import("../lib/build-content");
      const { extractKpis } = await import("../lib/enrich-kpis");
      const { mapToDocModel } = await import("@rs/mapper");
      const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
      const meta = {
        company: project?.companyName ?? extractionForAssets.source?.pdf_meta?.title ?? "Company",
        period_label: project?.periodLabel ?? "",
        doc_kind: "interim_unaudited" as const,
        currency: "ZAR",
      };
      const docModel = mapToDocModel(extractionForAssets, meta);
      const kpis = await extractKpis(highlightsText(docModel));
      const fullContent = buildContentSample(docModel, extractionForAssets, { kpis });
      placeholderHtml = ensureContentCoverage(placeholderHtml, fullContent);
    }
    const assembledHtml = assembleAssets(placeholderHtml, assetUris);
    const lint = conformanceLint(assembledHtml, dna);
    lintReport = { passed: lint.passed, errors: lint.errors, warnings: lint.warnings };
    if (!lint.passed) {
      failure = `conformance lint failed (${lint.errors.length} errors)`;
    }
  } catch (err) {
    if (err instanceof NumeralGuardError || err instanceof PatchApplyError) {
      failure = err.message;
    } else {
      throw err;
    }
  }

  const status = failure ? "failed" : "ready";
  // Persist the attempt (including lint/numeral failures) for audit; only
  // `ready` versions are selectable as approve/refine heads.
  const finalPlaceholder = placeholderHtml;
  const assembledHtml = assembleAssets(finalPlaceholder, assetUris);

  const base = `runs/${runId}/prototypes/v${nextVersion}`;
  const placeholder = await putPrivate(`${base}/placeholder.html`, finalPlaceholder, "text/html");
  const assembled = await putPrivate(`${base}/assembled.html`, assembledHtml, "text/html");

  await db().insert(schema.prototypeVersions).values({
    id: versionId,
    projectId,
    cycle,
    versionNumber: nextVersion,
    parentVersionId: parent.id,
    placeholderHtmlBlobKey: placeholder.blob_path,
    assembledHtmlBlobKey: assembled.blob_path,
    sha256: assembled.sha256,
    sizeBytes: assembled.bytes,
    promptText: evt.prompt,
    refinementMode: mode === "regen" ? "regen" : "patch",
    patchJson: patches,
    lintReport,
    audit: failure ? { failure } : { numerals_unchanged: true },
    model,
    costUsdMicros: Math.round(costUsd * 1e6),
    status,
  });
  await db().insert(schema.artifacts).values({
    runId,
    kind: "prototype",
    version: nextVersion,
    blobPath: assembled.blob_path,
    sha256: assembled.sha256,
    bytes: assembled.bytes,
    contentType: "text/html",
    meta: {
      versionId,
      placeholder: placeholder.blob_path,
      parentVersionId: parent.id,
      mode,
      status,
      ...(failure ? { failure } : {}),
    },
  });
  await recordEvent(runId, failure ? "prototype.refine_failed" : "prototype.refined", {
    versionId,
    versionNumber: nextVersion,
    parentVersionId: parent.id,
    mode,
    prompt: evt.prompt,
    failure,
  });
  console.log(
    `[run ${runId}] refine v${nextVersion} status=${status}${failure ? ` (${failure})` : ""}`,
  );

  return {
    schema: "ArtifactRef@1",
    artifact_id: versionId,
    kind: "prototype",
    version: nextVersion,
    blob_path: assembled.blob_path,
    sha256: assembled.sha256,
    bytes: assembled.bytes,
    content_type: "text/html",
    meta: { versionId, status, ...(failure ? { failure } : {}) },
  };
}

/**
 * Step 6 — blueprint extraction. Real mode: build a DNA-derived Blueprint
 * (see ../lib/build-blueprint — a fixed, minimal component set, NOT parsed
 * from the prototype's arbitrary markup) and persist it as "proposed". MOCK:
 * stub.
 */
export async function extractBlueprint(
  runId: string,
  projectId: string,
  cycle: number,
  prototypeVersionId: string,
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] extracting blueprint v${cycle} from prototype ${prototypeVersionId}`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "blueprint", {
      cycle,
      source: prototypeVersionId,
      note: "MOCK blueprint",
    });
  }
  const { getPrivate, putPrivate, sha256 } = await import("../lib/blob");
  const { buildBlueprintV1 } = await import("../lib/build-blueprint");
  const { Blueprint: BlueprintSchema } = await import("@rs/contracts");
  const { randomUUID } = await import("node:crypto");
  const { db, schema } = await loadDb();

  const runArtifacts = await db().select().from(schema.artifacts).where(eq(schema.artifacts.runId, runId));
  const dnaRow = runArtifacts.find((a) => a.kind === "design_dna");
  if (!dnaRow) throw new Error(`no design_dna artifact for run ${runId}`);
  const dna = JSON.parse((await getPrivate(dnaRow.blobPath)).toString("utf8"));

  const [proto] = await db()
    .select()
    .from(schema.prototypeVersions)
    .where(eq(schema.prototypeVersions.id, prototypeVersionId));
  if (!proto) throw new Error(`prototype version ${prototypeVersionId} not found`);

  const blueprintVersionId = randomUUID();
  const draft = buildBlueprintV1({
    dna,
    blueprintVersionId,
    projectId,
    cycle,
    sourcePrototypeVersionId: prototypeVersionId,
    sourcePrototypeSha256: proto.sha256,
  });
  const checksum = await sha256(Buffer.from(JSON.stringify(draft)));
  const blueprint = BlueprintSchema.parse({ ...draft, checksum });

  const path = `runs/${runId}/blueprints/v${cycle}.json`;
  const put = await putPrivate(path, JSON.stringify(blueprint), "application/json");

  await db().insert(schema.blueprintVersions).values({
    id: blueprintVersionId,
    projectId,
    cycle,
    versionNumber: cycle,
    sourcePrototypeVersionId: prototypeVersionId,
    blueprintJson: blueprint,
    checksum,
    schemaVersion: "1.0",
    status: "proposed",
  });
  await db().insert(schema.artifacts).values({
    runId,
    kind: "blueprint",
    version: cycle,
    blobPath: put.blob_path,
    sha256: put.sha256,
    bytes: put.bytes,
    contentType: "application/json",
    meta: { blueprintVersionId },
  });

  return {
    schema: "ArtifactRef@1",
    artifact_id: blueprintVersionId,
    kind: "blueprint",
    version: cycle,
    blob_path: put.blob_path,
    sha256: put.sha256,
    bytes: put.bytes,
    content_type: "application/json",
    meta: { blueprintVersionId },
  };
}

/**
 * Lock the blueprint: flip it to "locked" (immutability trigger takes over
 * from here) and point the project at it. Previously a no-op beyond a status
 * log — steps 7/8 need a genuinely locked row to reference.
 */
export async function lockBlueprint(
  runId: string,
  projectId: string,
  blueprintVersionId: string,
  decision: Extract<LockGateEvent, { type: "confirm_lock" }>,
): Promise<void> {
  "use step";
  console.log(`[run ${runId}] locking blueprint ${blueprintVersionId}`);
  // Console sends actor_user_id: "operator"; resumeGate also attaches
  // actor.id (real users.id UUID). locked_by is a uuid column — never write
  // the placeholder string.
  const actorIdRaw =
    (decision as { actor?: { id?: string } }).actor?.id ?? decision.actor_user_id;
  const lockedBy =
    typeof actorIdRaw === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorIdRaw)
      ? actorIdRaw
      : null;

  if (!env.MOCK_BLOB) {
    const { db, schema } = await loadDb();
    await db()
      .update(schema.blueprintVersions)
      .set({ status: "locked", lockedAt: new Date(), lockedBy })
      .where(eq(schema.blueprintVersions.id, blueprintVersionId));
    await db()
      .update(schema.projects)
      .set({ currentBlueprintId: blueprintVersionId })
      .where(eq(schema.projects.id, projectId));
  }
  await setProjectStatus(runId, projectId, "locked");
  await recordEvent(runId, "blueprint.locked", { blueprintVersionId, lockedBy });
}

/**
 * Step 7 — content mapping + blueprint-constrained composition. Real mode:
 * map the extraction into a FinancialDocModel, compile it into a reference-
 * only SitePlan against the LOCKED blueprint (@rs/mapper). MOCK: stub.
 */
export async function mapContent(
  runId: string,
  projectId: string,
  extractionRef: ArtifactRef,
  blueprintVersionId: string,
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] mapping content into locked blueprint ${blueprintVersionId}`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "site_plan", { blueprintVersionId, note: "MOCK site plan" });
  }
  const { getPrivate, putPrivate } = await import("../lib/blob");
  const { mapToDocModel, buildSitePlan } = await import("@rs/mapper");
  const { db, schema } = await loadDb();

  const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const [bpRow] = await db()
    .select()
    .from(schema.blueprintVersions)
    .where(eq(schema.blueprintVersions.id, blueprintVersionId));
  if (!bpRow) throw new Error(`blueprint ${blueprintVersionId} not found`);
  if (bpRow.status !== "locked") {
    throw new Error(`blueprint ${blueprintVersionId} is not locked (status=${bpRow.status})`);
  }

  const extractionJson = JSON.parse((await getPrivate(extractionRef.blob_path)).toString("utf8"));
  const meta = {
    company: project?.companyName ?? extractionJson.source?.pdf_meta?.title ?? "Company",
    period_label: project?.periodLabel ?? "",
    doc_kind: "interim_unaudited" as const,
    currency: "ZAR",
  };
  const docModel = mapToDocModel(extractionJson, meta);
  const sitePlan = buildSitePlan(docModel, bpRow.blueprintJson as Blueprint);

  const path = `runs/${runId}/siteplans/${sitePlan.site_plan_id}.json`;
  const put = await putPrivate(path, JSON.stringify(sitePlan), "application/json");
  await db().insert(schema.artifacts).values({
    runId,
    kind: "site_plan",
    version: 1,
    blobPath: put.blob_path,
    sha256: put.sha256,
    bytes: put.bytes,
    contentType: "application/json",
    meta: { sitePlanId: sitePlan.site_plan_id, blueprintVersionId, docModelId: docModel.doc_model_id },
  });
  return {
    schema: "ArtifactRef@1",
    artifact_id: sitePlan.site_plan_id,
    kind: "site_plan",
    version: 1,
    blob_path: put.blob_path,
    sha256: put.sha256,
    bytes: put.bytes,
    content_type: "application/json",
    meta: { sitePlanId: sitePlan.site_plan_id, blueprintVersionId },
  };
}

/**
 * Step 8 — final QA. Real mode: render the SitePlan (@rs/render), run Gate A
 * (referential + coverage), Gate B (rendered-DOM number audit) and the
 * conformance linter, and persist an honest QA report. Deliberately does NOT
 * force-fit the full QAReport/NumberAuditReport contracts shapes, which also
 * require an extraction↔PDF cross-check, an arithmetic re-summing pass and a
 * Playwright smoke/axe suite — none of which exist yet. Fabricating a "pass"
 * for a check that never ran would defeat the point of an audit gate; the
 * report says plainly what wasn't checked. MOCK: stub.
 */
export async function runQa(
  runId: string,
  projectId: string,
  extractionRef: ArtifactRef,
  blueprintVersionId: string,
  sitePlanRef: ArtifactRef,
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] running QA gates for blueprint ${blueprintVersionId}`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "qa_report", { blueprintVersionId, note: "MOCK QA gates" });
  }
  const { getPrivate, putPrivate } = await import("../lib/blob");
  const { mapToDocModel } = await import("@rs/mapper");
  const { renderSitePlan, gateA, gateB, conformanceLint } = await import("@rs/render");
  const { db, schema } = await loadDb();

  const [bpRow] = await db()
    .select()
    .from(schema.blueprintVersions)
    .where(eq(schema.blueprintVersions.id, blueprintVersionId));
  if (!bpRow) throw new Error(`blueprint ${blueprintVersionId} not found`);
  const blueprint = bpRow.blueprintJson as Blueprint;

  const extractionJson = JSON.parse((await getPrivate(extractionRef.blob_path)).toString("utf8"));
  const sitePlan = JSON.parse((await getPrivate(sitePlanRef.blob_path)).toString("utf8"));
  const runArtifacts = await db().select().from(schema.artifacts).where(eq(schema.artifacts.runId, runId));
  const dnaRow = runArtifacts.find((a) => a.kind === "design_dna");
  const dna = dnaRow ? JSON.parse((await getPrivate(dnaRow.blobPath)).toString("utf8")) : null;

  const meta = { company: "", period_label: "", doc_kind: "interim_unaudited" as const, currency: "ZAR" };
  const docModel = mapToDocModel(extractionJson, meta);
  const ctx = { extraction: extractionJson, docModel };

  const a = gateA(sitePlan, ctx);
  const { files } = renderSitePlan(sitePlan, blueprint, ctx);
  const b = gateB(files, ctx);

  const lintErrors: { rule: string; detail: string; page: string }[] = [];
  if (dna) {
    for (const [page, html] of Object.entries(files)) {
      const lint = conformanceLint(html, dna);
      for (const e of lint.errors) lintErrors.push({ ...e, page });
    }
  }

  const verdict: "pass" | "fail" = a.status === "pass" && b.status === "pass" && lintErrors.length === 0 ? "pass" : "fail";
  const report = {
    schema_version: "results-studio-qa/1",
    generated_at: new Date().toISOString(),
    blueprint_version_id: blueprintVersionId,
    site_plan_id: sitePlan.site_plan_id,
    verdict,
    gate_a: a,
    gate_b: b,
    conformance_lint: { passed: lintErrors.length === 0, errors: lintErrors },
    not_yet_implemented: [
      "extraction_crosscheck (pdfium text-layer diff)",
      "arithmetic_advisory (statement re-summing)",
      "automated smoke/axe suite (Playwright)",
    ],
  };

  const path = `runs/${runId}/qa/${blueprintVersionId}.json`;
  const put = await putPrivate(path, JSON.stringify(report), "application/json");
  await db().insert(schema.artifacts).values({
    runId,
    kind: "qa_report",
    version: 1,
    blobPath: put.blob_path,
    sha256: put.sha256,
    bytes: put.bytes,
    contentType: "application/json",
    meta: { verdict, gateA: a.status, gateB: b.status, lintPassed: lintErrors.length === 0, blueprintVersionId },
  });
  console.log(
    `[run ${runId}] QA verdict=${verdict} gateA=${a.status} gateB=${b.status} lint=${lintErrors.length === 0 ? "pass" : "fail"}`,
  );
  return {
    schema: "ArtifactRef@1",
    artifact_id: `qa_${blueprintVersionId}`,
    kind: "qa_report",
    version: 1,
    blob_path: put.blob_path,
    sha256: put.sha256,
    bytes: put.bytes,
    content_type: "application/json",
    meta: { verdict, gateA: a.status, gateB: b.status, blueprintVersionId },
  };
}

/**
 * A QA change-request unlocks the blueprint (status -> "superseded", the
 * only transition the DB trigger permits on a locked row) so the next cycle
 * can lock a new one — without this, a second cycle's lock would violate the
 * one-locked-blueprint-per-project unique index.
 */
export async function unlockBlueprint(
  runId: string,
  projectId: string,
  cycle: number,
  blueprintVersionId: string,
  qa: Extract<QaGateEvent, { type: "change_request" }>,
): Promise<void> {
  "use step";
  console.log(`[run ${runId}] unlocking blueprint ${blueprintVersionId} (cycle ${cycle} -> ${cycle + 1})`);
  await setProjectStatus(runId, projectId, "change_requested");
  if (!env.MOCK_BLOB) {
    const { db, schema } = await loadDb();
    await db()
      .update(schema.blueprintVersions)
      .set({ status: "superseded" })
      .where(eq(schema.blueprintVersions.id, blueprintVersionId));
  }
  await recordEvent(runId, "blueprint.unlocked", { cycle, blueprintVersionId, reason: qa.reason, scope: qa.scope });
}

/**
 * Step 9 — static export. Re-render the locked SitePlan deterministically,
 * package HTML into a zip + ExportBundle manifest. Hard-requires a passing
 * Gate A/B/lint QA verdict (Playwright/crosscheck remain disclosed as unfinished
 * in the QA report, not silently marked pass).
 */
export async function buildExport(
  runId: string,
  projectId: string,
  signoff: { actorUserId: string; qaReportId: string },
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] building export bundle`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "export_bundle", {
      note: "MOCK export",
      ...signoff,
    });
  }

  const { getPrivate, putPrivate, sha256 } = await import("../lib/blob");
  const { mapToDocModel } = await import("@rs/mapper");
  const { renderSitePlan } = await import("@rs/render");
  const { ExportBundle } = await import("@rs/contracts");
  const { zipSync, strToU8 } = await import("fflate");
  const { randomUUID } = await import("node:crypto");
  const { db, schema } = await loadDb();

  const runArtifacts = await db().select().from(schema.artifacts).where(eq(schema.artifacts.runId, runId));
  const sitePlanRow = [...runArtifacts].reverse().find((a) => a.kind === "site_plan");
  const extractionRow = [...runArtifacts].reverse().find((a) => a.kind === "extraction_result");
  const qaRow = [...runArtifacts].reverse().find((a) => a.kind === "qa_report");
  if (!sitePlanRow || !extractionRow || !qaRow) {
    throw new Error(`export missing prerequisites (site_plan/extraction/qa) for run ${runId}`);
  }
  const qaMeta = qaRow.meta as { verdict?: string; blueprintVersionId?: string };
  if (qaMeta.verdict !== "pass") {
    throw new Error(`export blocked: QA verdict is ${qaMeta.verdict ?? "unknown"} (must be pass)`);
  }

  const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const blueprintVersionId =
    project?.currentBlueprintId ?? (qaMeta.blueprintVersionId as string | undefined);
  if (!blueprintVersionId) throw new Error(`no locked blueprint for project ${projectId}`);
  const [bpRow] = await db()
    .select()
    .from(schema.blueprintVersions)
    .where(eq(schema.blueprintVersions.id, blueprintVersionId));
  if (!bpRow || bpRow.status !== "locked") {
    throw new Error(`blueprint ${blueprintVersionId} is not locked`);
  }
  const blueprint = bpRow.blueprintJson as Blueprint;

  const extractionJson = JSON.parse((await getPrivate(extractionRow.blobPath)).toString("utf8"));
  const sitePlan = JSON.parse((await getPrivate(sitePlanRow.blobPath)).toString("utf8"));
  const qaReport = JSON.parse((await getPrivate(qaRow.blobPath)).toString("utf8"));
  const meta = {
    company: project?.companyName ?? extractionJson.source?.pdf_meta?.title ?? "Company",
    period_label: project?.periodLabel ?? "",
    doc_kind: "interim_unaudited" as const,
    currency: "ZAR",
  };
  const docModel = mapToDocModel(extractionJson, meta);
  const { files } = renderSitePlan(sitePlan, blueprint, { extraction: extractionJson, docModel });

  // Primary entry = the approved prototype microsite (what the operator signed
  // off in review). Mapped statements remain under statements/ as the verified
  // number-integrity pages. Without this, export was only unstyled tables.
  const [proto] = await db()
    .select()
    .from(schema.prototypeVersions)
    .where(
      and(
        eq(schema.prototypeVersions.projectId, projectId),
        eq(schema.prototypeVersions.status, "ready"),
      ),
    )
    .orderBy(desc(schema.prototypeVersions.versionNumber))
    .limit(1);
  if (proto?.assembledHtmlBlobKey) {
    const prototypeHtml = (await getPrivate(proto.assembledHtmlBlobKey)).toString("utf8");
    files["index.html"] = prototypeHtml;
    if (files["statements/index.html"]) {
      // Soft link from the statements page back to the designed cover.
      files["statements/index.html"] = files["statements/index.html"].replace(
        "<body>",
        `<body><p style="font:13px/1.4 var(--dna-font-body,system-ui);margin:0 0 16px"><a href="../index.html" style="color:var(--dna-brand,#0a6)">← ${meta.company.replace(/[<>&"]/g, "")} interactive results</a> · verified statements</p>`,
      );
    }
  } else if (!files["index.html"]) {
    const target = files["statements/index.html"]
      ? "statements/index.html"
      : Object.keys(files).find((p) => p.endsWith(".html")) ?? "statements/index.html";
    files["index.html"] = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="refresh" content="0; url=${target}"/>
  <title>${meta.company} — Results</title>
</head>
<body>
  <p><a href="${target}">Open interactive results</a></p>
</body>
</html>
`;
  }

  const fileEntries: { path: string; bytes: number; sha256: string; content_type: string }[] = [];
  const zipInput: Record<string, Uint8Array> = {};
  const hashParts: string[] = [];
  for (const path of Object.keys(files).sort()) {
    const body = files[path]!;
    const digest = await sha256(Buffer.from(body, "utf8"));
    fileEntries.push({
      path,
      bytes: Buffer.byteLength(body, "utf8"),
      sha256: digest,
      content_type: "text/html; charset=utf-8",
    });
    zipInput[path] = strToU8(body);
    hashParts.push(`${path}:${digest}`);
  }

  const docModelHash = await sha256(Buffer.from(JSON.stringify(docModel)));
  const renderHash = await sha256(Buffer.from(hashParts.join("\n")));
  const bundleId = `exp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const qaReportId = signoff.qaReportId || `qa_${blueprintVersionId}`;

  const bundleDraft = {
    schema_version: "export/1" as const,
    bundle_id: bundleId,
    project_id: projectId,
    created_at: new Date().toISOString(),
    inputs: {
      doc_model_hash: docModelHash,
      site_plan_id: sitePlan.site_plan_id,
      blueprint_version_id: blueprintVersionId,
      blueprint_checksum: bpRow.checksum,
      render_hash: renderHash,
    },
    integrity: {
      number_audit_id: `gateb_${blueprintVersionId}`,
      qa_report_id: qaReportId,
      verdict: "pass" as const,
      human_signoff_by: signoff.actorUserId,
    },
    entrypoints: { index: "index.html" },
    layout: Object.keys(files).length > 1 ? ("multiPage" as const) : ("singleFile" as const),
    files: fileEntries,
    external_requests: 0 as const,
    hosting: { requires_server: false as const, relative_links: true as const },
    zip: { blob_path: "", sha256: "0".repeat(64), bytes: 0 },
  };

  zipInput["_meta/export-bundle.json"] = strToU8(JSON.stringify(bundleDraft, null, 2));
  zipInput["_meta/qa-report.json"] = strToU8(JSON.stringify(qaReport, null, 2));

  const zipBytes = zipSync(zipInput, { level: 6 });
  const zipBuf = Buffer.from(zipBytes);
  const zipDigest = await sha256(zipBuf);
  const zipPath = `runs/${runId}/exports/${bundleId}.zip`;
  const zipPut = await putPrivate(zipPath, zipBuf, "application/zip");

  const bundle = ExportBundle.parse({
    ...bundleDraft,
    zip: { blob_path: zipPut.blob_path, sha256: zipDigest, bytes: zipBuf.byteLength },
  });

  const manifestPath = `runs/${runId}/exports/${bundleId}.json`;
  const manifestPut = await putPrivate(manifestPath, JSON.stringify(bundle), "application/json");
  await db().insert(schema.artifacts).values({
    runId,
    kind: "export_bundle",
    version: 1,
    blobPath: manifestPut.blob_path,
    sha256: manifestPut.sha256,
    bytes: manifestPut.bytes,
    contentType: "application/json",
    meta: {
      bundleId,
      zipPath: zipPut.blob_path,
      zipBytes: zipBuf.byteLength,
      entrypoint: "index.html",
      fileCount: fileEntries.length,
    },
  });
  console.log(`[run ${runId}] export ${bundleId} zip=${zipPut.blob_path} files=${fileEntries.length}`);
  return {
    schema: "ArtifactRef@1",
    artifact_id: bundleId,
    kind: "export_bundle",
    version: 1,
    blob_path: manifestPut.blob_path,
    sha256: manifestPut.sha256,
    bytes: manifestPut.bytes,
    content_type: "application/json",
    meta: { bundleId, zipPath: zipPut.blob_path },
  };
}

/**
 * Prototype-as-product export: zip the approved assembled HTML. No blueprint,
 * site plan, or QA prerequisites — the signed-off prototype IS the microsite.
 */
export async function buildPrototypeExport(
  runId: string,
  projectId: string,
  prototypeVersionId: string | null | undefined,
  signoff: { actorUserId: string },
): Promise<ArtifactRef> {
  "use step";
  console.log(`[run ${runId}] building prototype export`);
  if (env.MOCK_BLOB) {
    return persistArtifactStub(runId, projectId, "export_bundle", {
      note: "MOCK prototype export",
      ...signoff,
    });
  }

  const { getPrivate, putPrivate, sha256 } = await import("../lib/blob");
  const { zipSync, strToU8 } = await import("fflate");
  const { randomUUID } = await import("node:crypto");
  const { db, schema } = await loadDb();

  const [proto] = prototypeVersionId
    ? await db()
        .select()
        .from(schema.prototypeVersions)
        .where(eq(schema.prototypeVersions.id, prototypeVersionId))
        .limit(1)
    : await db()
        .select()
        .from(schema.prototypeVersions)
        .where(
          and(
            eq(schema.prototypeVersions.projectId, projectId),
            eq(schema.prototypeVersions.status, "ready"),
          ),
        )
        .orderBy(desc(schema.prototypeVersions.versionNumber))
        .limit(1);

  if (!proto?.assembledHtmlBlobKey) {
    throw new Error(`no ready prototype to export for project ${projectId}`);
  }

  const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const html = (await getPrivate(proto.assembledHtmlBlobKey)).toString("utf8");
  const bundleId = `exp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const meta = {
    schema_version: "prototype-export/1",
    bundle_id: bundleId,
    project_id: projectId,
    run_id: runId,
    company: project?.companyName ?? "Company",
    period_label: project?.periodLabel ?? "",
    prototype_version_id: proto.id,
    prototype_version_number: proto.versionNumber,
    refinement_mode: proto.refinementMode,
    created_at: new Date().toISOString(),
    signed_off_by: signoff.actorUserId,
    entrypoint: "index.html",
  };

  const zipInput: Record<string, Uint8Array> = {
    "index.html": strToU8(html),
    "_meta/export.json": strToU8(JSON.stringify(meta, null, 2)),
  };
  const zipBytes = zipSync(zipInput, { level: 6 });
  const zipBuf = Buffer.from(zipBytes);
  const zipDigest = await sha256(zipBuf);
  const zipPath = `runs/${runId}/exports/${bundleId}.zip`;
  const zipPut = await putPrivate(zipPath, zipBuf, "application/zip");

  const manifestPath = `runs/${runId}/exports/${bundleId}.json`;
  const manifestBody = JSON.stringify({ ...meta, zip: { blob_path: zipPut.blob_path, sha256: zipDigest, bytes: zipBuf.byteLength } });
  const manifestPut = await putPrivate(manifestPath, manifestBody, "application/json");

  await db().insert(schema.artifacts).values({
    runId,
    kind: "export_bundle",
    version: 1,
    blobPath: manifestPut.blob_path,
    sha256: manifestPut.sha256,
    bytes: manifestPut.bytes,
    contentType: "application/json",
    meta: {
      bundleId,
      zipPath: zipPut.blob_path,
      zipBytes: zipBuf.byteLength,
      entrypoint: "index.html",
      mode: "prototype",
      prototypeVersionId: proto.id,
      fileCount: 1,
    },
  });

  console.log(
    `[run ${runId}] prototype export ${bundleId} v${proto.versionNumber} zip=${zipPut.blob_path}`,
  );
  return {
    schema: "ArtifactRef@1",
    artifact_id: bundleId,
    kind: "export_bundle",
    version: 1,
    blob_path: manifestPut.blob_path,
    sha256: manifestPut.sha256,
    bytes: manifestPut.bytes,
    content_type: "application/json",
    meta: { bundleId, zipPath: zipPut.blob_path, mode: "prototype" },
  };
}

export const _limits = UPLOAD_LIMITS;
