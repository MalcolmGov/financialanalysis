/** Gates-only re-check on the real extraction (no AI): map → SitePlan → render
 * → Gate A + Gate B, to confirm number integrity holds on genuine extracted
 * numbers after the every-cell-provenance renderer fix. */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Blueprint, ExtractionResult } from "@rs/contracts";
import { gateA, gateB, renderSitePlan, type ResolveContext } from "@rs/render";
import { mapToDocModel, buildSitePlan } from "@rs/mapper";

const DIR =
  "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad/full-run";
const meta = { company: "DRDGOLD Limited", period_label: "HY1 FY2026", doc_kind: "interim_unaudited" as const, currency: "ZAR" };

function blueprint(checksum: string): Blueprint {
  return {
    schema_version: "1.0", blueprint_version_id: "bpv", project_id: "drd", cycle: 1,
    source_prototype_version_id: "pv", source_prototype_sha256: "a".repeat(64), status: "locked",
    locked_at: null, locked_by: null, checksum,
    tokens: { css: ":root{--dna-ink:#231F20}", values: {} }, typography: { font_faces: [], ramp: [] }, breakpoints: [],
    navigation: { model: "sticky", items: [] },
    page_templates: [{ id: "bp:tpl_statement", name: "S", shell_html: "<main>{{region:main}}</main>", regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }] }],
    components: [{ id: "bp:cmp_FinTableBlock", name: "T", html: '<section data-dna-component="statement-table">{{slot:table}}</section>', css: "", slots: { table: { type: "ref", accepts: "table", required: true } }, variants: [] }],
    table_styles: { header_bg: "", header_fg: "", current_period_shade: null, numeric_alignment: "right", zebra: false, rule_style: "hairline", negative_number_style: "parens", number_grouping: "space" },
    chart_theme: { palette: [], grid_color: "", font_role: "body", number_format: { locale: "en-ZA", thousands: " " }, allowed_chart_kinds: [] },
    print_stylesheet: null, a11y: { approved_text_pairs: [] }, assets: [], usage_rules: [],
  } as Blueprint;
}

async function main() {
  const extraction = JSON.parse(await fs.readFile(join(DIR, "extraction.json"), "utf8")) as ExtractionResult;
  const docModel = mapToDocModel(extraction, meta);
  const bp = blueprint("c".repeat(64));
  const plan = buildSitePlan(docModel, bp);
  const ctx: ResolveContext = { extraction, docModel };
  const a = gateA(plan, ctx);
  const { files } = renderSitePlan(plan, bp, ctx);
  const b = gateB(files, ctx);
  process.stdout.write(`Mapped ${docModel.tables.length} tables from real extraction.\n`);
  process.stdout.write(`Gate A: ${a.status} — ${a.coverage.placed}/${a.coverage.must_appear_cells} must-appear cells, ${a.dangling_refs.length} dangling\n`);
  process.stdout.write(`Gate B: ${b.status} — ${b.matched}/${b.numeric_tokens_found} numeric tokens verbatim-matched, ${b.failures.length} failures\n`);
  for (const f of b.failures.slice(0, 8)) process.stdout.write(`  - ${f.reason} "${f.token}" vs "${f.source_raw}" @ ${f.data_src}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
