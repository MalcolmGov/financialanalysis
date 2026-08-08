import { describe, expect, it } from "vitest";
import type {
  Blueprint,
  ExtractionResult,
  FinancialDocModel,
  SitePlan,
} from "@rs/contracts";
import { gateA } from "./gate-a.js";
import { gateB } from "./gate-b.js";
import { linkNoteRefHtml, notesBaseHref, noteHref } from "./notes-linker.js";
import { renderSitePlan } from "./renderer.js";
import type { ResolveContext } from "./resolve.js";
import { classifyStatementRow, groupBorderClass, rowRoleClass } from "./row-taxonomy.js";
import {
  auditStatementIrFidelity,
  checkStatementIrFidelity,
} from "./statement-fidelity.js";

describe("row taxonomy", () => {
  it("classifies section / subtotal / total / line", () => {
    expect(classifyStatementRow("Assets", false)).toBe("section");
    expect(classifyStatementRow("Equity and liabilities", false)).toBe("section");
    expect(classifyStatementRow("Non-current assets", true)).toBe("subtotal");
    expect(classifyStatementRow("Current liabilities", true)).toBe("subtotal");
    expect(classifyStatementRow("Total assets", true)).toBe("total");
    expect(classifyStatementRow("Total equity and liabilities", true)).toBe("total");
    expect(classifyStatementRow("Property plant and equipment", true)).toBe("line");
    expect(rowRoleClass("subtotal")).toBe("r-subtotal bd-blue");
    expect(rowRoleClass("section")).toBe("r-section bd-tan");
    expect(rowRoleClass("total")).toBe("r-total");
  });

  it("marks grp / grp-top / grp-bot edges", () => {
    expect(groupBorderClass("line", "section", "line")).toContain("grp-top");
    expect(groupBorderClass("line", "line", "total")).toContain("grp-bot");
    expect(groupBorderClass("total", "line", null)).toContain("grp-bot");
  });
});

describe("notes linker", () => {
  it("builds relative note hrefs from page path", () => {
    expect(notesBaseHref("financials/balance-sheet.html")).toBe("notes.html");
    expect(notesBaseHref("financials/notes.html")).toBeNull();
    expect(notesBaseHref("statements/index.html")).toBe("../financials/notes.html");
    expect(noteHref("notes.html", 2)).toBe("notes.html#note-2");
  });

  it("links single and multi note refs without rewriting digits", () => {
    const esc = (s: string) => s.replace(/&/g, "&amp;");
    expect(linkNoteRefHtml("2", "notes.html", esc)).toBe(
      '<a class="note-ref" href="notes.html#note-2">2</a>',
    );
    expect(linkNoteRefHtml("5, 8", "notes.html", esc)).toBe(
      '<a class="note-ref" href="notes.html#note-5">5</a>, <a class="note-ref" href="notes.html#note-8">8</a>',
    );
  });
});

function bsExtraction(): ExtractionResult {
  const cells = [
    { r: 0, c: 0, row_span: 1, col_span: 1, text: "", is_col_header: true, is_row_header: false, is_section: false },
    { r: 0, c: 1, row_span: 1, col_span: 1, text: "Notes", is_col_header: true, is_row_header: false, is_section: false },
    {
      r: 0,
      c: 2,
      row_span: 1,
      col_span: 1,
      text: "As at 31 Dec 2025 Rm Unaudited",
      is_col_header: true,
      is_row_header: false,
      is_section: false,
    },
    {
      r: 0,
      c: 3,
      row_span: 1,
      col_span: 1,
      text: "As at 30 Jun 2025 Rm Audited",
      is_col_header: true,
      is_row_header: false,
      is_section: false,
    },
    { r: 1, c: 0, row_span: 1, col_span: 1, text: "Assets", is_col_header: false, is_row_header: true, is_section: true },
    { r: 1, c: 1, row_span: 1, col_span: 1, text: "", is_col_header: false, is_row_header: false, is_section: false },
    { r: 1, c: 2, row_span: 1, col_span: 1, text: "", is_col_header: false, is_row_header: false, is_section: false },
    { r: 1, c: 3, row_span: 1, col_span: 1, text: "", is_col_header: false, is_row_header: false, is_section: false },
    {
      r: 2,
      c: 0,
      row_span: 1,
      col_span: 1,
      text: "Property plant and equipment",
      is_col_header: false,
      is_row_header: true,
      is_section: false,
    },
    { r: 2, c: 1, row_span: 1, col_span: 1, text: "2", is_col_header: false, is_row_header: false, is_section: false },
    { r: 2, c: 2, row_span: 1, col_span: 1, text: "10 027.2", is_col_header: false, is_row_header: false, is_section: false },
    { r: 2, c: 3, row_span: 1, col_span: 1, text: "8 542.2", is_col_header: false, is_row_header: false, is_section: false },
    {
      r: 3,
      c: 0,
      row_span: 1,
      col_span: 1,
      text: "Total assets",
      is_col_header: false,
      is_row_header: true,
      is_section: false,
    },
    { r: 3, c: 1, row_span: 1, col_span: 1, text: "", is_col_header: false, is_row_header: false, is_section: false },
    { r: 3, c: 2, row_span: 1, col_span: 1, text: "14 639.9", is_col_header: false, is_row_header: false, is_section: false },
    { r: 3, c: 3, row_span: 1, col_span: 1, text: "12 246.0", is_col_header: false, is_row_header: false, is_section: false },
  ];
  return {
    schema_version: "1.0",
    extraction_id: "ext_bs",
    org_id: "o",
    project_id: "p",
    source: {
      blob_path: "s.pdf",
      sha256: "a".repeat(64),
      size_bytes: 1,
      page_count: 10,
      pdf_meta: { title: "", producer: "Workiva", created: "", modified: "" },
    },
    engine: {
      docling_version: "2.x",
      backend: "docling_parse_v4",
      table_mode: "accurate",
      ocr_applied: false,
      ocr_engine: null,
    },
    pages: [],
    body: [],
    furniture: [],
    tables: {
      t_bs: { id: "t_bs", caption_block: null, prov: [], num_rows: 4, num_cols: 4, cells, column_roles: null },
    },
    figures: {},
    warnings: [],
    enrichment: { sections: [], key_figures: [], numeric_annotations: {} },
  } as ExtractionResult;
}

