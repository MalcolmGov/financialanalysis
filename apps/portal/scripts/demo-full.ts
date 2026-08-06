/**
 * Full upload→prototype run on REAL Docling extraction output, exercising both
 * product guarantees on genuine extracted data:
 *   real extraction.json + probe-dna.json + page PNGs
 *     → vision (opus-5) → reconcile → DesignDNA        [derived identity]
 *     → mapToDocModel(real extraction) → buildContentSample → studio → lint  [design]
 *     → buildSitePlan → renderSitePlan → gateA + gateB  [number integrity, real numbers]
 *
 * Prereq: services/worker/scripts/extract_and_probe.py wrote <DIR>.
 * Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/demo-full.ts
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Blueprint, DesignDNA, ExtractionResult } from "@rs/contracts";
import { conformanceLint, gateA, gateB, renderSitePlan, type ResolveContext } from "@rs/render";
import { mapToDocModel, buildSitePlan } from "@rs/mapper";
import { analyzeVision } from "../lib/vision";
import { reconcileDna } from "../lib/reconcile";
import { runStudio } from "../lib/studio";
import { buildContentSample, highlightsText } from "../lib/build-content";
import { extractKpis } from "../lib/enrich-kpis";

const DIR =
  "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad/full-run";
const OUT =
  "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad";

const meta = { company: "DRDGOLD Limited", period_label: "HY1 FY2026", doc_kind: "interim_unaudited" as const, currency: "ZAR" };

/** Minimal locked blueprint (statement-table component) for the gate path. */
function blueprint(checksum: string): Blueprint {
  return {
    schema_version: "1.0", blueprint_version_id: "bpv_real", project_id: "drd", cycle: 1,
    source_prototype_version_id: "pv", source_prototype_sha256: "a".repeat(64), status: "locked",
    locked_at: null, locked_by: null, checksum,
    tokens: { css: ":root{--dna-ink:#231F20}", values: {} },
    typography: { font_faces: [], ramp: [] }, breakpoints: [],
    navigation: { model: "sticky", items: [] },
    page_templates: [{ id: "bp:tpl_statement", name: "Statement", shell_html: "<main>{{region:main}}</main>", regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }] }],
    components: [{ id: "bp:cmp_FinTableBlock", name: "Statement table", html: '<section data-dna-component="statement-table">{{slot:table}}</section>', css: "", slots: { table: { type: "ref", accepts: "table", required: true } }, variants: [] }],
    table_styles: { header_bg: "", header_fg: "", current_period_shade: null, numeric_alignment: "right", zebra: false, rule_style: "hairline", negative_number_style: "parens", number_grouping: "space" },
    chart_theme: { palette: [], grid_color: "", font_role: "body", number_format: { locale: "en-ZA", thousands: " " }, allowed_chart_kinds: [] },
    print_stylesheet: null, a11y: { approved_text_pairs: [] }, assets: [], usage_rules: [],
  } as Blueprint;
}

async function main() {
  const extraction = JSON.parse(await fs.readFile(join(DIR, "extraction.json"), "utf8")) as ExtractionResult;
  const probe = JSON.parse(await fs.readFile(join(DIR, "probe-dna.json"), "utf8")) as DesignDNA;
  const pageFiles = (await fs.readdir(join(DIR, "pages"))).filter((f) => f.endsWith(".png")).sort();
  const pages = await Promise.all(pageFiles.map((f) => fs.readFile(join(DIR, "pages", f))));
  process.stdout.write(`REAL extraction: ${extraction.pages.length} pages, ${Object.keys(extraction.tables).length} tables, ${extraction.body.length} body blocks. ${pages.length} page images.\n`);

  // ── Design identity: vision → reconcile ────────────────────────────────────
  process.stdout.write("Vision + reconcile…\n");
  const { vision } = await analyzeVision(pages);
  const dna = await reconcileDna(probe, vision);
  process.stdout.write(`  DNA overall confidence ${dna.confidence.overall}; brand=${dna.palette.roles.brand?.hex} theme=${dna.theme.mode}\n`);

  // ── Content from the REAL extraction (mapper + KPI enricher) ───────────────
  const docModel = mapToDocModel(extraction, meta);
  const kpis = await extractKpis(highlightsText(docModel));
  const content = buildContentSample(docModel, extraction, { kpis });
  process.stdout.write(`  mapped ${docModel.tables.length} financial tables; ${content.kpis.length} KPIs, ${content.table.rows.length} statement rows, ${content.letter.paragraphs.length} letter paragraphs\n`);
  for (const k of content.kpis) process.stdout.write(`    KPI: "${k.label}" = ${k.value}\n`);

  // ── Design deliverable draft (studio) ──────────────────────────────────────
  process.stdout.write("Studio…\n");
  const studio = await runStudio({ dna, content, brief: "Confident, understated, premium; mirror the printed report." });
  await fs.writeFile(join(OUT, "drdgold-full.html"), studio.assembledHtml);
  const lint = conformanceLint(studio.assembledHtml, dna);
  process.stdout.write(`  prototype ${studio.assembledHtml.length} bytes, lint ${lint.passed ? "PASS" : "FAIL"}\n`);
  if (!lint.passed) for (const e of lint.errors) process.stdout.write(`    - [${e.rule}] ${e.detail}\n`);

  // ── Number-integrity gates on REAL extracted numbers ───────────────────────
  const bp = blueprint("c".repeat(64));
  const plan = buildSitePlan(docModel, bp);
  const ctx: ResolveContext = { extraction, docModel };
  const a = gateA(plan, ctx);
  const { files } = renderSitePlan(plan, bp, ctx);
  const b = gateB(files, ctx);
  process.stdout.write(`\nNumber-integrity gates on REAL extracted numbers:\n`);
  process.stdout.write(`  Gate A (referential+coverage): ${a.status} — ${a.coverage.placed}/${a.coverage.must_appear_cells} must-appear cells placed, ${a.dangling_refs.length} dangling\n`);
  process.stdout.write(`  Gate B (DOM audit): ${b.status} — ${b.matched}/${b.numeric_tokens_found} numeric tokens verbatim-matched, ${b.failures.length} failures\n`);
  if (b.failures.length) for (const f of b.failures.slice(0, 5)) process.stdout.write(`    - ${f.reason} "${f.token}" vs "${f.source_raw}" @ ${f.data_src}\n`);

  process.stdout.write(`\nWrote ${join(OUT, "drdgold-full.html")}\n`);
}

main().catch((e) => {
  console.error("\nFull run failed:", e);
  process.exit(1);
});
