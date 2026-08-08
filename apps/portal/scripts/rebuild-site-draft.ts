/**
 * Rebuild multipage site draft for a project from its latest DNA + extraction.
 * Persists the same artifact shape as workflows/steps.buildSiteDraftArtifact.
 *
 * Usage:
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/rebuild-site-draft.ts [projectId]
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getPrivate, putPrivate } from "../lib/blob";
import { resolveLegalCompanyName } from "@rs/render";
import { loadBrandBytes, resolveAssetUris } from "../lib/brand-assets";
import { buildMultipageExport, type BrandAssetBytes } from "../lib/build-multipage-export";
import { db, schema } from "../lib/db";

const PROJECT_ID = process.argv[2] ?? "444cd443-97cc-4b9c-b0f6-eef4f65c2f98";

async function resolveBrand(
  arts: Array<{ kind: string; blobPath: string }>,
  projectId: string,
  extraction: unknown,
): Promise<BrandAssetBytes | null> {
  const brandRow = arts.find((a) => a.kind === "brand_assets");
  let bundleJson: unknown | null = null;
  if (brandRow) {
    try {
      bundleJson = JSON.parse((await getPrivate(brandRow.blobPath)).toString("utf8"));
    } catch (err) {
      console.warn("brand_assets artifact unreadable:", err);
    }
  }
  const { bundle, uris } = await resolveAssetUris({
    projectId,
    bundleJson,
    extractionJson: extraction,
    getPrivate,
    // Re-score figures so cinematic strips / wordmarks win over stale picks.
    refreshPick: true,
  });
  if (!bundle) return null;
  return loadBrandBytes(bundle, uris, getPrivate);
}

async function main() {
  const [project] = await db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, PROJECT_ID))
    .limit(1);
  if (!project) throw new Error(`project not found: ${PROJECT_ID}`);

  const [run] = await db()
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, PROJECT_ID))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) throw new Error(`no pipeline run for ${PROJECT_ID}`);

  const arts = await db()
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.runId, run.id))
    .orderBy(desc(schema.artifacts.createdAt));

  const dnaRow = arts.find((a) => a.kind === "design_dna");
  const extRow = arts.find((a) => a.kind === "extraction_result");
  if (!dnaRow || !extRow) {
    throw new Error(`missing dna/extraction on run ${run.id}`);
  }

  const dna = JSON.parse((await getPrivate(dnaRow.blobPath)).toString("utf8"));
  const extraction = JSON.parse((await getPrivate(extRow.blobPath)).toString("utf8"));

  let sourcePdfBytes: Buffer | null = null;
  if (project.currentDocumentId) {
    const [doc] = await db()
      .select({ blobPath: schema.documents.blobPath })
      .from(schema.documents)
      .where(eq(schema.documents.id, project.currentDocumentId))
      .limit(1);
    if (doc?.blobPath) {
      try {
        sourcePdfBytes = await getPrivate(doc.blobPath);
      } catch (err) {
        console.warn("source PDF unavailable:", err);
      }
    }
  }

  const brandAssets = await resolveBrand(arts, PROJECT_ID, extraction);

  const legal = resolveLegalCompanyName({
    extraction,
    dna,
    projectCompanyName: project.companyName,
  });
  console.log(
    `Legal company: “${legal.company}” (${legal.source})` +
      (legal.ignoredProjectSlug ? `; ignored project slug “${legal.ignoredProjectSlug}”` : ""),
  );

  const built = buildMultipageExport({
    dna,
    extraction,
    projectId: PROJECT_ID,
    company: project.companyName ?? extraction.source?.pdf_meta?.title ?? "Company",
    periodLabel: project.periodLabel ?? "",
    sourcePdfBytes,
    brandAssets,
  });
  if (built.company !== legal.company) {
    console.warn(`build company “${built.company}” ≠ pre-resolve “${legal.company}”`);
  }

  const existing = await db()
    .select({ version: schema.artifacts.version })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "site_plan")))
    .orderBy(desc(schema.artifacts.version))
    .limit(1);
  const draftVersion = (existing[0]?.version ?? 0) + 1;
  const prefix = `runs/${run.id}/site-draft/v${draftVersion}`;

  for (const path of Object.keys(built.files).sort()) {
    const body = built.files[path]!;
    const contentType = path.endsWith(".html")
      ? "text/html; charset=utf-8"
      : path.endsWith(".js")
        ? "application/javascript"
        : path.endsWith(".json")
          ? "application/json"
          : "application/octet-stream";
    await putPrivate(`${prefix}/${path}`, body, contentType);
  }
  for (const path of Object.keys(built.binaries).sort()) {
    const body = built.binaries[path]!;
    const contentType = path.endsWith(".pdf")
      ? "application/pdf"
      : path.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/octet-stream";
    await putPrivate(`${prefix}/${path}`, body, contentType);
  }

  const sitePlanPut = await putPrivate(
    `${prefix}/_meta/site-plan.json`,
    JSON.stringify(built.sitePlan),
    "application/json",
  );

  const draftId = randomUUID();
  const manifest = {
    schema_version: "site-draft/1",
    draft_id: draftId,
    project_id: PROJECT_ID,
    run_id: run.id,
    version: draftVersion,
    prefix,
    entrypoint: built.entrypoint,
    mode: built.mode,
    site_plan_id: built.sitePlanId,
    blueprint_version_id: built.blueprintVersionId,
    pages: built.pages,
    files: built.paths,
    gate_a: { status: built.gateA.status },
    gate_b: { status: built.gateB.status },
    created_at: new Date().toISOString(),
    note: "rebuilt via scripts/rebuild-site-draft.ts (WW polish tranche)",
  };
  const manifestPut = await putPrivate(
    `${prefix}/_meta/draft.json`,
    JSON.stringify(manifest, null, 2),
    "application/json",
  );

  await db().insert(schema.artifacts).values({
    runId: run.id,
    kind: "site_plan",
    version: draftVersion,
    blobPath: manifestPut.blob_path,
    sha256: manifestPut.sha256,
    bytes: manifestPut.bytes,
    contentType: "application/json",
    meta: {
      draftId,
      prefix,
      entrypoint: built.entrypoint,
      mode: "multipage",
      sitePlanId: built.sitePlanId,
      sitePlanBlobPath: sitePlanPut.blob_path,
      blueprintVersionId: built.blueprintVersionId,
      pages: built.pages,
      files: built.paths.filter((p) => p.endsWith(".html")),
      gateA: built.gateA.status,
      gateB: built.gateB.status,
      fileCount: built.paths.length,
      rebuiltOffline: true,
    },
  });

  await db()
    .update(schema.projects)
    .set({ status: "in_review", updatedAt: new Date() })
    .where(eq(schema.projects.id, PROJECT_ID));

  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        runId: run.id,
        draftVersion,
        prefix,
        pages: built.pages.length,
        gateA: built.gateA.status,
        gateB: built.gateB.status,
        excelSheets: built.excelSheetNames,
        pdfBundled: built.pdfBundled,
        brandLogo: built.brandLogo,
        brandBanner: built.brandBanner,
        entrypoint: built.entrypoint,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
