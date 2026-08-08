import { describe, expect, it } from "vitest";
import type { BrandAssetBundle } from "@rs/contracts";
import { applyClientBrandKit, sniffImageMime } from "./brand-kit";

const baseBundle = (): BrandAssetBundle => ({
  schema_version: "assets/1",
  project_id: "proj",
  embed_budget_bytes: 1_500_000,
  assets: [
    {
      role: "logo",
      blob_path: "figures/logo.png",
      mime: "image/png",
      origin: "extraction_figure",
    },
    {
      role: "banner",
      blob_path: "figures/strip.png",
      mime: "image/png",
      origin: "extraction_figure_strip",
      background: "strip",
    },
  ],
});

describe("applyClientBrandKit", () => {
  it("prefers client SVG logo and full-bleed hero over extraction", () => {
    const merged = applyClientBrandKit(baseBundle(), {
      schema_version: "brand-kit/1",
      project_id: "proj",
      logo: {
        blob_path: "projects/proj/brand-kit/logo.svg",
        mime: "image/svg+xml",
        uploaded_at: "2026-08-08T00:00:00.000Z",
      },
      hero: {
        blob_path: "projects/proj/brand-kit/banner.jpg",
        mime: "image/jpeg",
        uploaded_at: "2026-08-08T00:00:00.000Z",
        kind: "photo",
      },
      updated_at: "2026-08-08T00:00:00.000Z",
    });
    const logo = merged.assets.find((a) => a.role === "logo");
    const banner = merged.assets.find((a) => a.role === "banner");
    expect(logo?.blob_path).toBe("projects/proj/brand-kit/logo.svg");
    expect(logo?.origin).toBe("client_upload_svg");
    expect(banner?.blob_path).toBe("projects/proj/brand-kit/banner.jpg");
    expect(banner?.origin).toBe("client_upload_photo");
    expect(banner?.background).toBe("photo");
  });

  it("keeps extraction fallbacks when client kit empty", () => {
    const merged = applyClientBrandKit(baseBundle(), {
      schema_version: "brand-kit/1",
      project_id: "proj",
      logo: null,
      hero: null,
      updated_at: "2026-08-08T00:00:00.000Z",
    });
    expect(merged.assets.find((a) => a.role === "logo")?.origin).toBe("extraction_figure");
    expect(merged.assets.find((a) => a.role === "banner")?.background).toBe("strip");
  });
});

describe("sniffImageMime", () => {
  it("detects SVG from filename and bytes", () => {
    expect(sniffImageMime(new Uint8Array(), "wordmark.svg", null)).toBe("image/svg+xml");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImageMime(svg, "upload.bin", "application/octet-stream")).toBe("image/svg+xml");
  });
});
