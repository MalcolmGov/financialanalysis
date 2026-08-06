import { describe, expect, it } from "vitest";
import type { DesignDNA } from "@rs/contracts";
import { reconcileDna } from "./reconcile";
import type { VisionDNA } from "./vision";

/** Probe-half DNA: measured hexes, no roles (as the worker /probe emits). */
function probeDna(measured: string[]): DesignDNA {
  return {
    schema_version: "dna/1",
    dna_id: "d",
    project_id: "p",
    revision: 1,
    source_pdf: { sha256: "0".repeat(64), pages: 10 },
    confidence: { overall: 0.6, flags: [] },
    palette: { roles: {}, measured: measured.map((h) => ({ hex: h, provenance: "probe", confidence: 0.9 })), imagery: [] },
    type: {
      faces: [],
      stack: { heading: "'Open Sans', sans-serif", body: "'Open Sans', sans-serif" },
      scale: { observed_pt: [], web_base_px: 16, ratio: 1.25 },
      heading_treatment: { color: "accent", case: "sentence", weight: 700 },
    },
    spacing: { rhythm_px: [], page_margins_pt: [], columns: {} },
    table_style: { header_bg: "table-header-bg", header_text: "table-header-text", header_case: "sentence", rules: {}, zebra: false, period_shading: null, numeric_alignment: "right", negative_format: "parentheses", thousands_separator: "thin-space", decimal_places: "as-source" },
    components: [], motifs: [], tone_words: [],
    theme: { mode: "single-light", rationale: "" },
    human_edits: [],
  };
}

const vision: VisionDNA = {
  // vision reads the gold slightly off (#F5A623) — must snap to the measured #FCAF17
  palette_roles: [
    { role: "paper", hex: "#FFFFFF" },
    { role: "ink", hex: "#231F20" },
    { role: "brand", hex: "#F5A623" },
    { role: "table-header-bg", hex: "#8C9096" },
    { role: "foliage", hex: "#4C7A2A" }, // no probe color close → stays vision, flagged
  ],
  motifs: [{ id: "banner", kind: "photography", notes: "gold-dust + seedling" }],
  tone_words: ["earthy", "premium"],
  theme_mode: "single-light",
  table_treatment: "dark header, grey shading",
  heading_color_role: "accent",
};

describe("reconcileDna", () => {
  it("snaps a vision-read role to the nearest measured probe hex (adopts the exact value)", async () => {
    const dna = await reconcileDna(probeDna(["#FCAF17", "#231F20", "#FFFFFF", "#929292"]), vision);
    // brand read as #F5A623 → snapped to measured #FCAF17
    expect(dna.palette.roles.brand.hex).toBe("#FCAF17");
    expect(dna.palette.roles.brand.provenance).toBe("probe+vision");
    expect(dna.palette.roles.brand.confidence).toBeGreaterThan(0.9);
    // table-header read #8C9096 → snapped to measured #929292
    expect(dna.palette.roles["table-header-bg"].hex).toBe("#929292");
  });

  it("keeps a vision estimate + raises a flag when no probe color is close", async () => {
    const dna = await reconcileDna(probeDna(["#FCAF17", "#231F20", "#FFFFFF"]), vision);
    // foliage green has no nearby measured color
    expect(dna.palette.roles.foliage.provenance).toBe("vision");
    expect(dna.palette.roles.foliage.confidence).toBeLessThan(0.6);
    expect(dna.confidence.flags.some((f) => f.path === "palette.roles.foliage")).toBe(true);
  });

  it("carries vision motifs, tone and theme onto the DNA", async () => {
    const dna = await reconcileDna(probeDna(["#FCAF17"]), vision);
    expect(dna.theme.mode).toBe("single-light");
    expect(dna.tone_words).toEqual(["earthy", "premium"]);
    expect(dna.motifs[0].asset_role).toBe("banner");
  });
});
