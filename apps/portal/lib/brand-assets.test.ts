import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@rs/contracts";
import { assembleAssets } from "./studio";
import { loadAssetUris, pickBrandAssets } from "./brand-assets";

function fig(
  id: string,
  opts: {
    page: number;
    w: number;
    h: number;
    t?: number;
    caption?: string | null;
  },
) {
  return {
    id,
    caption_block: opts.caption ?? null,
    prov: [{ page_no: opts.page, bbox: { l: 10, t: opts.t ?? 20, r: 10 + opts.w * 0.1, b: 20 + opts.h * 0.1 } }],
    image: {
      blob_path: `figures/${id}.png`,
      mime: "image/png",
      width_px: opts.w,
      height_px: opts.h,
    },
    classification: null,
  };
}

function extraction(partial: {
  figures: Record<string, ReturnType<typeof fig>>;
  pageW?: number;
  pageH?: number;
}): ExtractionResult {
  const pageW = partial.pageW ?? 1200;
  const pageH = partial.pageH ?? 1600;
  return {
    schema_version: "1.0",
    extraction_id: "ext_test",
    org_id: "org",
    project_id: "proj",
    source: {
      blob_path: "src.pdf",
      sha256: "a".repeat(64),
      size_bytes: 1,
      page_count: 2,
      pdf_meta: { title: "", producer: "", created: "", modified: "" },
    },
    engine: {
      docling_version: "0",
      backend: "test",
      table_mode: "accurate",
      ocr_applied: false,
      ocr_engine: null,
    },
    pages: [
      {
        page_no: 1,
        width_pt: 595,
        height_pt: 842,
        image: {
          blob_path: "pages/p001@2x.png",
          width_px: pageW,
          height_px: pageH,
          scale: 2,
          px_per_pt: 2,
        },
      },
    ],
    body: [],
    furniture: [],
    tables: {},
    figures: partial.figures as ExtractionResult["figures"],
    warnings: [],
    enrichment: { sections: [], key_figures: [], numeric_annotations: {} },
  } as ExtractionResult;
}

describe("pickBrandAssets", () => {
  it("picks compact early logo and wide banner figures", () => {
    const ex = extraction({
      figures: {
        logo: fig("logo", { page: 1, w: 180, h: 60, t: 10 }),
        banner: fig("banner", { page: 1, w: 1100, h: 220, t: 80 }),
        chart: fig("chart", { page: 1, w: 900, h: 400, caption: "Operating profit chart" }),
      },
    });
    const bundle = pickBrandAssets(ex, "proj");
    expect(bundle.schema_version).toBe("assets/1");
    const logo = bundle.assets.find((a) => a.role === "logo");
    const banner = bundle.assets.find((a) => a.role === "banner");
    expect(logo?.blob_path).toBe("figures/logo.png");
    expect(logo?.origin).toBe("extraction_figure");
    expect(banner?.blob_path).toBe("figures/banner.png");
    expect(banner?.origin).toBe("extraction_figure");
  });

  it("falls back to page-1 render when no wide banner figure", () => {
    const ex = extraction({
      figures: {
        logo: fig("logo", { page: 1, w: 160, h: 48, t: 8 }),
      },
    });
    const bundle = pickBrandAssets(ex, "proj");
    const banner = bundle.assets.find((a) => a.role === "banner");
    expect(banner?.blob_path).toBe("pages/p001@2x.png");
    expect(banner?.origin).toBe("page_render");
  });
});

describe("loadAssetUris + assembleAssets", () => {
  it("embeds real data-URIs and leaves stubs for missing roles", async () => {
    const logoBytes = Buffer.from("logo-bytes");
    const uris = await loadAssetUris(
      {
        schema_version: "assets/1",
        project_id: "proj",
        embed_budget_bytes: 1_500_000,
        assets: [{ role: "logo", blob_path: "figures/logo.png", mime: "image/png" }],
      },
      async (path) => {
        if (path === "figures/logo.png") return logoBytes;
        throw new Error(`missing ${path}`);
      },
    );
    expect(uris.logo).toMatch(/^data:image\/png;base64,/);
    expect(uris.banner).toBeUndefined();

    const html = assembleAssets(
      `<img src="{{ASSET:logo}}"><img src="{{ASSET:banner}}">`,
      uris,
    );
    expect(html).toContain(uris.logo!);
    expect(html).not.toContain("{{ASSET:");
    expect(html).toContain("data:image/svg+xml"); // banner stub
    expect(html).not.toContain("LOGO"); // logo is real bytes, not stub text — stub SVG has LOGO
    // Actually logo stub has LOGO text; real logo shouldn't. Banner stub doesn't have LOGO word in the gradient SVG... logo stub does.
    expect(Buffer.from(uris.logo!.split(",")[1], "base64").toString()).toBe("logo-bytes");
  });

  it("skips assets that exceed embed budget", async () => {
    const uris = await loadAssetUris(
      {
        schema_version: "assets/1",
        project_id: "proj",
        embed_budget_bytes: 10,
        assets: [
          { role: "logo", blob_path: "figures/logo.png", mime: "image/png" },
          { role: "banner", blob_path: "pages/big.png", mime: "image/png" },
        ],
      },
      async (path) => {
        if (path === "figures/logo.png") return Buffer.alloc(8);
        return Buffer.alloc(100);
      },
    );
    expect(uris.logo).toBeTruthy();
    expect(uris.banner).toBeUndefined();
  });
});
