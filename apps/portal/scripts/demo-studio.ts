/**
 * Live end-to-end demo of the step-4 design studio, grounded in the real
 * DRDGOLD HY1 FY2026 results. Builds an approved-quality DesignDNA + content
 * sample, generates a prototype with claude-opus-5, and runs it through the
 * shared conformance linter. Run:
 *   set -a; . ./.env.local; set +a
 *   pnpm --filter portal exec tsx scripts/demo-studio.ts
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { DesignDNA } from "@rs/contracts";
import { conformanceLint } from "@rs/render";
import { runStudio, type ContentSample } from "../lib/studio";

const dna: DesignDNA = {
  schema_version: "dna/1",
  dna_id: "dna_drd",
  project_id: "demo",
  revision: 1,
  source_pdf: { sha256: "0".repeat(64), pages: 10 },
  confidence: { overall: 0.93, flags: [] },
  palette: {
    roles: {
      paper: { hex: "#FFFFFF", provenance: "probe", confidence: 1 },
      ink: { hex: "#231F20", provenance: "probe", confidence: 1 },
      brand: { hex: "#B8912A", provenance: "probe", confidence: 0.95 },
      accent: { hex: "#E77724", provenance: "probe+vision", confidence: 0.9 },
      "masthead-bg": { hex: "#1E1E1E", provenance: "probe", confidence: 0.95 },
      "table-header-bg": { hex: "#404040", provenance: "probe", confidence: 0.95 },
      "table-header-text": { hex: "#FFFFFF", provenance: "probe", confidence: 1 },
      "table-shading": { hex: "#E9E7E4", provenance: "probe", confidence: 0.9 },
      "footer-accent": { hex: "#B8912A", provenance: "probe", confidence: 0.9 },
    },
    measured: [],
    imagery: ["#0E0B08", "#6B4A1E", "#C9972F", "#3F5D2E"],
  },
  type: {
    faces: [
      { pdf_name: "SourceSansPro", family: "Source Sans 3", weight: 400, italic: false, role: "body", glyph_share: 0.62, embedded: true, mapping: { web_family: "Source Sans 3", provider: "fontsource-selfhost", files: [], licence: "OFL-1.1", match_quality: "exact", confidence: 0.95 } },
    ],
    stack: { heading: "'Source Sans 3', 'Segoe UI', sans-serif", body: "'Source Sans 3', 'Segoe UI', sans-serif" },
    scale: { observed_pt: [9, 10.5, 14, 22], web_base_px: 16, ratio: 1.25 },
    heading_treatment: { color: "accent", case: "sentence", weight: 700 },
  },
  spacing: { rhythm_px: [4, 8, 12, 16, 24, 40], page_margins_pt: [40, 36, 44, 36], columns: { letter: 2, statements: 1, notes: 2 } },
  table_style: { header_bg: "table-header-bg", header_text: "table-header-text", header_case: "sentence", rules: {}, zebra: false, period_shading: { role: "table-shading", target: "current-period-column" }, numeric_alignment: "right", negative_format: "parentheses", thousands_separator: "thin-space", decimal_places: "as-source", units_header: "stacked" },
  components: [
    { id: "kpi-card", spec: "boxed card, 4pt left accent bar, bold value, small caption" },
    { id: "banner-band", spec: "full-width gold-dust photographic strip, dark→gold, seedling motif" },
    { id: "footer-strip", spec: "hairline top rule; brand-gold wordmark + doc title; page number right" },
  ],
  motifs: [
    { id: "gold-dust-banner", kind: "photography", asset_role: "banner", notes: "macro soil/gold dust with green seedling — renewal metaphor" },
    { id: "triangle-logo", kind: "logo", asset_role: "logo" },
    { id: "tagline", kind: "text", value: "SUSTAINABLY GOLD · RECLAIM | RESTORE | RETURN" },
  ],
  tone_words: ["grounded", "premium", "operational", "renewal", "confident"],
  theme: { mode: "single-light", rationale: "PDF identity is light with a dark masthead; a dark theme would be invented" },
  theme_id: "classic",
  human_edits: [],
};

const content: ContentSample = {
  company: "DRDGOLD Limited",
  period: "Condensed consolidated unaudited interim results — six months ended 31 December 2025",
  kpis: [
    { label: "Operating profit increased by 72% to", value: "R2 712.8 million" },
    { label: "Headline earnings increased by 99% to", value: "R1 932.4 million" },
    { label: "Interim cash dividend of", value: "50 SA cps" },
    { label: "Capital expenditure of", value: "R1 651.3 million" },
    { label: "All-in sustaining cost margin of", value: "48%" },
    { label: "Gold production decreased by 9% to", value: "2 337 kilograms" },
  ],
  table: {
    caption: "Condensed consolidated statement of profit or loss and other comprehensive income (Rm)",
    headers: ["", "Six months ended 31 Dec 2025", "Six months ended 31 Dec 2024"],
    rows: [
      ["Revenue", "5 053.2", "3 802.3"],
      ["Cost of sales", "(2 591.4)", "(2 490.4)"],
      ["Gross profit from operating activities", "2 461.8", "1 311.9"],
      ["Results from operating activities", "2 334.2", "1 212.6"],
      ["Profit before tax", "2 418.2", "1 307.2"],
      ["Income tax", "(490.5)", "(337.1)"],
      ["Profit for the period", "1 927.7", "970.1"],
    ],
  },
  chart: {
    title: "Group performance — HY1 FY2026 vs HY1 FY2025 (Rm)",
    categories: ["Revenue", "Operating profit", "Headline earnings"],
    series: [
      { label: "HY1 FY2026", values: ["5 053.2", "2 712.8", "1 932.4"] },
      { label: "HY1 FY2025", values: ["3 802.3", "1 578.7", "970.1"] },
    ],
  },
  letter: {
    heading: "Dear Shareholder",
    paragraphs: [
      "We are pleased to report that our operating performance for HY1 FY2026 is tracking the guidance for the financial year ending 30 June 2026. Far West Gold Recoveries Proprietary Limited's throughput remained steady, and at Ergo Mining Proprietary Limited, operating at a reduced throughput rate during this transitionary phase while we work toward Vision 2028.",
      "The main actor during the period under review, however, was the gold price. The average gold price received for the period was R2 114 227/kg and, as an unhedged producer, and with costs well contained, the results were very rewarding. We sold 76 776 ounces of gold, generating revenue of R5.1 billion.",
      "It was pleasing to see a 23% reduction in electricity costs at Ergo. We increased our cash and cash equivalents to R1.7 billion, which now has enabled us to declare an interim dividend of 50 SA cents per share, marking our 19th consecutive year of declaring a dividend.",
    ],
  },
  dividend: [
    "Last date to trade cum-dividend: Tuesday, 10 March 2026",
    "Shares trade ex-dividend: Wednesday, 11 March 2026",
    "Record date: Friday, 13 March 2026",
    "Payment date: Monday, 16 March 2026",
  ],
};

const brief =
  "Audience: investors and financial media. Confident, understated, premium tone that mirrors the printed report. Lead with the highlights and the growth story; keep the shareholder letter highly readable; make the financial statement and the comparative chart the centrepiece.";

async function main() {
  const t0 = Date.now();
  process.stdout.write("Generating prototype with claude-opus-5 (streaming)…\n");
  let chars = 0;
  const result = await runStudio({
    dna,
    content,
    brief,
    onDelta: (t) => {
      chars += t.length;
      if (chars % 4000 < t.length) process.stdout.write(`  …${chars} chars\r`);
    },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  const outDir =
    "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad";
  await fs.writeFile(join(outDir, "drdgold-prototype.html"), result.assembledHtml);
  await fs.writeFile(join(outDir, "drdgold-prototype.placeholder.html"), result.placeholderHtml);

  const lint = conformanceLint(result.assembledHtml, dna);

  process.stdout.write("\n\n=== RESULT ===\n");
  process.stdout.write(`Generated in ${secs}s · ${result.placeholderHtml.length} bytes (placeholder), ${result.assembledHtml.length} bytes (assembled)\n`);
  process.stdout.write(`Cost: $${result.usage.cost_usd.toFixed(3)} (in ${result.usage.input_tokens}, out ${result.usage.output_tokens} tokens)\n`);
  process.stdout.write(`Stop reason: ${result.stopReason}\n`);
  process.stdout.write(`Token block verbatim present: ${result.assembledHtml.includes(result.tokenBlock)}\n`);
  process.stdout.write(`Conformance lint: ${lint.passed ? "PASS" : "FAIL"}\n`);
  if (lint.errors.length) {
    process.stdout.write("Errors:\n");
    for (const e of lint.errors) process.stdout.write(`  - [${e.rule}] ${e.detail}\n`);
  }
  if (lint.warnings.length) {
    for (const w of lint.warnings) process.stdout.write(`  ~ [${w.rule}] ${w.detail}\n`);
  }
  // Verbatim number spot-check.
  const mustContain = ["5 053.2", "2 712.8", "1 932.4", "(490.5)", "1 927.7", "50 SA cps"];
  const missing = mustContain.filter((n) => !result.assembledHtml.includes(n));
  process.stdout.write(`Verbatim figures present: ${missing.length === 0 ? "ALL" : `MISSING ${missing.join(", ")}`}\n`);
  process.stdout.write(`\nWrote: ${join(outDir, "drdgold-prototype.html")}\n`);
}

main().catch((e) => {
  console.error("\nStudio demo failed:", e);
  process.exit(1);
});
