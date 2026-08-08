import { describe, expect, it } from "vitest";
import type {
  Blueprint,
  ExtractionResult,
  FinancialDocModel,
  SitePlan,
} from "@rs/contracts";
import { gateA } from "./gate-a.js";
import { gateB } from "./gate-b.js";
import { renderSitePlan } from "./renderer.js";
import type { ResolveContext } from "./resolve.js";

/**
 * Fixture grounded in the real DRDGOLD HY1 FY2026 statement of profit or loss
 * (page 5). Numbers are the actual published figures — the point of these tests
 * is that not one of them can drift on the way to the exported site.
 */

const PNL_ROWS = [
  { label: "Revenue", cur: "5 053.2", pri: "3 802.3" },
  { label: "Gross profit from operating activities", cur: "2 461.8", pri: "1 311.9" },
  { label: "Profit for the period", cur: "1 927.7", pri: "970.1" },
];

function extraction(): ExtractionResult {
  const cells = [
    { r: 0, c: 0, row_span: 1, col_span: 1, text: "", is_col_header: true, is_row_header: false, is_section: false },
    { r: 0, c: 1, row_span: 1, col_span: 1, text: "Six months ended 31 Dec 2025", is_col_header: true, is_row_header: false, is_section: false },
    { r: 0, c: 2, row_span: 1, col_span: 1, text: "Six months ended 31 Dec 2024", is_col_header: true, is_row_header: false, is_section: false },
  ];
  PNL_ROWS.forEach((row, i) => {
    const r = i + 1;
    cells.push(
      { r, c: 0, row_span: 1, col_span: 1, text: row.label, is_col_header: false, is_row_header: true, is_section: false },
      { r, c: 1, row_span: 1, col_span: 1, text: row.cur, is_col_header: false, is_row_header: false, is_section: false },
      { r, c: 2, row_span: 1, col_span: 1, text: row.pri, is_col_header: false, is_row_header: false, is_section: false },
    );
  });
  return {
    schema_version: "1.0",
    extraction_id: "ext_1",
    org_id: "o",
    project_id: "p",
    source: { blob_path: "s.pdf", sha256: "a".repeat(64), size_bytes: 1, page_count: 10, pdf_meta: { title: "", producer: "Workiva", created: "", modified: "" } },
    engine: { docling_version: "2.x", backend: "docling_parse_v4", table_mode: "accurate", ocr_applied: false, ocr_engine: null },
    pages: [],
    body: [],
    furniture: [],
    tables: {
      t_pnl: { id: "t_pnl", caption_block: null, prov: [], num_rows: 4, num_cols: 3, cells, column_roles: null },
    },
    figures: {},
    warnings: [],
    enrichment: { sections: [], key_figures: [], numeric_annotations: {} },
  } as ExtractionResult;
}

