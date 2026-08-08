import type { BrandAssetBundle, ExtractionResult, ProjectBrandKit } from "@rs/contracts";
import { applyClientBrandKit, loadProjectBrandKit } from "./brand-kit";

type ExtractionFigure = ExtractionResult["figures"][string];

const DEFAULT_EMBED_BUDGET = 1_500_000;
const EARLY_PAGES = 2;
/** Prefer cinematic IR strips (WW-style wide masthead crops). */
const BANNER_STRIP_ASPECT = 4.0;
const BANNER_ASPECT_MIN = 2.2;
const LOGO_ASPECT_MIN = 0.45;
const LOGO_ASPECT_MAX = 5.5;
/** Skip figures whose caption clearly names a chart/graph. */
const CHART_CAPTION = /\b(chart|graph|figure\s+\d|histogram|waterfall)\b/i;

export type AssetUris = {
  logo?: string;
  banner?: string;
};

export type BannerKind = "strip" | "photo" | "page";

type FigureCand = {
  id: string;
  figure: ExtractionFigure;
  page: number;
  aspect: number;
  area: number;
  top: number;
  pageArea: number;
  mime: string;
  classification: ExtractionFigure["classification"];
  isSvg: boolean;
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
    const mime = fig.image.mime || "image/png";
    out.push({
      id: fig.id,
      figure: fig,
      page,
      aspect: w / h,
      area: w * h,
      top: topY(fig),
      pageArea,
      mime,
      classification: fig.classification ?? null,
      isSvg: mime.includes("svg"),
    });
  }
  return out;
}

/** Prefer classified / SVG / compact early wordmarks over chart-like crops. */
function logoScore(c: FigureCand): number {
  let score = 0;
  if (c.classification === "logo") score += 1000;
  if (c.isSvg) score += 400;
  if (c.page === 1) score += 80;
  else if (c.page === 2) score += 40;
  // Wordmark-like wide logos score higher than square icons.
  if (c.aspect >= 2.0 && c.aspect <= 5.0) score += 120;
  else if (c.aspect >= 1.2 && c.aspect < 2.0) score += 60;
  // Prefer modest page coverage (logo lockup, not full-bleed art).
  const coverage = c.area / c.pageArea;
  if (coverage > 0 && coverage < 0.04) score += 90;
  else if (coverage < 0.1) score += 50;
  else if (coverage < 0.15) score += 20;
  // Prefer higher (earlier) on the page.
  score += Math.max(0, 40 - c.top * 0.05);
  // Prefer sharper mid-size wordmarks over tiny stamps.
  if (c.figure.image.width_px >= 200 && c.figure.image.width_px <= 900) score += 40;
  if (c.figure.image.height_px > 0 && c.figure.image.height_px <= 160) score += 30;
  return score;
}

function pickLogo(cands: FigureCand[]): FigureCand | null {
  const classified = cands.filter((c) => c.classification === "logo");
  const pool = (classified.length ? classified : cands).filter(
    (c) =>
      c.page <= EARLY_PAGES &&
      c.aspect >= LOGO_ASPECT_MIN &&
      c.aspect <= LOGO_ASPECT_MAX &&
      c.area / c.pageArea < 0.18,
  );
  if (!pool.length) return null;
  return pool.sort((a, b) => {
    const ds = logoScore(b) - logoScore(a);
    if (ds !== 0) return ds;
    if (a.page !== b.page) return a.page - b.page;
    if (a.top !== b.top) return a.top - b.top;
    return a.area - b.area;
  })[0]!;
}

function bannerScore(c: FigureCand): number {
  let score = 0;
  if (c.classification === "banner" || c.classification === "photo") score += 800;
  if (c.isSvg) score += 200;
  if (c.page === 1) score += 100;
  else if (c.page === 2) score += 40;
  // Ultra-wide cinematic strips beat squat photos for IR mastheads.
  if (c.aspect >= BANNER_STRIP_ASPECT) score += 300 + Math.min(200, c.aspect * 10);
  else if (c.aspect >= BANNER_ASPECT_MIN) score += 120;
  // Prefer wider absolute width (premium strip vs cropped icon).
  score += Math.min(120, c.figure.image.width_px / 12);
  // Prefer short height (true banner strip) over tall page fragments.
  if (c.figure.image.height_px > 0 && c.figure.image.height_px <= 220) score += 160;
  else if (c.figure.image.height_px <= 360) score += 60;
  score += Math.min(80, c.area / 8000);
  return score;
}

function pickBanner(cands: FigureCand[], logoId: string | null): FigureCand | null {
  const classified = cands.filter(
    (c) =>
      c.id !== logoId &&
      (c.classification === "banner" || c.classification === "photo"),
  );
  const wide = cands.filter(
    (c) => c.page <= EARLY_PAGES && c.aspect >= BANNER_ASPECT_MIN && c.id !== logoId,
  );
  const pool = classified.length ? classified : wide;
  if (!pool.length) return null;
  return pool.sort((a, b) => {
    const ds = bannerScore(b) - bannerScore(a);
    if (ds !== 0) return ds;
    if (a.page !== b.page) return a.page - b.page;
    return b.area - a.area;
  })[0]!;
}

