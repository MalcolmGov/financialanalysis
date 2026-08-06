import { describe, expect, it } from "vitest";
import type { DesignDNA } from "@rs/contracts";
import { deltaE2000, hexToLab, nearestDeltaE } from "./color.js";
import { conformanceLint } from "./linter.js";

// DRDGOLD design DNA (approximate measured values): charcoal ink, brand gold,
// orange section accent, dark table header, grey period shading.
const dna: DesignDNA = {
  schema_version: "dna/1",
  dna_id: "d1",
  project_id: "p",
  revision: 1,
  source_pdf: { sha256: "a".repeat(64), pages: 10 },
  confidence: { overall: 0.9, flags: [] },
  palette: {
    roles: {
      paper: { hex: "#FFFFFF", provenance: "probe", confidence: 1 },
      ink: { hex: "#231F20", provenance: "probe", confidence: 1 },
      brand: { hex: "#B8912A", provenance: "probe", confidence: 1 },
      accent: { hex: "#E77724", provenance: "probe", confidence: 1 },
      "table-header-bg": { hex: "#404040", provenance: "probe", confidence: 1 },
    },
    measured: [],
    imagery: [],
  },
  type: {
    faces: [
      { pdf_name: "SourceSansPro", family: "Source Sans 3", weight: 400, italic: false, role: "body", glyph_share: 0.6, embedded: true, mapping: { web_family: "Source Sans 3", provider: "fontsource-selfhost", files: [], licence: "OFL-1.1", match_quality: "exact", confidence: 0.95 } },
    ],
    stack: { heading: "'Source Sans 3', sans-serif", body: "'Source Sans 3', sans-serif" },
    scale: { observed_pt: [9, 14, 22], web_base_px: 16, ratio: 1.25 },
    heading_treatment: { color: "accent", case: "sentence", weight: 700 },
  },
  spacing: { rhythm_px: [4, 8, 16], page_margins_pt: [36], columns: { letter: 2 } },
  table_style: { header_bg: "table-header-bg", header_text: "paper", header_case: "sentence", rules: {}, zebra: false, period_shading: null, numeric_alignment: "right", negative_format: "parentheses", thousands_separator: "thin-space", decimal_places: "as-source" },
  components: [],
  motifs: [],
  tone_words: ["grounded"],
  theme: { mode: "single-light", rationale: "" },
  human_edits: [],
};

const goodHtml = `<!doctype html><html><head><style>
:root{--dna-ink:#231F20;--dna-brand:#B8912A;--dna-accent:#E77724;--dna-paper:#FFFFFF}
body{background:#FFFFFF;color:#231F20;font-family:'Source Sans 3',sans-serif}
.head{background:#404040;color:#FFFFFF}
.accent{color:#E77724}
</style></head><body>
<section data-dna-component="kpi-card"><h2 class="accent">Highlights</h2></section>
</body></html>`;

describe("CIEDE2000 color distance", () => {
  it("is ~0 for identical colors and larger for distinct ones", () => {
    const a = hexToLab("#B8912A")!;
    expect(deltaE2000(a, a)).toBeLessThan(0.001);
    // brand gold vs Tailwind blue is a large perceptual distance
    expect(nearestDeltaE("#3b82f6", ["#B8912A"])).toBeGreaterThan(20);
    // a hair off the brand gold is within tolerance
    expect(nearestDeltaE("#B9922B", ["#B8912A"])).toBeLessThan(4);
  });
});

describe("conformance linter (no generic templates)", () => {
  it("passes a DNA-derived, self-contained, annotated prototype", () => {
    const r = conformanceLint(goodHtml, dna);
    expect(r.errors).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("fails a Tailwind-palette color", () => {
    // Corrupt the APPLIED accent (replaceAll so the .accent usage changes, not
    // just the stripped :root definition).
    const bad = goodHtml.replaceAll("#E77724", "#3b82f6");
    const r = conformanceLint(bad, dna);
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.rule === "banned-palette")).toBe(true);
  });

  it("fails an off-DNA accent color", () => {
    const bad = goodHtml.replaceAll("#E77724", "#12A5E7"); // a blue not in the DNA
    const r = conformanceLint(bad, dna);
    expect(r.errors.some((e) => e.rule === "non-dna-color")).toBe(true);
  });

  it("fails Inter-on-white when the DNA never produced Inter", () => {
    const bad = goodHtml.replace("'Source Sans 3',sans-serif", "Inter,sans-serif");
    const r = conformanceLint(bad, dna);
    expect(r.errors.some((e) => e.rule === "generic-font")).toBe(true);
  });

  it("fails an external request", () => {
    const bad = goodHtml.replace("</body>", '<img src="https://evil.example/x.png?d=123"></body>');
    const r = conformanceLint(bad, dna);
    expect(r.errors.some((e) => e.rule === "external-request")).toBe(true);
  });

  it("fails when component annotations are missing", () => {
    const bad = goodHtml.replace(' data-dna-component="kpi-card"', "");
    const r = conformanceLint(bad, dna);
    expect(r.errors.some((e) => e.rule === "missing-annotations")).toBe(true);
  });

  it("catches the near-monochrome loophole (greyscale + no applied brand color)", () => {
    // A generic card grid: only ink-on-paper neutrals, zero brand color applied.
    const mono = `<!doctype html><html><head><style>
      :root{--dna-ink:#231F20;--dna-brand:#B8912A;--dna-accent:#E77724;--dna-paper:#FFFFFF}
      body{background:#FFFFFF;color:#231F20}
      .card{background:#F4F4F4;color:#333333;border:1px solid #DDDDDD}
      .head{background:#404040;color:#FFFFFF}
    </style></head><body>
      <section data-dna-component="card"><h2>Highlights</h2></section>
    </body></html>`;
    const r = conformanceLint(mono, dna);
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.rule === "near-monochrome")).toBe(true);
  });
});
