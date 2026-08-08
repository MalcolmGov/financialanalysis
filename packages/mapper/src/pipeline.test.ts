import { describe, expect, it } from "vitest";
import { validateSitePlan, type Blueprint, type ExtractionResult } from "@rs/contracts";
import { gateA, gateB, renderSitePlan, type ResolveContext } from "@rs/render";
import { mapToDocModel } from "./docmodel.js";
import { buildSitePlan } from "./siteplan.js";

/**
 * End-to-end proof of the numeric spine WITHOUT any API key:
 *   ExtractionResult → FinancialDocModel → SitePlan → validate → render → gates
 * Grounded in the real DRDGOLD HY1 FY2026 statement of profit or loss (page 5),
 * including its "Notes" cross-reference column.
 */

type Cell = ExtractionResult["tables"][string]["cells"][number];
function h(r: number, c: number, text: string): Cell {
  return { r, c, row_span: 1, col_span: 1, text, is_col_header: true, is_row_header: false, is_section: false };
}
function rh(r: number, c: number, text: string): Cell {
  return { r, c, row_span: 1, col_span: 1, text, is_col_header: false, is_row_header: true, is_section: false };
}
function d(r: number, c: number, text: string): Cell {
  return { r, c, row_span: 1, col_span: 1, text, is_col_header: false, is_row_header: false, is_section: false };
}

function extraction(): ExtractionResult {
  const cells: Cell[] = [
    // 2 header rows
    h(0, 0, ""), h(0, 1, "Notes"), h(0, 1 + 1, "Six months ended 31 Dec 2025"), h(0, 3, "Six months ended 31 Dec 2024"),
    h(1, 0, ""), h(1, 1, ""), h(1, 2, "Rm Unaudited"), h(1, 3, "Rm Unaudited"),
    // data rows (verbatim DRDGOLD figures, incl. parenthesised negatives + note ref "3")
    rh(2, 0, "Revenue"), d(2, 1, ""), d(2, 2, "5 053.2"), d(2, 3, "3 802.3"),
    rh(3, 0, "Income tax"), d(3, 1, "3"), d(3, 2, "(490.5)"), d(3, 3, "(337.1)"),
    rh(4, 0, "Profit for the period"), d(4, 1, ""), d(4, 2, "1 927.7"), d(4, 3, "970.1"),
  ];
  return {
    schema_version: "1.0",
    extraction_id: "ext_drd",
    org_id: "o",
    project_id: "p",
    source: { blob_path: "s.pdf", sha256: "a".repeat(64), size_bytes: 1, page_count: 10, pdf_meta: { title: "", producer: "Workiva", created: "", modified: "" } },
    engine: { docling_version: "2.x", backend: "docling_default", table_mode: "accurate", ocr_applied: false, ocr_engine: null },
    pages: [],
    body: [],
    furniture: [],
    tables: {
      t_pnl: { id: "t_pnl", caption_block: "Statement of profit or loss and OCI", prov: [], num_rows: 5, num_cols: 4, cells, column_roles: null },
    },
    figures: {},
    warnings: [],
    enrichment: { sections: [], key_figures: [], numeric_annotations: {} },
  } as ExtractionResult;
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
    tokens: { css: ":root{--dna-ink:#231F20;--dna-brand:#B8912A}", values: {} },
    typography: { font_faces: [], ramp: [] },
    breakpoints: [],
    navigation: { model: "sticky", items: [] },
    page_templates: [
      { id: "bp:tpl_statement", name: "Statement", shell_html: "<main>{{region:main}}</main>", regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }] },
    ],
    components: [
      {
        id: "bp:cmp_FinTableBlock",
        name: "Statement table",
        html: '<section class="stmt" data-dna-component="statement-table">{{slot:table}}</section>',
        css: "",
        slots: { table: { type: "ref", accepts: "table", required: true } },
        variants: [],
      },
    ],
    table_styles: { header_bg: "", header_fg: "", current_period_shade: null, numeric_alignment: "right", zebra: false, rule_style: "hairline", negative_number_style: "parens", number_grouping: "space" },
    chart_theme: { palette: [], grid_color: "", font_role: "body", number_format: { locale: "en-ZA", thousands: " " }, allowed_chart_kinds: [] },
    print_stylesheet: null,
    a11y: { approved_text_pairs: [] },
    assets: [],
    usage_rules: [],
  } as Blueprint;
}

const meta = { company: "DRDGOLD Limited", period_label: "HY1 FY2026", doc_kind: "interim_unaudited" as const, currency: "ZAR" };

