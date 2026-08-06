/**
 * Live end-to-end Step 3 → Step 4 on the REAL DRDGOLD PDF, light-stack path:
 *   probe (pikepdf/pdfplumber, real) + page renders (pypdfium2)
 *     → vision (claude-opus-5, real page images)
 *     → reconcile (snap vision roles to probe-measured hexes, CIEDE2000)
 *     → studio (claude-opus-5) → prototype → conformance lint
 *
 * Prereq: services/worker/scripts/probe_and_render.py has written probe-dna.json
 * and pages/*.png into the demo dir below.
 * Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/demo-dna.ts
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { DesignDNA } from "@rs/contracts";
import { conformanceLint } from "@rs/render";
import { analyzeVision } from "../lib/vision";
import { reconcileDna } from "../lib/reconcile";
import { runStudio, type ContentSample } from "../lib/studio";

const DIR =
  "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad/dna-demo";
const OUT =
  "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad";

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
      "We are pleased to report that our operating performance for HY1 FY2026 is tracking the guidance for the financial year ending 30 June 2026, as we work toward Vision 2028.",
      "The main actor during the period, however, was the gold price. The average gold price received was R2 114 227/kg and, as an unhedged producer with costs well contained, the results were very rewarding.",
      "We increased our cash and cash equivalents to R1.7 billion, enabling us to declare an interim dividend of 50 SA cents per share — our 19th consecutive year of declaring a dividend.",
    ],
  },
  dividend: [
    "Last date to trade cum-dividend: Tuesday, 10 March 2026",
    "Record date: Friday, 13 March 2026",
    "Payment date: Monday, 16 March 2026",
  ],
};

async function main() {
  const probeDna = JSON.parse(await fs.readFile(join(DIR, "probe-dna.json"), "utf8")) as DesignDNA;
  const pageFiles = (await fs.readdir(join(DIR, "pages"))).filter((f) => f.endsWith(".png")).sort();
  const pages = await Promise.all(pageFiles.map((f) => fs.readFile(join(DIR, "pages", f))));
  process.stdout.write(`Loaded probe DNA (${probeDna.palette.measured.length} measured colors, ${probeDna.type.faces.length} faces) + ${pages.length} page images.\n`);

  process.stdout.write("Vision DNA analysis (claude-opus-5 on real page images)…\n");
  const { vision, usage: vUsage } = await analyzeVision(pages);
  process.stdout.write(`  theme: ${vision.theme_mode} · tone: ${vision.tone_words.join(", ")}\n`);
  process.stdout.write(`  roles read: ${vision.palette_roles.map((r) => `${r.role}=${r.hex}`).join("  ")}\n`);
  process.stdout.write(`  motifs: ${vision.motifs.map((m) => m.kind + (m.value ? ` "${m.value}"` : "")).join("; ")}\n`);

  const dna = await reconcileDna(probeDna, vision);
  process.stdout.write("\nReconciled DesignDNA roles (vision role → snapped to probe-measured hex):\n");
  for (const [role, entry] of Object.entries(dna.palette.roles)) {
    process.stdout.write(`  ${role.padEnd(20)} ${entry.hex}  [${entry.provenance}, conf ${entry.confidence}]\n`);
  }
  process.stdout.write(`  overall confidence: ${dna.confidence.overall}; flags: ${dna.confidence.flags.length}\n`);

  process.stdout.write("\nStudio generation from the DERIVED DNA (claude-opus-5, streaming)…\n");
  const result = await runStudio({ dna, content, brief: "Confident, understated, premium; mirror the printed report." });
  await fs.writeFile(join(OUT, "drdgold-derived.html"), result.assembledHtml);
  const lint = conformanceLint(result.assembledHtml, dna);

  process.stdout.write(`\n=== RESULT (fully derived, nothing hand-authored) ===\n`);
  process.stdout.write(`Vision cost $${vUsage.cost_usd.toFixed(3)} + studio $${result.usage.cost_usd.toFixed(3)}\n`);
  process.stdout.write(`Prototype: ${result.assembledHtml.length} bytes · lint ${lint.passed ? "PASS" : "FAIL"}\n`);
  if (!lint.passed) for (const e of lint.errors) process.stdout.write(`  - [${e.rule}] ${e.detail}\n`);
  process.stdout.write(`Wrote ${join(OUT, "drdgold-derived.html")}\n`);
}

main().catch((e) => {
  console.error("\nDNA demo failed:", e);
  process.exit(1);
});