function bsDocModel(): FinancialDocModel {
  return {
    schema_version: "docmodel/1",
    doc_model_id: "dm_bs",
    extraction_id: "ext_bs",
    content_hash: "b".repeat(64),
    meta: {
      company: "DRDGOLD Limited",
      period_label: "HY1 FY2026",
      doc_kind: "interim_unaudited",
      currency: "ZAR",
    },
    sections: [
      {
        id: "doc:sec_bs",
        kind: "statement",
        statement_type: "financial_position",
        blocks: [],
        items: [],
      },
    ],
    tables: [
      {
        id: "doc:tbl_bs",
        src_table: "ext:t_bs",
        must_appear: true,
        table_type: "statement",
        header_matrix: [
          [
            { raw: "", col_span: 1, row_span: 1, src_ref: "ext:t_bs:r0c0" },
            { raw: "Notes", col_span: 1, row_span: 1, src_ref: "ext:t_bs:r0c1" },
            {
              raw: "As at 31 Dec 2025 Rm Unaudited",
              col_span: 1,
              row_span: 1,
              src_ref: "ext:t_bs:r0c2",
            },
            {
              raw: "As at 30 Jun 2025 Rm Audited",
              col_span: 1,
              row_span: 1,
              src_ref: "ext:t_bs:r0c3",
            },
          ],
        ],
        unit_context: { default: "Rm", per_row: {} },
        row_groups: [],
        rows: [
          {
            cells: [
              { src_ref: "ext:t_bs:r1c0", raw: "Assets", kind: "text", footnote_refs: [] },
              { src_ref: "ext:t_bs:r1c1", raw: "", kind: "nil", footnote_refs: [] },
              { src_ref: "ext:t_bs:r1c2", raw: "", kind: "nil", footnote_refs: [] },
              { src_ref: "ext:t_bs:r1c3", raw: "", kind: "nil", footnote_refs: [] },
            ],
          },
          {
            cells: [
              {
                src_ref: "ext:t_bs:r2c0",
                raw: "Property plant and equipment",
                kind: "text",
                footnote_refs: [],
              },
              { src_ref: "ext:t_bs:r2c1", raw: "2", kind: "noteRef", footnote_refs: [] },
              { src_ref: "ext:t_bs:r2c2", raw: "10 027.2", kind: "number", footnote_refs: [] },
              { src_ref: "ext:t_bs:r2c3", raw: "8 542.2", kind: "number", footnote_refs: [] },
            ],
          },
          {
            cells: [
              { src_ref: "ext:t_bs:r3c0", raw: "Total assets", kind: "text", footnote_refs: [] },
              { src_ref: "ext:t_bs:r3c1", raw: "", kind: "nil", footnote_refs: [] },
              { src_ref: "ext:t_bs:r3c2", raw: "14 639.9", kind: "number", footnote_refs: [] },
              { src_ref: "ext:t_bs:r3c3", raw: "12 246.0", kind: "number", footnote_refs: [] },
            ],
          },
        ],
      },
    ],
    footnotes: [],
    mapping_review: [],
  } as FinancialDocModel;
}