describe("mapper → render → gates (end to end, no API key)", () => {
  it("classifies the financial table and preserves every number verbatim", () => {
    const dm = mapToDocModel(extraction(), meta);
    expect(dm.tables).toHaveLength(1);
    const t = dm.tables[0];
    expect(t.must_appear).toBe(true);
    expect(t.table_type).toBe("statement");
    // header rows detected (2), so 3 data rows
    expect(t.rows).toHaveLength(3);
    // verbatim raw survived the mapping
    const flat = t.rows.flatMap((r) => r.cells);
    expect(flat.find((c) => c.src_ref === "ext:t_pnl:r2c2")?.raw).toBe("5 053.2");
    expect(flat.find((c) => c.src_ref === "ext:t_pnl:r3c2")?.raw).toBe("(490.5)");
  });

  it("treats the Notes column as a noteRef, not a data number", () => {
    const dm = mapToDocModel(extraction(), meta);
    const noteCell = dm.tables[0].rows.flatMap((r) => r.cells).find((c) => c.src_ref === "ext:t_pnl:r3c1");
    expect(noteCell?.raw).toBe("3");
    expect(noteCell?.kind).toBe("noteRef"); // NOT "number" — it is a cross-reference
  });

  it("omits Unit Rm chip for Review of Operations (per-row unit column)", () => {
    const cells: Cell[] = [
      h(0, 0, "Review Of Operations"),
      h(0, 2, "Six months ended 31 Dec 2025"),
      h(0, 3, "Six months ended 31 Dec 2024"),
      h(0, 4, "% change 1"),
      rh(1, 0, "Cash operating costs"),
      d(1, 1, "R per kg"),
      d(1, 2, "980 042"),
      d(1, 3, "866 221"),
      d(1, 4, "13"),
      d(2, 1, "US$ per oz"),
      d(2, 2, "1 756"),
      d(2, 3, "1 502"),
      d(2, 4, "17"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      tables: {
        t_ops: {
          id: "t_ops",
          caption_block: null,
          prov: [],
          num_rows: 3,
          num_cols: 5,
          cells,
          column_roles: null,
        },
      },
    };
    const dm = mapToDocModel(ex, meta);
    expect(dm.tables[0]!.table_type).toBe("facts");
    expect(dm.tables[0]!.unit_context.default).toBe("");
    expect(dm.tables[0]!.rows[0]!.cells[2]!.raw).toBe("980 042");
    expect(dm.tables[0]!.rows[1]!.cells[1]!.raw).toBe("US$ per oz");
  });

  it("clamps title colspan when Notes is a discrete cell (no 5-col ghost grid)", () => {
    const cells: Cell[] = [
      { ...h(0, 0, "Statement of Profit or Loss"), col_span: 2 },
      h(0, 1, "Notes"),
      h(0, 2, "Six months ended 31 Dec 2025 Rm Unaudited"),
      h(0, 3, "Six months ended 31 Dec 2024 Rm Unaudited"),
      rh(1, 0, "Revenue"),
      d(1, 1, ""),
      d(1, 2, "5 053.2"),
      d(1, 3, "3 802.3"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      tables: {
        t_pnl: {
          id: "t_pnl",
          caption_block: "PnL",
          prov: [],
          num_rows: 2,
          num_cols: 4,
          cells,
          column_roles: null,
        },
      },
    };
    const dm = mapToDocModel(ex, meta);
    const hdr = dm.tables[0]!.header_matrix[0]!;
    const headerLogical = hdr.reduce((n, c) => n + c.col_span, 0);
    expect(headerLogical).toBe(4);
    expect(hdr[0]!.col_span).toBe(1);
    expect(hdr.some((c) => /^notes?$/i.test(c.raw))).toBe(true);
    expect(dm.tables[0]!.rows[0]!.cells).toHaveLength(4);
  });

  it("treats multi note refs like 5, 7 as noteRef", () => {
    const cells: Cell[] = [
      h(0, 0, ""),
      h(0, 1, "Notes"),
      h(0, 2, "As at 31 Dec 2025"),
      h(0, 3, "As at 31 Dec 2024"),
      rh(1, 0, "Finance income"),
      d(1, 1, "5, 7"),
      d(1, 2, "116.6"),
      d(1, 3, "132.8"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      tables: {
        t_pnl: {
          id: "t_pnl",
          caption_block: "PnL",
          prov: [],
          num_rows: 2,
          num_cols: 4,
          cells,
          column_roles: null,
        },
      },
    };
    const note = mapToDocModel(ex, meta).tables[0]!.rows[0]!.cells[1]!;
    expect(note.raw).toBe("5, 7");
    expect(note.kind).toBe("noteRef");
  });

  it("produces a blueprint-conformant, ref-only SitePlan (validateSitePlan clean)", () => {
    const dm = mapToDocModel(extraction(), meta);
    const bp = blueprint();
    const plan = buildSitePlan(dm, bp);
    expect(validateSitePlan(plan, bp)).toEqual([]);
  });

  it("renders and passes BOTH integrity gates end to end", () => {
    const ex = extraction();
    const dm = mapToDocModel(ex, meta);
    const bp = blueprint();
    const plan = buildSitePlan(dm, bp);
    const ctx: ResolveContext = { extraction: ex, docModel: dm };

    const a = gateA(plan, ctx);
    expect(a.status).toBe("pass");
    expect(a.coverage.must_appear_cells).toBe(6); // 3 rows x 2 numeric columns (note col excluded)

    const { files } = renderSitePlan(plan, bp, ctx);
    const b = gateB(files, ctx);
    expect(b.status).toBe("pass");
    expect(b.failures).toEqual([]);

    const html = files["statements/index.html"];
    expect(html).toContain("5 053.2");
    expect(html).toContain("(490.5)");
    expect(html).toContain("1 927.7");
    expect(html).toContain('data-cur-col="');
  });

  it("emits multi-page WW IA when blueprint has home + statement_page templates", () => {
    const dm = mapToDocModel(extraction(), meta);
    const bp = blueprint();
    bp.page_templates.push(
      {
        id: "bp:tpl_home",
        name: "Home",
        shell_html: "<main>{{region:main}}</main>",
        regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }],
      },
      {
        id: "bp:tpl_statement_page",
        name: "Statement page",
        shell_html: "<main>{{region:main}}</main>",
        regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }],
      },
      {
        id: "bp:tpl_prose",
        name: "Prose",
        shell_html: "<main>{{region:main}}</main>",
        regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }],
      },
    );
    const plan = buildSitePlan(dm, bp);
    expect(plan.model).toBe("deterministic-multipage");
    expect(validateSitePlan(plan, bp)).toEqual([]);
    const paths = plan.pages.map((p) => p.path);
    expect(paths).toContain("index.html");
    expect(paths).toContain("commentary.html");
    expect(paths).toContain("financials/income-statement.html");
    expect(paths).toContain("financials/balance-sheet.html");
    expect(paths).toContain("financials/notes.html");
    expect(paths).toContain("administration.html");
    expect(paths).toContain("downloads.html");
    const { files } = renderSitePlan(plan, bp, { extraction: extraction(), docModel: dm });
    expect(files["financials/income-statement.html"]).toContain("site-nav");
    expect(files["financials/income-statement.html"]).toContain("5 053.2");
    expect(files["financials/income-statement.html"]).toContain("breadcrumb");
    expect(files["financials/income-statement.html"]).toContain("page-pager");
    expect(files["financials/income-statement.html"]).toContain("page-hero");
    expect(files["financials/income-statement.html"]).toContain('class="note-ref"');
    expect(files["financials/income-statement.html"]).toContain("notes.html#note-");
    expect(files["financials/income-statement.html"]).toMatch(
      /class="[^"]*\br-(?:section|line|subtotal|total)\b/,
    );
  });

  it("Gate B catches a MAPPER bug (a mis-copied number) against the source extraction", () => {
    const ex = extraction();
    const dm = mapToDocModel(ex, meta);
    // Simulate the mapper corrupting a value (e.g. a bad transform): the cell's
    // src_ref still points at the true source, so the gate must catch the drift.
    const cell = dm.tables[0].rows.flatMap((r) => r.cells).find((c) => c.src_ref === "ext:t_pnl:r4c2")!;
    cell.raw = "1 297.7"; // was 1 927.7
    const bp = blueprint();
    const plan = buildSitePlan(dm, bp);
    const ctx: ResolveContext = { extraction: ex, docModel: dm };
    const { files } = renderSitePlan(plan, bp, ctx);
    const b = gateB(files, ctx);
    expect(b.status).toBe("fail");
    const f = b.failures.find((x) => x.data_src === "ext:t_pnl:r4c2");
    expect(f?.reason).toBe("verbatim-mismatch");
    expect(f?.source_raw).toBe("1 927.7"); // the true source value
  });
});