function docModel(): FinancialDocModel {
  return {
    schema_version: "docmodel/1",
    doc_model_id: "dm_1",
    extraction_id: "ext_1",
    content_hash: "b".repeat(64),
    meta: { company: "DRDGOLD Limited", period_label: "HY1 FY2026", doc_kind: "interim_unaudited", currency: "ZAR" },
    sections: [{ id: "doc:sec_pnl", kind: "statement", statement_type: "pnl_oci", blocks: [], items: [] }],
    tables: [
      {
        id: "doc:tbl_pnl",
        src_table: "ext:t_pnl",
        must_appear: true,
        table_type: "statement",
        header_matrix: [
          [
            { raw: "", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:r0c0" },
            { raw: "Six months ended 31 Dec 2025", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:r0c1" },
            { raw: "Six months ended 31 Dec 2024", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:r0c2" },
          ],
        ],
        unit_context: { default: "Rm", per_row: {} },
        row_groups: [],
        rows: PNL_ROWS.map((row, i) => {
          const r = i + 1;
          return {
            cells: [
              { src_ref: `ext:t_pnl:r${r}c0`, raw: row.label, kind: "text" as const, footnote_refs: [] },
              { src_ref: `ext:t_pnl:r${r}c1`, raw: row.cur, kind: "number" as const, footnote_refs: [] },
              { src_ref: `ext:t_pnl:r${r}c2`, raw: row.pri, kind: "number" as const, footnote_refs: [] },
            ],
          };
        }),
      },
    ],
    footnotes: [],
    mapping_review: [],
  } as FinancialDocModel;
}

function blueprint(): Blueprint {
  return {
    schema_version: "1.0",
    blueprint_version_id: "bpv_1",
    project_id: "p",
    cycle: 1,
    source_prototype_version_id: "pv_1",
    source_prototype_sha256: "a".repeat(64),
    status: "locked",
    locked_at: null,
    locked_by: null,
    checksum: "c".repeat(64),
    tokens: { css: ":root{--dna-ink:#231F20;--dna-brand:#B8912A}", values: { "color.ink": "#231F20" } },
    typography: { font_faces: [], ramp: [] },
    breakpoints: [],
    navigation: { model: "sticky", items: [] },
    page_templates: [
      { id: "bp:tpl_statement", name: "Statement", shell_html: "<main>{{region:main}}</main>", regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock", "bp:cmp_KpiCard"], min: 0, max: null }] },
    ],
    components: [
      {
        id: "bp:cmp_FinTableBlock",
        name: "Statement table",
        html: '<section class="stmt">{{slot:table}}</section>',
        css: "",
        slots: { table: { type: "ref", accepts: "table", required: true } },
        variants: [],
      },
      {
        id: "bp:cmp_KpiCard",
        name: "KPI",
        html: '<div class="kpi"><span class="v">{{slot:value}}</span><span class="l">{{slot:label}}</span></div>',
        css: "",
        slots: {
          value: { type: "ref", accepts: "cell", required: true },
          label: { type: "text", no_numerals: true, required: true },
        },
        variants: [],
      },
    ],
    table_styles: { header_bg: "", header_fg: "", current_period_shade: null, numeric_alignment: "right", zebra: false, rule_style: "hairline", negative_number_style: "parens", number_grouping: "space" },
    chart_theme: { palette: [], grid_color: "", font_role: "body", number_format: { locale: "en-ZA", thousands: " " }, allowed_chart_kinds: ["groupedBar"] },
    print_stylesheet: null,
    a11y: { approved_text_pairs: [] },
    assets: [],
    usage_rules: [],
  } as Blueprint;
}

function statementPlan(): SitePlan {
  return {
    schema_version: "siteplan/1",
    site_plan_id: "sp_1",
    doc_model_id: "dm_1",
    blueprint_version_id: "bpv_1",
    blueprint_checksum: "c".repeat(64),
    model: "claude-sonnet-5",
    iteration: 1,
    nav: [{ label: "Statements", href: "statements/index.html" }],
    pages: [
      {
        path: "statements/index.html",
        template: "bp:tpl_statement",
        title: "Statement of profit or loss",
        regions: { main: [{ component: "bp:cmp_FinTableBlock", slots: { table: "doc:tbl_pnl" } }] },
        downloads: [],
      },
    ],
    validation: { status: "unvalidated", errors: [] },
  } as SitePlan;
}

const ctx = (): ResolveContext => ({ extraction: extraction(), docModel: docModel() });

describe("deterministic render + integrity gates", () => {
  it("renders every number as a verbatim, provenance-tagged span", () => {
    const { files } = renderSitePlan(statementPlan(), blueprint(), ctx());
    const html = files["statements/index.html"]!;
    expect(html).toContain('data-src="ext:t_pnl:r1c1"');
    expect(html).toContain("5 053.2"); // verbatim, thin space intact
    expect(html).toContain("1 927.7");
    expect(html).toContain('data-dna-component="statement-unit"');
    expect(html).toContain('statement-unit__value');
    expect(html).toContain(">Rm<");
    expect(html).toContain("<colgroup>");
    expect(html).toContain('class="c-label"');
  });

  it("a correct render passes Gate A and Gate B", () => {
    const c = ctx();
    const { files } = renderSitePlan(statementPlan(), blueprint(), c);
    expect(gateA(statementPlan(), c).status).toBe("pass");
    const b = gateB(files, c);
    expect(b.status).toBe("pass");
    expect(b.failures).toEqual([]);
    expect(b.matched).toBeGreaterThan(0);
  });

  it("traces digits in text label cells and ignores empty sparse cells (real-table shapes)", () => {
    // Reproduces the real-DRDGOLD run: a row-label cell carries a date, and
    // real Docling tables are sparse (a grid slot with no source cell). The
    // label's digits must be traceable; the empty slot must not be flagged.
    const c = ctx();
    (c.extraction.tables["t_pnl"].cells as unknown[]).push({ r: 4, c: 0, row_span: 1, col_span: 1, text: "Balance at 30 June 2024", is_col_header: false, is_row_header: true, is_section: false });
    c.docModel.tables[0].rows.push({
      cells: [
        { src_ref: "ext:t_pnl:r4c0", raw: "Balance at 30 June 2024", kind: "text", footnote_refs: [] },
        { src_ref: "ext:t_pnl:r4c1", raw: "", kind: "nil", footnote_refs: [] }, // empty gap — no source cell
      ],
    });
    const { files } = renderSitePlan(statementPlan(), blueprint(), c);
    const b = gateB(files, c);
    expect(b.status).toBe("pass"); // "30"/"2024" traced in the label; empty slot ignored
    expect(b.failures).toEqual([]);
  });

  it("Gate B CATCHES a transposed digit (simulated renderer bug)", () => {
    const c = ctx();
    const { files } = renderSitePlan(statementPlan(), blueprint(), c);
    // Corrupt one rendered value: 1 927.7 -> 1 297.7 (digits transposed).
    files["statements/index.html"] = files["statements/index.html"].replace("1 927.7", "1 297.7");
    const b = gateB(files, c);
    expect(b.status).toBe("fail");
    const f = b.failures.find((x) => x.data_src === "ext:t_pnl:r3c1");
    expect(f?.reason).toBe("verbatim-mismatch");
    expect(f?.source_raw).toBe("1 927.7");
    expect(f?.token).toBe("1 297.7");
  });

  it("Gate B CATCHES an untraceable number injected outside any data-src", () => {
    const c = ctx();
    const { files } = renderSitePlan(statementPlan(), blueprint(), c);
    files["statements/index.html"] = files["statements/index.html"].replace(
      "</main>",
      "<p>Total assets 14 639.9</p></main>",
    );
    const b = gateB(files, c);
    expect(b.status).toBe("fail");
    expect(b.failures.some((x) => x.reason === "no-data-src")).toBe(true);
  });

  it("Gate A CATCHES a dangling reference", () => {
    const c = ctx();
    const plan = statementPlan();
    plan.pages[0].regions.main.push({
      component: "bp:cmp_KpiCard",
      slots: { value: "ext:t_pnl:r9c9", label: "Nonexistent" }, // no such cell
    });
    const a = gateA(plan, c);
    expect(a.status).toBe("fail");
    expect(a.dangling_refs).toContain("ext:t_pnl:r9c9");
  });

  it("Gate A CATCHES an omitted must-appear table (nothing silently dropped)", () => {
    const c = ctx();
    const emptyPlan = statementPlan();
    emptyPlan.pages[0].regions.main = []; // place nothing
    const a = gateA(emptyPlan, c);
    expect(a.status).toBe("fail");
    expect(a.coverage.missing.length).toBe(6); // 3 rows x 2 numeric columns
  });
});