function bsBlueprint(): Blueprint {
  return {
    schema_version: "1.0",
    blueprint_version_id: "bpv_bs",
    project_id: "p",
    cycle: 1,
    source_prototype_version_id: "pv_1",
    source_prototype_sha256: "a".repeat(64),
    status: "locked",
    locked_at: null,
    locked_by: null,
    checksum: "c".repeat(64),
    tokens: {
      css: ":root{--dna-ink:#231F20;--dna-brand:#FCAF17;--dna-table-header-bg:#839097}",
      values: {},
    },
    typography: { font_faces: [], ramp: [] },
    breakpoints: [],
    navigation: { model: "sticky", items: [] },
    page_templates: [
      {
        id: "bp:tpl_statement",
        name: "Statement",
        shell_html: '<main data-dna-component="page-shell">{{region:main}}</main>',
        regions: [{ id: "main", accepts: ["bp:cmp_FinTableBlock"], min: 0, max: null }],
      },
    ],
    components: [
      {
        id: "bp:cmp_FinTableBlock",
        name: "Statement table",
        html: '<section class="statement-table" data-dna-component="statement-table">{{slot:table}}</section>',
        css: "",
        slots: { table: { type: "ref", accepts: "table", required: true } },
        variants: [],
      },
    ],
    table_styles: {
      header_bg: "",
      header_fg: "",
      current_period_shade: null,
      numeric_alignment: "right",
      zebra: false,
      rule_style: "hairline",
      negative_number_style: "parens",
      number_grouping: "space",
    },
    chart_theme: {
      palette: [],
      grid_color: "",
      font_role: "body",
      number_format: { locale: "en-ZA", thousands: " " },
      allowed_chart_kinds: ["groupedBar"],
    },
    print_stylesheet: null,
    a11y: { approved_text_pairs: [] },
    assets: [],
    usage_rules: [],
  } as Blueprint;
}

function bsPlan(): SitePlan {
  return {
    schema_version: "siteplan/1",
    site_plan_id: "sp_bs",
    doc_model_id: "dm_bs",
    blueprint_version_id: "bpv_bs",
    blueprint_checksum: "c".repeat(64),
    model: "claude-sonnet-5",
    iteration: 1,
    nav: [{ label: "Balance sheet", href: "financials/balance-sheet.html" }],
    pages: [
      {
        path: "financials/balance-sheet.html",
        template: "bp:tpl_statement",
        title: "Statement of financial position",
        regions: {
          main: [{ component: "bp:cmp_FinTableBlock", slots: { table: "doc:tbl_bs" } }],
        },
        downloads: [],
      },
    ],
    validation: { status: "unvalidated", errors: [] },
  } as SitePlan;
}

describe("P2 statement IR render fidelity", () => {
  const ctx = (): ResolveContext => ({
    extraction: bsExtraction(),
    docModel: bsDocModel(),
  });

  it("emits sticky stacked headers, cur col, row roles, note links, unit, print CSS", () => {
    const plan = bsPlan();
    const { files } = renderSitePlan(plan, bsBlueprint(), ctx());
    const html = files["financials/balance-sheet.html"]!;

    expect(html).toContain("/* rs-statement-ir */");
    expect(html).toContain("/* end-rs-statement-ir */");
    expect(html).toContain('data-cur-col="3"');
    expect(html).toMatch(/class="[^"]*\bh-fig\b[^"]*\bcur\b|class="[^"]*\bcur\b[^"]*\bh-fig\b/);
    expect(html).toContain("h-fig__date");
    expect(html).toContain("h-fig__unit");
    expect(html).toContain("h-fig__audit");
    expect(html).toContain("As at<br>");
    expect(html).toContain("r-section bd-tan");
    expect(html).toContain("r-line");
    expect(html).toContain("r-total");
    expect(html).toContain("grp-top");
    expect(html).toContain("bd-tan");
    expect(html).toContain('class="note-ref"');
    expect(html).toContain("notes.html#note-2");
    expect(html).toContain("statement-unit");
    expect(html).toContain(">Rm<");
    expect(html).toContain("10 027.2");
    expect(html).toContain("14 639.9");
    expect(html).toContain("@media print");
    expect(html).toContain("print-color-adjust");
    expect(html).toContain("position:sticky");
    expect(html).toContain("border-top:2px solid var(--dna-brand");

    const audit = checkStatementIrFidelity(html, "financials/balance-sheet.html");
    expect(audit.every((f) => f.ok)).toBe(true);
    expect(auditStatementIrFidelity(files).ok).toBe(true);
  });

  it("keeps Gate A/B green with verbatim figures", () => {
    const c = ctx();
    const plan = bsPlan();
    const { files } = renderSitePlan(plan, bsBlueprint(), c);
    expect(gateA(plan, c).status).toBe("pass");
    const b = gateB(files, c);
    expect(b.status).toBe("pass");
    expect(b.failures).toEqual([]);
  });
});
