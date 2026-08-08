/**
 * Rebuild multipage site draft for a project from its latest DNA + extraction.
 * Shared by scripts/rebuild-site-draft.ts and operator brand-kit / site APIs.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { formatReliabilityFailures, resolveLegalCompanyName } from "@rs/render";
import { getPrivate, putPrivate } from "./blob";
import { loadBrandBytes, resolveAssetUris } from "./brand-assets";
import { buildMultipageExport, type BrandAssetBytes } from "./build-multipage-export";
import { db, schema } from "./db";

export type RebuildSiteDraftResult = {
  projectId: string;
  runId: string;
  draftVersion: number;
  draftId: string;
  prefix: string;
  entrypoint: string;
  pages: number;
  gateA: string;
  gateB: string;
  corporateReliability: "pass" | "fail";
  brandLogo: boolean;
  brandBanner: boolean;
  company: string;
};

export type RebuildSiteDraftOptions = {
  projectId: string;
  /** Persist note in draft manifest. */
  note?: string;
  /** When true (default), refuse to persist if Gate A/B or reliability fail. */
  hardFailGates?: boolean;
};

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
    refreshPick: true,
  });
  if (!bundle) return null;
  return loadBrandBytes(bundle, uris, getPrivate);
}

export class RebuildSiteDraftError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "RebuildSiteDraftError";
    this.status = status;
    this.details = details;
  }
}

/** Rebuild and persist the next site-draft version for a project. */
export async function rebuildProjectSiteDraft(
  opts: RebuildSiteDraftOptions,
): Promise<RebuildSiteDraftResult> {
  const projectId = opts.projectId;
  const hardFailGates = opts.hardFailGates !== false;
  const note =
    opts.note ?? "rebuilt via rebuildProjectSiteDraft (operator brand kit / site API)";

  const [project] = await db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) throw new RebuildSiteDraftError(`project not found: ${projectId}`, 404);

  const [run] = await db()
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) throw new RebuildSiteDraftError(`no pipeline run for ${projectId}`, 404);

  const arts = await db()
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.runId, run.id))
    .orderBy(desc(schema.artifacts.createdAt));

  const dnaRow = arts.find((a) => a.kind === "design_dna");
  const extRow = arts.find((a) => a.kind === "extraction_result");
  if (!dnaRow || !extRow) {
    throw new RebuildSiteDraftError(`missing dna/extraction on run ${run.id}`, 409);
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

  const brandAssets = await resolveBrand(arts, projectId, extraction);

  const legal = resolveLegalCompanyName({
    extraction,
    dna,
    projectCompanyName: project.companyName,
  });

  const built = buildMultipageExport({
    dna,
    extraction,
    projectId,
    company: project.companyName ?? extraction.source?.pdf_meta?.title ?? "Company",
    periodLabel: project.periodLabel ?? "",
    sourcePdfBytes,
    brandAssets,
  });

  const gateOk = built.gateA.status === "pass" && built.gateB.status === "pass";
  if (hardFailGates && (!gateOk || !built.reliability.ok)) {
    const findingLines = built.reliability.findings
      .filter((x) => !x.ok)
      .map((f) => `${f.code}${f.path ? ` [${f.path}]` : ""}: ${f.message}`);
    throw new RebuildSiteDraftError(
      "Corporate readiness gates failed — draft not persisted",
      422,
      {
        gateA: built.gateA.status,
        gateB: built.gateB.status,
        corporateReliability: built.reliability.ok ? "pass" : "fail",
        findings: findingLines,
        reliabilityText: formatReliabilityFailures(built.reliability.findings),
        company: legal.company,
      },
    );
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
          : path.endsWith(".md")
            ? "text/markdown; charset=utf-8"
            : "application/octet-stream";
    await putPrivate(`${prefix}/${path}`, body, contentType);
  }
  for (const path of Object.keys(built.binaries).sort()) {
    const body = built.binaries[path]!;
    const lower = path.toLowerCase();
    const contentType = lower.endsWith(".pdf")
      ? "application/pdf"
      : lower.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            ? "image/jpeg"
            : lower.endsWith(".webp")
              ? "image/webp"
              : lower.endsWith(".svg")
                ? "image/svg+xml"
                : lower.endsWith(".woff2")
                  ? "font/woff2"
                  : lower.endsWith(".woff")
                    ? "font/woff"
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
    project_id: projectId,
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
    note,
    corporate_reliability: built.reliability.ok ? "pass" : "fail",
    company: built.company,
    company_source: built.companySource,
    period_label: built.periodLabel,
    pdf_bundled: built.pdfBundled,
    brand_logo: built.brandLogo,
    brand_banner: built.brandBanner,
    delivery_pack: "client-delivery",
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
      corporateReliability: built.reliability.ok ? "pass" : "fail",
      fileCount: built.paths.length,
      company: built.company,
      brandLogo: built.brandLogo,
      brandBanner: built.brandBanner,
      rebuiltOffline: true,
      rebuiltVia: "rebuildProjectSiteDraft",
    },
  });

  await db()
    .update(schema.projects)
    .set({ status: "in_review", updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));

  return {
    projectId,
    runId: run.id,
    draftVersion,
    draftId,
    prefix,
    entrypoint: built.entrypoint,
    pages: built.pages.length,
    gateA: built.gateA.status,
    gateB: built.gateB.status,
    corporateReliability: built.reliability.ok ? "pass" : "fail",
    brandLogo: built.brandLogo,
    brandBanner: built.brandBanner,
    company: built.company,
  };
}
