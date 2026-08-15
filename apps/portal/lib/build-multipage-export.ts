import { createHash, randomUUID } from "node:crypto";
import type { Blueprint, DesignDNA, ExtractionResult, SitePlan } from "@rs/contracts";
import { Blueprint as BlueprintSchema } from "@rs/contracts";
import { buildSitePlan, classifyDocShape, mapToDocModel } from "@rs/mapper";
import {
  applyDownloadArtifacts,
  auditCorporateReliability,
  buildDeliveryPackMeta,
  exportExcelFromDocModel,
  fontAssetBinaries,
  gateA,
  gateB,
  renderClientDeliveryReadme,
  renderSitePlan,
  looksLikeProjectSlug,
  inferDocKind,
  resolveDisplayPeriodLabel,
  resolveLegalCompanyName,
  themeIdFromDna,
  SOURCE_PDF_HREF,
  arithmeticAdvisory,
  htmlBundleSmoke,
  type BrandAssetUris,
  type GateAResult,
  type GateBResult,
  type ReliabilityFinding,
} from "@rs/render";
import { buildBlueprintV1 } from "./build-blueprint";

export interface BrandAssetBytes {
  logo?: { bytes: Uint8Array; mime: string };
  banner?: {
    bytes: Uint8Array;
    mime: string;
    /** Crop hint from BrandAssetBundle.background / origin. */
    kind?: "strip" | "photo" | "page";
  };
}

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
  /**
   * Real brand imagery from BrandAssetBundle / extraction figures.
   * Written under assets/brand/ — never invents logos when absent.
   */
  brandAssets?: BrandAssetBytes | null;
}

export interface MultipagePageMeta {
  path: string;
  title: string;
}

export interface MultipageExportResult {
  /** Text files (HTML/CSS/JS/JSON/markdown). */
  files: Record<string, string>;
  /** Binary artifacts (XLSX, PDF, fonts, brand). */
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
  /** P5/P6 corporate readiness rollup (vis_text, PE, brand, Gate A/B, delivery pack). */
  reliability: { ok: boolean; findings: ReliabilityFinding[] };
  excelSheetNames: string[];
  pdfBundled: boolean;
  brandLogo: boolean;
  brandBanner: boolean;
  /** Legal issuer used in chrome (may differ from portal project title). */
  company: string;
  companySource: string;
  /** Display period used in SEO/chrome/delivery meta. */
  periodLabel: string;
  /** IR chrome/layout preset applied to HTML (`data-theme`). */
  themeId: "classic" | "editorial" | "statutory";
  /** Doc-shape classifier label for operator gates / checklist. */
  docShape: string;
  arithmeticAdvisory: {
    checked: number;
    discrepancies: number;
    note: string;
  };
  htmlSmoke: {
    status: "pass" | "fail";
    dangling: number;
    external: number;
    note: string;
  };
}

function sha256Hex(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function extForMime(mime: string, fallback: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("png")) return "png";
  return fallback;
}

function materializeBrandAssets(
  brand: BrandAssetBytes | null | undefined,
  binaries: Record<string, Uint8Array>,
): BrandAssetUris {
  const uris: BrandAssetUris = {};
  if (brand?.logo?.bytes?.byteLength) {
    const mime = brand.logo.mime || "image/png";
    const ext = extForMime(mime, "png");
    const path = `assets/brand/logo.${ext}`;
    binaries[path] = brand.logo.bytes instanceof Uint8Array
      ? brand.logo.bytes
      : Uint8Array.from(brand.logo.bytes);
    uris.logo = path;
    uris.logoKind = mime.includes("svg") || ext === "svg" ? "svg" : "raster";
  }
  if (brand?.banner?.bytes?.byteLength) {
    const ext = extForMime(brand.banner.mime || "image/png", "png");
    const path = `assets/brand/banner.${ext}`;
    binaries[path] = brand.banner.bytes instanceof Uint8Array
      ? brand.banner.bytes
      : Uint8Array.from(brand.banner.bytes);
    uris.banner = path;
    uris.bannerKind = brand.banner.kind ?? "photo";
  }
  return uris;
}