export function bannerKindForAsset(opts: {
  origin?: string;
  aspect?: number;
}): BannerKind {
  if (opts.origin === "page_render") return "page";
  if (opts.origin === "extraction_figure_strip" || (opts.aspect != null && opts.aspect >= BANNER_STRIP_ASPECT)) {
    return "strip";
  }
  return "photo";
}

/**
 * Heuristic brand-asset picker from extraction figures.
 * Logo = compact early-page wordmark (SVG preferred); banner = cinematic
 * wide strip when present, else page-1 render. Never invents assets.
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
      mime: logo.mime,
      px: [logo.figure.image.width_px, logo.figure.image.height_px],
      origin: logo.isSvg ? "extraction_figure_svg" : "extraction_figure",
    });
  }

  if (bannerFig) {
    const kind = bannerKindForAsset({ aspect: bannerFig.aspect });
    assets.push({
      role: "banner",
      blob_path: bannerFig.figure.image.blob_path,
      mime: bannerFig.mime,
      px: [bannerFig.figure.image.width_px, bannerFig.figure.image.height_px],
      origin: kind === "strip" ? "extraction_figure_strip" : "extraction_figure",
      background: kind,
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
        background: "page",
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
  /** When true, always re-pick from extraction (improves strip/logo selection). */
  refreshPick?: boolean;
  /** Preloaded client brand kit; when omitted, loads from project brand-kit path. */
  clientKit?: ProjectBrandKit | null;
  /** Skip loading/merging client kit (tests / extraction-only smokes). */
  skipClientKit?: boolean;
}): Promise<{ bundle: BrandAssetBundle | null; uris: AssetUris }> {
  let bundle: BrandAssetBundle | null = null;
  if (
    !opts.refreshPick &&
    opts.bundleJson &&
    typeof opts.bundleJson === "object"
  ) {
    const b = opts.bundleJson as BrandAssetBundle;
    if (b.schema_version === "assets/1" && Array.isArray(b.assets)) bundle = b;
  }
  if (opts.refreshPick && opts.extractionJson && typeof opts.extractionJson === "object") {
    // Re-score figures so cinematic strips / SVG wordmarks win over stale picks.
    bundle = pickBrandAssets(opts.extractionJson as ExtractionResult, opts.projectId);
  } else if (!bundle && opts.extractionJson && typeof opts.extractionJson === "object") {
    bundle = pickBrandAssets(opts.extractionJson as ExtractionResult, opts.projectId);
  }

  let clientKit = opts.clientKit;
  if (clientKit === undefined && !opts.skipClientKit) {
    clientKit = await loadProjectBrandKit(opts.projectId);
  }
  if (bundle && clientKit) {
    bundle = applyClientBrandKit(bundle, clientKit);
  } else if (!bundle && clientKit?.logo?.blob_path) {
    // Client kit alone is enough for a minimal bundle (text fallbacks still apply).
    bundle = applyClientBrandKit(
      {
        schema_version: "assets/1",
        project_id: opts.projectId,
        assets: [],
        embed_budget_bytes: DEFAULT_EMBED_BUDGET,
      },
      clientKit,
    );
  }

  if (!bundle) return { bundle: null, uris: {} };
  return { bundle, uris: await loadAssetUris(bundle, opts.getPrivate) };
}

export type BrandBytes = {
  logo?: { bytes: Uint8Array; mime: string };
  banner?: {
    bytes: Uint8Array;
    mime: string;
    kind?: BannerKind;
  };
};

function kindFromAsset(asset: BrandAssetBundle["assets"][number]): BannerKind {
  if (
    asset.background === "strip" ||
    asset.background === "photo" ||
    asset.background === "page"
  ) {
    return asset.background;
  }
  return bannerKindForAsset({
    origin: asset.origin,
    aspect:
      asset.px && asset.px[1] > 0 ? asset.px[0] / asset.px[1] : undefined,
  });
}

/** Load logo/banner binary bytes (+ banner crop kind) for multipage export. */
export async function loadBrandBytes(
  bundle: BrandAssetBundle,
  uris: AssetUris,
  getPrivate: (path: string) => Promise<Buffer>,
): Promise<BrandBytes | null> {
  if (!uris.logo && !uris.banner) return null;
  const out: BrandBytes = {};
  for (const role of ["logo", "banner"] as const) {
    const asset = bundle.assets.find((a) => a.role === role);
    if (!asset?.blob_path || !uris[role]) continue;
    try {
      const bytes = await getPrivate(asset.blob_path);
      if (role === "banner") {
        out.banner = {
          bytes: new Uint8Array(bytes),
          mime: asset.mime || "image/png",
          kind: kindFromAsset(asset),
        };
      } else {
        out.logo = { bytes: new Uint8Array(bytes), mime: asset.mime || "image/png" };
      }
    } catch (err) {
      console.warn(`[brand-assets] ${role} bytes unavailable:`, err);
    }
  }
  return out.logo || out.banner ? out : null;
}
