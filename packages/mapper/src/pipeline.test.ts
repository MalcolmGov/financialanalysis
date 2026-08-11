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
    expect(dm.sections.find((s) => s.blocks.some((b) => b.table_ref === dm.tables[0]!.id))?.kind).toBe(
      "reviewOfOperations",
    );
    expect(dm.tables[0]!.unit_context.default).toBe("");
    expect(dm.tables[0]!.rows[0]!.cells[2]!.raw).toBe("980 042");
    expect(dm.tables[0]!.rows[1]!.cells[1]!.raw).toBe("US$ per oz");
  });

  it("places ops facts tables on commentary, not income-statement", () => {
    const opsCells: Cell[] = [
      h(0, 0, "Review Of Operations"),
      h(0, 2, "Six months ended 31 Dec 2025"),
      h(0, 3, "Six months ended 31 Dec 2024"),
      h(0, 4, "% change 1"),
      rh(1, 0, "Cash operating costs"),
      d(1, 1, "R per kg"),
      d(1, 2, "980 042"),
      d(1, 3, "866 221"),
      d(1, 4, "13"),
      rh(2, 0, "Cash operating costs"),
      d(2, 1, "US$ per oz"),
      d(2, 2, "1 756"),
      d(2, 3, "1 502"),
      d(2, 4, "17"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      tables: {
        ...extraction().tables,
        t_ops: {
          id: "t_ops",
          caption_block: null,
          prov: [],
          num_rows: 3,
          num_cols: 5,
          cells: opsCells,
          column_roles: null,
        },
      },
      body: [
        {
          id: "blk-ops",
          type: "heading",
          text: "Review of operations",
          children: [],
        },
        {
          id: "blk-ops-p",
          type: "paragraph",
          text: "Gold production at Ergo was lower year on year.",
          children: [],
        },
      ],
    } as ExtractionResult;
    const dm = mapToDocModel(ex, meta);
    const bp = blueprint();
    bp.page_templates.push(
      {
        id: "bp:tpl_home",
        name: "Home",
        shell_html: '<main class="page-home"><div class="home-body">{{region:main}}</div></main>',
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
        shell_html: '<main class="page-prose"><div class="prose-body">{{region:main}}</div></main>',
        regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }],
      },
    );
    const plan = buildSitePlan(dm, bp);
    const opsTable = dm.tables.find((t) => t.table_type === "facts")!;
    const commentaryPage = plan.pages.find((p) => p.path === "commentary.html")!;
    const isPage = plan.pages.find((p) => p.path === "financials/income-statement.html")!;
    const commentaryIds = Object.values(commentaryPage.regions)
      .flat()
      .flatMap((inst) => Object.values(inst.slots).filter((v): v is string => typeof v === "string"));
    const isIds = Object.values(isPage.regions)
      .flat()
      .flatMap((inst) => Object.values(inst.slots).filter((v): v is string => typeof v === "string"));
    expect(commentaryIds).toContain(opsTable.id);
    expect(isIds).not.toContain(opsTable.id);

    const ctx: ResolveContext = { extraction: ex, docModel: dm };
    const a = gateA(plan, ctx);
    expect(a.status).toBe("pass");
    const { files } = renderSitePlan(plan, bp, ctx);
    const b = gateB(files, ctx);
    expect(b.status).toBe("pass");
    expect(files["financials/income-statement.html"]).toContain("5 053.2");
    expect(files["financials/income-statement.html"]).not.toContain("980 042");
    expect(files["financials/income-statement.html"]).not.toContain(
      'data-dna-component="commentary-ops-tables"',
    );
    expect(files["commentary.html"]).toContain("980 042");
    expect(files["commentary.html"]).toContain('data-dna-component="commentary-ops-tables"');
    expect(files["commentary.html"]).toContain('id="operations"');
    expect(files["commentary.html"]).toMatch(/<col class="c-unit">/);
    expect(files["commentary.html"]).toContain("R per kg");
    expect(files["commentary.html"]).toMatch(
      /id="operations"[\s\S]*data-dna-component="commentary-ops-tables"[\s\S]*980 042/,
    );
    // injectInto must replace the whole prose-body (not truncate at nested </section>)
    expect(files["commentary.html"]).not.toMatch(/<\/section>\s*<\/section>/);
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

  it("treats MTN-style subsection note refs as noteRef, not numbers", () => {
    const cells: Cell[] = [
      h(0, 0, ""),
      h(0, 1, "Notes"),
      h(0, 2, "Year ended 31 December 2024"),
      h(0, 3, "Year ended 31 December 2023"),
      rh(1, 0, "Revenue"),
      d(1, 1, "2.1"),
      d(1, 2, "5 053.2"),
      d(1, 3, "3 802.3"),
      rh(2, 0, "Other income"),
      d(2, 1, "2.1; 2.2"),
      d(2, 2, "116.6"),
      d(2, 3, "132.8"),
      rh(3, 0, "Finance costs"),
      d(3, 1, "–"),
      d(3, 2, "(490.5)"),
      d(3, 3, "(200.1)"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      tables: {
        t_pnl: {
          id: "t_pnl",
          caption_block: "PnL",
          prov: [],
          num_rows: 4,
          num_cols: 4,
          cells,
          column_roles: null,
        },
      },
    };
    const dm = mapToDocModel(ex, meta);
    const row0 = dm.tables[0]!.rows[0]!.cells;
    const row1 = dm.tables[0]!.rows[1]!.cells;
    const row2 = dm.tables[0]!.rows[2]!.cells;
    expect(row0[1]!.raw).toBe("2.1");
    expect(row0[1]!.kind).toBe("noteRef");
    expect(row0[1]!.note_number).toBe(2);
    expect(row0[2]!.kind).toBe("number");
    expect(row1[1]!.raw).toBe("2.1; 2.2");
    expect(row1[1]!.kind).toBe("noteRef");
    expect(row1[1]!.note_number).toBe(2);
    expect(row2[1]!.kind).toBe("nil");
    // Period figures must stay numbers (not swallowed by note-ref heuristic).
    expect(row0[2]!.raw).toBe("5 053.2");
    expect(row0[2]!.kind).toBe("number");
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
    expect(paths).toContain("statements/index.html");
    expect(plan.pages.find((p) => p.path === "statements/index.html")?.title).toBe(
      "All tables",
    );
    expect(plan.nav.some((n) => n.href.startsWith("statements/"))).toBe(false);
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
    const agg = files["statements/index.html"]!;
    expect(agg).toContain("All tables");
    expect(agg).toContain("Secondary · aggregate view");
    expect(agg).toContain("statements-aggregate");
    expect(agg).toContain('name="robots" content="noindex,follow"');
    expect(agg).toContain("../financials/income-statement.html");
  });

  it("routes dual-entity AFS tables by nearest heading (not GROUP row-0)", () => {
    const pnl: Cell[] = [
      h(0, 2, "GROUP"),
      h(0, 4, "COMPANY"),
      h(1, 1, "Notes"),
      h(1, 2, "26 September 2025"),
      h(1, 3, "30 September 2024"),
      h(1, 4, "26 September 2025"),
      h(1, 5, "30 September 2024"),
      rh(2, 0, "Continuing operations"),
      rh(3, 0, "Revenue - sale of merchandise"),
      d(3, 1, "1"),
      d(3, 2, "100.0"),
      d(3, 3, "90.0"),
      d(3, 4, "80.0"),
      d(3, 5, "70.0"),
    ];
    const bs: Cell[] = [
      h(0, 2, "GROUP"),
      h(0, 4, "COMPANY"),
      h(1, 1, "Notes"),
      h(1, 2, "26 September 2025"),
      h(1, 3, "30 September 2024"),
      h(1, 4, "26 September 2025"),
      h(1, 5, "30 September 2024"),
      rh(2, 0, "ASSETS"),
      rh(3, 0, "Non-current assets"),
      d(3, 1, "2"),
      d(3, 2, "200.0"),
      d(3, 3, "180.0"),
      d(3, 4, "150.0"),
      d(3, 5, "140.0"),
    ];
    const cf: Cell[] = [
      h(0, 2, "GROUP"),
      h(0, 4, "COMPANY"),
      h(1, 1, "Notes"),
      h(1, 2, "26 September 2025"),
      h(1, 3, "30 September 2024"),
      h(1, 4, "26 September 2025"),
      h(1, 5, "30 September 2024"),
      rh(2, 0, "CASH FLOWS FROM OPERATING ACTIVITIES"),
      rh(3, 0, "Cash generated from operations"),
      d(3, 1, "3"),
      d(3, 2, "50.0"),
      d(3, 3, "40.0"),
      d(3, 4, "30.0"),
      d(3, 5, "20.0"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      body: [
        {
          id: "h-pnl",
          type: "heading",
          text: "Statement of profit or loss and other comprehensive income",
          prov: [{ page_no: 14, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          children: [],
        },
        {
          id: "h-bs",
          type: "heading",
          text: "Statement of financial position",
          prov: [{ page_no: 15, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          children: [],
        },
        {
          id: "h-cf",
          type: "heading",
          text: "Statement of cash flows",
          prov: [{ page_no: 18, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          children: [],
        },
      ],
      tables: {
        t_pnl: {
          id: "t_pnl",
          caption_block: null,
          prov: [{ page_no: 14, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          num_rows: 4,
          num_cols: 6,
          cells: pnl,
          column_roles: null,
        },
        t_bs: {
          id: "t_bs",
          caption_block: null,
          prov: [{ page_no: 15, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          num_rows: 4,
          num_cols: 6,
          cells: bs,
          column_roles: null,
        },
        t_cf: {
          id: "t_cf",
          caption_block: null,
          prov: [{ page_no: 18, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          num_rows: 4,
          num_cols: 6,
          cells: cf,
          column_roles: null,
        },
      },
    };
    const dm = mapToDocModel(ex, meta);
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
    const ids = (path: string) =>
      Object.values(plan.pages.find((p) => p.path === path)!.regions)
        .flat()
        .map((i) => Object.values(i.slots).flat())
        .flat();
    const pnlId = dm.tables.find((_, i) =>
      dm.sections.some(
        (s) => s.statement_type === "pnl_oci" && s.blocks.some((b) => b.kind === "table" && b.table_ref === dm.tables[i]!.id),
      ),
    )!.id;
    const bsId = dm.tables.find((_, i) =>
      dm.sections.some(
        (s) =>
          s.statement_type === "financial_position" &&
          s.blocks.some((b) => b.kind === "table" && b.table_ref === dm.tables[i]!.id),
      ),
    )!.id;
    const cfId = dm.tables.find((_, i) =>
      dm.sections.some(
        (s) =>
          s.statement_type === "cash_flows" &&
          s.blocks.some((b) => b.kind === "table" && b.table_ref === dm.tables[i]!.id),
      ),
    )!.id;
    expect(ids("financials/income-statement.html")).toContain(pnlId);
    expect(ids("financials/balance-sheet.html")).toContain(bsId);
    expect(ids("financials/cash-flows.html")).toContain(cfId);
    expect(ids("financials/balance-sheet.html")).not.toContain(pnlId);
    expect(ids("financials/income-statement.html")).not.toContain(bsId);
  });


  it("does not let a prior Group Operational heading steal later statement tables (DRD)", () => {
    const cell = (
      r: number,
      c: number,
      text: string,
      flags: Partial<{ is_col_header: boolean; is_row_header: boolean; is_section: boolean }> = {},
    ): Cell => ({
      r,
      c,
      row_span: 1,
      col_span: 1,
      text,
      is_col_header: flags.is_col_header ?? r === 0,
      is_row_header: flags.is_row_header ?? (c === 0 && r > 0),
      is_section: flags.is_section ?? false,
    });
    const pnl: Cell[] = [
      cell(0, 0, "Statement of Profit or Loss and Other Comprehensive Income"),
      cell(0, 1, "Six months ended 31 Dec 2025 Rm Unaudited"),
      cell(0, 2, "Six months ended 31 Dec 2024 Rm Unaudited"),
      cell(1, 0, "Revenue"),
      cell(1, 1, "5 053.2"),
      cell(1, 2, "3 802.3"),
      cell(2, 0, 'Other comprehensive income ("OCI")', { is_section: true }),
      cell(2, 1, ""),
      cell(2, 2, ""),
    ];
    const bs: Cell[] = [
      cell(0, 0, "Statement of Financial Position"),
      cell(0, 1, "As at 31 Dec 2025 Rm Unaudited"),
      cell(0, 2, "As at 30 Jun 2025 Rm Audited"),
      cell(1, 0, "Assets", { is_section: true }),
      cell(1, 1, ""),
      cell(1, 2, ""),
      cell(2, 0, "Total assets"),
      cell(2, 1, "14 639.9"),
      cell(2, 2, "12 246.0"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      body: [
        {
          id: "h-ops",
          type: "heading",
          text: "Group Operational, Financial and ESG Performance Summary",
          prov: [{ page_no: 3, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          children: [],
        },
        {
          id: "h-stub",
          type: "heading",
          text: "Condensed Consolidated",
          prov: [{ page_no: 5, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          children: [],
        },
      ],
      tables: {
        t_pnl: {
          id: "t_pnl",
          caption_block: null,
          prov: [{ page_no: 5, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          num_rows: 3,
          num_cols: 3,
          cells: pnl,
          column_roles: null,
        },
        t_bs: {
          id: "t_bs",
          caption_block: null,
          prov: [{ page_no: 5, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          num_rows: 3,
          num_cols: 3,
          cells: bs,
          column_roles: null,
        },
      },
    };
    const dm = mapToDocModel(ex, meta);
    const pnlSec = dm.sections.find(
      (s) => s.statement_type === "pnl_oci" && s.blocks.some((b) => b.kind === "table"),
    );
    const bsSec = dm.sections.find(
      (s) =>
        s.statement_type === "financial_position" &&
        s.blocks.some((b) => b.kind === "table"),
    );
    expect(pnlSec?.kind).toBe("statement");
    expect(bsSec?.kind).toBe("statement");
    expect(pnlSec?.title?.text).toMatch(/Profit or Loss/i);
    expect(bsSec?.title?.text).toMatch(/Financial Position/i);

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
    const ids = (path: string) =>
      Object.values(plan.pages.find((p) => p.path === path)!.regions)
        .flat()
        .map((i) => Object.values(i.slots).flat())
        .flat();
    const pnlId = pnlSec!.blocks.find((b) => b.kind === "table")!.table_ref!;
    const bsId = bsSec!.blocks.find((b) => b.kind === "table")!.table_ref!;
    expect(ids("financials/income-statement.html")).toContain(pnlId);
    expect(ids("financials/balance-sheet.html")).toContain(bsId);
    expect(ids("financials/income-statement.html")).not.toContain(bsId);
  });

  it("does not let a stale statement marker steal EPS / investment recon note tables (DRD)", () => {
    const cell = (
      r: number,
      c: number,
      text: string,
      flags: Partial<{ is_col_header: boolean; is_row_header: boolean }> = {},
    ): Cell => ({
      r,
      c,
      row_span: 1,
      col_span: 1,
      text,
      is_col_header: flags.is_col_header ?? r === 0,
      is_row_header: flags.is_row_header ?? (c === 0 && r > 0),
      is_section: false,
    });
    const eps: Cell[] = [
      cell(0, 0, "4. Earnings per share"),
      cell(0, 1, "Six months ended 31 Dec 2025 Rm Unaudited"),
      cell(0, 2, "Six months ended 31 Dec 2024 Rm Unaudited"),
      cell(1, 0, "Profit for the period"),
      cell(1, 1, "1 927.7"),
      cell(1, 2, "970.1"),
      cell(2, 0, "Headline earnings"),
      cell(2, 1, "1 932.4"),
      cell(2, 2, "970.1"),
    ];
    const recon: Cell[] = [
      cell(0, 0, "Reconciliation of investment in Rand Refinery:"),
      cell(0, 1, "Six months ended 31 Dec 2025 Rm Unaudited"),
      cell(0, 2, "Six months ended 31 Dec 2024 Rm Unaudited"),
      cell(1, 0, "Balance at the beginning of the period"),
      cell(1, 1, "302.0"),
      cell(1, 2, "166.8"),
    ];
    const ex: ExtractionResult = {
      ...extraction(),
      body: [
        {
          id: "h-cf",
          type: "heading",
          text: "Condensed Consolidated Statement of Cash Flows",
          prov: [{ page_no: 8, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          children: [],
        },
      ],
      tables: {
        t_eps: {
          id: "t_eps",
          caption_block: null,
          prov: [{ page_no: 10, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          num_rows: 3,
          num_cols: 3,
          cells: eps,
          column_roles: null,
        },
        t_rr: {
          id: "t_rr",
          caption_block: null,
          prov: [{ page_no: 11, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
          num_rows: 2,
          num_cols: 3,
          cells: recon,
          column_roles: null,
        },
      },
    };
    const dm = mapToDocModel(ex, meta);
    const epsSec = dm.sections.find((s) =>
      s.blocks.some((b) => b.kind === "table" && b.table_ref === dm.tables[0]!.id),
    );
    const rrSec = dm.sections.find((s) =>
      s.blocks.some((b) => b.kind === "table" && b.table_ref === dm.tables[1]!.id),
    );
    expect(epsSec?.kind).toBe("note");
    expect(epsSec?.statement_type).toBeUndefined();
    expect(epsSec?.note_number).toBe(4);
    expect(rrSec?.kind).toBe("note");
    expect(rrSec?.statement_type).toBeUndefined();

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
    const ids = (path: string) =>
      Object.values(plan.pages.find((p) => p.path === path)!.regions)
        .flat()
        .map((i) => Object.values(i.slots).flat())
        .flat();
    expect(ids("financials/notes.html")).toEqual(
      expect.arrayContaining([dm.tables[0]!.id, dm.tables[1]!.id]),
    );
    expect(ids("financials/income-statement.html")).not.toContain(dm.tables[0]!.id);
    expect(ids("financials/changes-in-equity.html")).not.toContain(dm.tables[1]!.id);
    expect(ids("financials/cash-flows.html")).not.toContain(dm.tables[0]!.id);
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
