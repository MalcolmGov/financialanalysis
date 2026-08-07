import { createHash, randomUUID } from "node:crypto";
import type { Blueprint, DesignDNA, ExtractionResult, SitePlan } from "@rs/contracts";
import { Blueprint as BlueprintSchema } from "@rs/contracts";
import { buildSitePlan, mapToDocModel } from "@rs/mapper";
import {
  applyDownloadArtifacts,
  exportExcelFromDocModel,
  gateA,
  gateB,
  renderSitePlan,
  SOURCE_PDF_HREF,
  type GateAResult,
  type GateBResult,
} from "@rs/render";
import { buildBlueprintV1 } from "./build-blueprint";

export interface MultipageExportInput {
  dna: DesignDNA;
  extraction: ExtractionResult;
  projectId: string;
  company: string;
  periodLabel: string;
  /** Optional Opus single-file HTML kept under prototype/index.html (preview only). */
  prototypeHtml?: string | null;
  sourcePrototypeVersionId?: string;
  sourcePrototypeSha256?: string;
  /**
   * Source PDF bytes to bundle at assets/source.pdf.
   * Offline JSON-only smokes may omit this — downloads page notes the skip.
   */
  sourcePdfBytes?: Uint8Array | Buffer | null;
}

export interface MultipagePageMeta {
  path: string;
  title: string;
}

export interface MultipageExportResult {
  /** Text files (HTML/CSS/JS/JSON). */
  files: Record<string, string>;
  /** Binary artifacts (XLSX, PDF) for the zip. */
  binaries: Record<string, Uint8Array>;
  paths: string[];
  pages: MultipagePageMeta[];
  sitePlan: SitePlan;
  sitePlanId: string;
  blueprintVersionId: string;
  entrypoint: string;
  mode: "multipage";
  gateA: GateAResult;
  gateB: GateBResult;
  excelSheetNames: string[];
  pdfBundled: boolean;
}

function sha256Hex(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Deterministic WW-style multi-page site from DNA tokens + extraction/docmodel.
 * Numbers come only from extraction via the SitePlan renderer.
 * Gate A/B run on the rendered tree so operators sign off a provenance-safe draft.
 * P4: ExcelExporter + optional source PDF under assets/.
 */
export function buildMultipageExport(input: MultipageExportInput): MultipageExportResult {
  const blueprintVersionId = randomUUID();
  const draft = buildBlueprintV1({
    dna: input.dna,
    blueprintVersionId,
    projectId: input.projectId,
    cycle: 1,
    sourcePrototypeVersionId: input.sourcePrototypeVersionId ?? "multipage-draft",
    sourcePrototypeSha256: input.sourcePrototypeSha256 ?? "0".repeat(64),
  });
  const checksum = sha256Hex(JSON.stringify(draft));
  const blueprint = BlueprintSchema.parse({ ...draft, checksum }) as Blueprint;

  const meta = {
    company: input.company,
    period_label: input.periodLabel,
    doc_kind: "interim_unaudited" as const,
    currency: "ZAR",
  };
  const docModel = mapToDocModel(input.extraction, meta);
  const sitePlan = buildSitePlan(docModel, blueprint);
  const ctx = { extraction: input.extraction, docModel };
  const a = gateA(sitePlan, ctx);
  const { files } = renderSitePlan(sitePlan, blueprint, ctx);

  const excel = exportExcelFromDocModel(docModel);
  const binaries: Record<string, Uint8Array> = { ...excel.files };

  let pdfBundled = false;
  if (input.sourcePdfBytes && input.sourcePdfBytes.byteLength > 0) {
    binaries[SOURCE_PDF_HREF] = Uint8Array.from(input.sourcePdfBytes);
    pdfBundled = true;
  }

  const enriched = applyDownloadArtifacts(files, sitePlan, docModel, {
    excel: {
      workbookHref: excel.workbookHref,
      statementFiles: excel.statementFiles,
      workbookSheetNames: excel.workbookSheetNames,
    },
    pdfBundled,
    pdfHref: SOURCE_PDF_HREF,
  });
  Object.assign(files, enriched);

  // Gate B after downloads/toolbar injection (sheet counts use data-allow-number).
  const b = gateB(files, ctx);

  if (input.prototypeHtml) {
    files["prototype/index.html"] = input.prototypeHtml;
  }

  // Prefer multi-page index; never overwrite a rendered multipage home with the
  // single-file prototype (prototype lives under prototype/ as optional preview).
  if (!files["index.html"] && input.prototypeHtml) {
    files["index.html"] = input.prototypeHtml;
  }

  const pages: MultipagePageMeta[] = sitePlan.pages
    .filter((p) => p.path.endsWith(".html"))
    .map((p) => ({ path: p.path, title: p.title }));

  const paths = [...Object.keys(files), ...Object.keys(binaries)].sort();
  return {
    files,
    binaries,
    paths,
    pages,
    sitePlan,
    sitePlanId: sitePlan.site_plan_id,
    blueprintVersionId,
    entrypoint: "index.html",
    mode: "multipage",
    gateA: a,
    gateB: b,
    excelSheetNames: excel.workbookSheetNames,
    pdfBundled,
  };
}
