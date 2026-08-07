import type { BrandAssetBundle, ExtractionFigure, ExtractionResult } from "@rs/contracts";

const DEFAULT_EMBED_BUDGET = 1_500_000;
const EARLY_PAGES = 2;
const BANNER_ASPECT_MIN = 2.2;
const LOGO_ASPECT_MIN = 0.4;
const LOGO_ASPECT_MAX = 4.0;
/** Skip figures whose caption clearly names a chart/graph. */
const CHART_CAPTION = /\b(chart|graph|figure\s+\d|histogram|waterfall)\b/i;

export type AssetUris = {
  logo?: string;
  banner?: string;
};

type FigureCand = {
  id: string;
  figure: ExtractionFigure;
  page: number;
  aspect: number;
  area: number;
  top: number;
  pageArea: number;
};

function pageNo(fig: ExtractionFigure): number {
  return fig.prov[0]?.page_no ?? 999;
}

function topY(fig: ExtractionFigure): number {
  return fig.prov[0]?.bbox?.t ?? 0;
}

function captionLooksLikeChart(fig: ExtractionFigure): boolean {
  return Boolean(fig.caption_block && CHART_CAPTION.test(fig.caption_block));
}

function candidates(extraction: ExtractionResult): FigureCand[] {
  const pageByNo = new Map(extraction.pages.map((p) => [p.page_no, p]));
  const out: FigureCand[] = [];
  for (const fig of Object.values(extraction.figures ?? {})) {
    if (!fig.image?.blob_path) continue;
    if (captionLooksLikeChart(fig)) continue;
    const page = pageNo(fig);
    const w = fig.image.width_px;
    const h = fig.image.height_px;
    if (!w || !h) continue;
    const pageInfo = pageByNo.get(page);
    const pageArea =
      pageInfo && pageInfo.image.width_px > 0 && pageInfo.image.height_px > 0
        ? pageInfo.image.width_px * pageInfo.image.height_px
        : w * h * 20;
    out.push({
      id: fig.id,
      figure: fig,
      page,
      aspect: w / h,
      area: w * h,
      top: topY(fig),
      pageArea,
    });
  }
  return out;
}

function pickLogo(cands: FigureCand[]): FigureCand | null {
  const early = cands
    .filter(
      (c) =>
        c.page <= EARLY_PAGES &&
        c.aspect >= LOGO_ASPECT_MIN &&
        c.aspect <= LOGO_ASPECT_MAX &&
        c.area / c.pageArea < 0.15,
    )
    .sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (a.top !== b.top) return a.top - b.top;
      return a.area - b.area;
    });
  return early[0] ?? null;
}

function pickBanner(cands: FigureCand[], logoId: string | null): FigureCand | null {
  const early = cands
    .filter((c) => c.page <= EARLY_PAGES && c.aspect >= BANNER_ASPECT_MIN && c.id !== logoId)
    .sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      return b.area - a.area;
    });
  return early[0] ?? null;
}

/**
 * Heuristic brand-asset picker from extraction figures.
 * Logo = compact early-page crop; banner = wide early figure, else page-1 render.
 */
export function pickBrandAssets(
  extraction: ExtractionResult,
  projectId: string,
  embedBudgetBytes = DEFAULT_EMBED_BUDGET,
): BrandAssetBundle {
  const cands = candidates(extraction);
  const logo = pickLogo(cands);
  const bannerFig = pickBanner(cands, logo?.id ?? null);

  const assets: BrandAssetBundle["assets"] = [];

  if (logo) {
    assets.push({
      role: "logo",
      blob_path: logo.figure.image.blob_path,
      mime: logo.figure.image.mime || "image/png",
      px: [logo.figure.image.width_px, logo.figure.image.height_px],
      origin: "extraction_figure",
    });
  }

  if (bannerFig) {
    assets.push({
      role: "banner",
      blob_path: bannerFig.figure.image.blob_path,
      mime: bannerFig.figure.image.mime || "image/png",
      px: [bannerFig.figure.image.width_px, bannerFig.figure.image.height_px],
      origin: "extraction_figure",
    });
  } else {
    const page1 = extraction.pages.find((p) => p.page_no === 1) ?? extraction.pages[0];
    if (page1?.image?.blob_path) {
      assets.push({
        role: "banner",
        blob_path: page1.image.blob_path,
        mime: "image/png",
        px: [page1.image.width_px, page1.image.height_px],
        origin: "page_render",
      });
    }
  }

  return {
    schema_version: "assets/1",
    project_id: projectId,
    assets,
    embed_budget_bytes: embedBudgetBytes,
  };
}

function toDataUri(mime: string, buf: Buffer): string {
  const safe = mime && mime.startsWith("image/") ? mime : "image/png";
  return `data:${safe};base64,${buf.toString("base64")}`;
}

/**
 * Load bundle blobs into data-URIs, respecting embed_budget_bytes (raw bytes).
 * Oversized assets are skipped (caller falls back to SVG stubs for missing roles).
 * No image codec deps — we skip rather than downscale when over budget.
 */
export async function loadAssetUris(
  bundle: BrandAssetBundle,
  getPrivate: (path: string) => Promise<Buffer>,
): Promise<AssetUris> {
  const budget = bundle.embed_budget_bytes > 0 ? bundle.embed_budget_bytes : DEFAULT_EMBED_BUDGET;
  const roles = ["logo", "banner"] as const;
  const byRole = new Map(bundle.assets.filter((a) => a.blob_path).map((a) => [a.role, a]));

  // Prefer logo first (small), then banner — drop banner if it blows the budget.
  let used = 0;
  const uris: AssetUris = {};

  for (const role of roles) {
    const asset = byRole.get(role);
    if (!asset?.blob_path) continue;
    try {
      const buf = await getPrivate(asset.blob_path);
      if (used + buf.byteLength > budget) {
        console.warn(
          `[brand-assets] skip ${role}: ${buf.byteLength}B would exceed budget ${budget} (used ${used})`,
        );
        continue;
      }
      used += buf.byteLength;
      uris[role] = toDataUri(asset.mime || "image/png", buf);
    } catch (err) {
      console.warn(`[brand-assets] failed to load ${role} ${asset.blob_path}:`, err);
    }
  }

  return uris;
}

/** Resolve uris from a persisted bundle, or re-pick from extraction when missing. */
export async function resolveAssetUris(opts: {
  projectId: string;
  bundleJson?: unknown | null;
  extractionJson?: unknown | null;
  getPrivate: (path: string) => Promise<Buffer>;
}): Promise<{ bundle: BrandAssetBundle | null; uris: AssetUris }> {
  let bundle: BrandAssetBundle | null = null;
  if (opts.bundleJson && typeof opts.bundleJson === "object") {
    const b = opts.bundleJson as BrandAssetBundle;
    if (b.schema_version === "assets/1" && Array.isArray(b.assets)) bundle = b;
  }
  if (!bundle && opts.extractionJson && typeof opts.extractionJson === "object") {
    bundle = pickBrandAssets(opts.extractionJson as ExtractionResult, opts.projectId);
  }
  if (!bundle) return { bundle: null, uris: {} };
  return { bundle, uris: await loadAssetUris(bundle, opts.getPrivate) };
}