/**
 * Deterministic WW-style multi-page site from DNA tokens + extraction/docmodel.
 * Numbers come only from extraction via the SitePlan renderer.
 * Gate A/B run on the rendered tree so operators sign off a provenance-safe draft.
 * P4: ExcelExporter + optional source PDF under assets/.
 * P6: README + _meta/export.json client delivery pack.
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

  // P1: never publish portal project slugs (e.g. "DRD Gold 1") in IR chrome.
  const legal = resolveLegalCompanyName({
    extraction: input.extraction,
    dna: input.dna,
    projectCompanyName: input.company,
  });
  if (legal.ignoredProjectSlug) {
    console.info(
      `[buildMultipageExport] using legal name “${legal.company}” (${legal.source}); ignored project slug “${legal.ignoredProjectSlug}”`,
    );
  }

  const coverTexts: string[] = [];
  const collectCover = (nodes: ExtractionResult["body"] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.text?.trim()) coverTexts.push(n.text);
      if (n.children?.length) collectCover(n.children);
    }
  };
  collectCover(input.extraction.body);
  collectCover(input.extraction.furniture);
  const docKind = inferDocKind(coverTexts, input.periodLabel);

  const meta = {
    company: legal.company,
    period_label: input.periodLabel,
    doc_kind: docKind,
    currency: "ZAR",
  };
  const docModel = mapToDocModel(input.extraction, meta);
  // P6: sync SEO/chrome/delivery period to cover-accurate label (not thin FY slug).
  const periodLabel =
    resolveDisplayPeriodLabel(docModel, input.extraction) || input.periodLabel || "";
  if (periodLabel) docModel.meta.period_label = periodLabel;
  docModel.meta.doc_kind = docKind;

  const sitePlan = buildSitePlan(docModel, blueprint);
  const docShape = classifyDocShape(docModel);

  const binaries: Record<string, Uint8Array> = {
    ...fontAssetBinaries(),
  };
  const brandUris = materializeBrandAssets(input.brandAssets, binaries);

  const themeId = themeIdFromDna(input.dna);
  const ctx = {
    extraction: input.extraction,
    docModel,
    brandAssets: brandUris,
    themeId,
  };
  const a = gateA(sitePlan, ctx);
  const { files } = renderSitePlan(sitePlan, blueprint, ctx);

  const excel = exportExcelFromDocModel(docModel);
  Object.assign(binaries, excel.files);

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

  const forbidden = [
    ...(legal.ignoredProjectSlug ? [legal.ignoredProjectSlug] : []),
    ...(looksLikeProjectSlug(input.company) && input.company.trim() !== legal.company
      ? [input.company.trim()]
      : []),
  ];

  // P6 handoff artifacts before reliability rollup (delivery-pack checks need them).
  const pathsPreview = [...Object.keys(files), ...Object.keys(binaries)].sort();
  const packMeta = buildDeliveryPackMeta({
    company: legal.company,
    companySource: legal.source,
    periodLabel,
    pages,
    paths: pathsPreview,
    excelSheetNames: excel.workbookSheetNames,
    pdfBundled,
    brandLogo: Boolean(brandUris.logo),
    brandBanner: Boolean(brandUris.banner),
    gateA: a.status,
    gateB: b.status,
    reliabilityOk: a.status === "pass" && b.status === "pass",
    prototypeBundled: Boolean(files["prototype/index.html"]),
  });
  files["README.md"] = renderClientDeliveryReadme(packMeta);
  files["_meta/export.json"] = JSON.stringify(packMeta, null, 2);

  const reliability = auditCorporateReliability(
    { files, binaries },
    {
      expectedLegalName: legal.company,
      forbiddenProjectTitles: forbidden.length ? forbidden : undefined,
      gateA: a,
      gateB: b,
      deliveryPack: true,
    },
  );

  // Refresh handoff with final reliability status (paths include README + meta).
  const paths = [...Object.keys(files), ...Object.keys(binaries)].sort();
  const finalMeta = buildDeliveryPackMeta({
    company: legal.company,
    companySource: legal.source,
    periodLabel,
    pages,
    paths,
    excelSheetNames: excel.workbookSheetNames,
    pdfBundled,
    brandLogo: Boolean(brandUris.logo),
    brandBanner: Boolean(brandUris.banner),
    gateA: a.status,
    gateB: b.status,
    reliabilityOk: reliability.ok,
    prototypeBundled: Boolean(files["prototype/index.html"]),
    createdAt: packMeta.created_at,
  });
  files["README.md"] = renderClientDeliveryReadme(finalMeta);
  files["_meta/export.json"] = JSON.stringify(finalMeta, null, 2);

  const arith = arithmeticAdvisory(docModel);
  const smoke = htmlBundleSmoke(files, Object.keys(binaries));
  files["_meta/qa-advisory.json"] = JSON.stringify(
    {
      schema_version: "qa-advisory/1",
      arithmetic_advisory: arith,
      html_smoke: smoke,
      not_yet_implemented: [
        "extraction_crosscheck (pdfium text-layer diff)",
        "Playwright viewport/axe (layout)",
      ],
    },
    null,
    2,
  );

  return {
    files,
    binaries,
    paths: [...Object.keys(files), ...Object.keys(binaries)].sort(),
    pages,
    sitePlan,
    sitePlanId: sitePlan.site_plan_id,
    blueprintVersionId,
    entrypoint: "index.html",
    mode: "multipage",
    gateA: a,
    gateB: b,
    reliability,
    excelSheetNames: excel.workbookSheetNames,
    pdfBundled,
    brandLogo: Boolean(brandUris.logo),
    brandBanner: Boolean(brandUris.banner),
    company: legal.company,
    companySource: legal.source,
    periodLabel,
    themeId,
    docShape,
    arithmeticAdvisory: {
      checked: arith.checked,
      discrepancies: arith.discrepancies,
      note: arith.note,
    },
    htmlSmoke: {
      status: smoke.status,
      dangling: smoke.dangling.length,
      external: smoke.external.length,
      note: smoke.note,
    },
  };
}
