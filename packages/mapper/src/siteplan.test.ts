import { describe, expect, it } from "vitest";
import type { Blueprint, FinancialDocModel } from "@rs/contracts";
import { buildSitePlan, classifyDocShape, docModelHasSeparateEntityBooks, planNotePages, noteTopicFromTitle } from "./siteplan.js";
import { noteNumberOf } from "./classify.js";

function cell(raw: string, r = 0, c = 0) {
  return {
    src_ref: `ext:t1:r${r}c${c}`,
    raw,
    kind: "text" as const,
    footnote_refs: [],
  };
}

function stubBlueprint(): Blueprint {
  return {
    schema_version: "blueprint/1",
    blueprint_version_id: "bp_test",
    project_id: "p",
    cycle: 1,
    source_prototype_version_id: "proto",
    source_prototype_sha256: "a".repeat(64),
    checksum: "b".repeat(64),
    locked_at: null,
    tokens: {},
    page_templates: [
      {
        id: "bp:tpl_home",
        name: "Home",
        shell_html: `<main>{{region:main}}</main>`,
        regions: [{ id: "main", accepts: [], min: 0, max: null }],
      },
      {
        id: "bp:tpl_prose",
        name: "Prose",
        shell_html: `<main><div class="prose-body">{{region:main}}</div></main>`,
        regions: [{ id: "main", accepts: [], min: 0, max: null }],
      },
      {
        id: "bp:tpl_statement_page",
        name: "Statement",
        shell_html: `<main>{{region:main}}</main>`,
        regions: [{ id: "main", accepts: ["bp:cmp_statement_table"], min: 0, max: null }],
      },
    ],
    components: [
      {
        id: "bp:cmp_statement_table",
        name: "Statement table",
        html: `<section>{{slot:table}}</section>`,
        css: "",
        slots: { table: { type: "ref", accepts: "table", required: true } },
        variants: [],
      },
    ],
    table_styles: {
      header_bg: "#111",
      header_fg: "#fff",
      current_period_shade: null,
      numeric_alignment: "right",
      zebra: false,
      rule_style: "none",
      negative_number_style: "parens",
      number_grouping: "space",
    },
    chart_theme: {
      palette: [],
      grid_color: "#ccc",
      font_role: "body",
      number_format: { locale: "en-ZA", thousands: " " },
      allowed_chart_kinds: ["bar"],
    },
    print_stylesheet: null,
    a11y: { approved_text_pairs: [] },
    assets: [],
    usage_rules: [],
  } as unknown as Blueprint;
}

function baseDoc(over: Partial<FinancialDocModel> = {}): FinancialDocModel {
  return {
    schema_version: "docmodel/1",
    doc_model_id: "dm_test",
    extraction_id: "ex_test",
    content_hash: "c".repeat(64),
    meta: {
      company: "Test Co",
      period_label: "2025",
      doc_kind: "annual_audited",
      currency: "ZAR",
    },
    sections: [],
    tables: [],
    footnotes: [],
    mapping_review: [],
    ...over,
  };
}

function noteTable(id: string, n: number): FinancialDocModel["tables"][number] {
  return {
    id,
    src_table: `ext:${id}`,
    must_appear: true,
    table_type: "note",
    header_matrix: [[{ raw: `Note ${n}`, col_span: 1, row_span: 1, src_ref: `ext:${id}:h` }]],
    unit_context: { default: "Rm", per_row: {} },
    row_groups: [],
    rows: [{ cells: [cell("Line", 0, 0), cell("1", 0, 1)] }],
  };
}

describe("adaptive siteplan", () => {
  it("keeps compact interim nav without AFS prose pages", () => {
    const dm = baseDoc({
      sections: [
        {
          id: "doc:sec_letter",
          kind: "letter",
          blocks: [
            { kind: "paragraph", text: "Dear Shareholder", src_ref: "ext:p1" },
          ],
          items: [],
        },
      ],
      tables: [
        {
          id: "doc:tbl_1",
          src_table: "ext:t1",
          must_appear: true,
          table_type: "statement",
          header_matrix: [[{ raw: "2025", col_span: 1, row_span: 1, src_ref: "ext:t1:h" }]],
          unit_context: { default: "Rm", per_row: {} },
          row_groups: [],
          rows: [{ cells: [cell("Revenue"), cell("10")] }],
        },
      ],
    });
    // Attach table to statement section so it routes
    dm.sections.push({
      id: "doc:sec_tbl_1",
      kind: "statement",
      statement_type: "pnl_oci",
      title: { text: "Income statement", src_ref: "ext:t1:r0c0" },
      blocks: [{ kind: "table", table_ref: "doc:tbl_1" }],
      items: [],
    });
    const plan = buildSitePlan(dm, stubBlueprint());
    expect(plan.nav.map((n) => n.href)).toEqual([
      "index.html",
      "commentary.html",
      "financials/income-statement.html",
      "financials/balance-sheet.html",
      "financials/changes-in-equity.html",
      "financials/cash-flows.html",
      "financials/notes.html",
      "administration.html",
      "downloads.html",
    ]);
    expect(plan.pages.some((p) => p.path === "directors-report.html")).toBe(false);
    expect(plan.pages.some((p) => /^financials\/notes-\d/.test(p.path))).toBe(false);
  });

  it("expands AFS pages and paginates large note sets", () => {
    const tables = Array.from({ length: 15 }, (_, i) => noteTable(`doc:tbl_n${i + 1}`, i + 1));
    const sections: FinancialDocModel["sections"] = [
      {
        id: "doc:sec_directorsReport",
        kind: "directorsReport",
        title: { text: "Directors' report", src_ref: "ext:dr" },
        blocks: [{ kind: "paragraph", text: "The directors submit their report.", src_ref: "ext:dr1" }],
        items: [],
      },
      {
        id: "doc:sec_auditorReport",
        kind: "auditorReport",
        title: { text: "Independent auditor's report", src_ref: "ext:ar" },
        blocks: [{ kind: "paragraph", text: "We have audited the statements.", src_ref: "ext:ar1" }],
        items: [],
      },
      {
        id: "doc:sec_accountingPolicies",
        kind: "accountingPolicies",
        title: { text: "1. Accounting policies", src_ref: "ext:ap" },
        blocks: [{ kind: "paragraph", text: "Prepared in accordance with IFRS.", src_ref: "ext:ap1" }],
        items: [],
      },
      ...tables.map((t, i) => ({
        id: `doc:sec_tbl_n${i + 1}`,
        kind: "note" as const,
        note_number: i + 1,
        title: { text: `${i + 1}. Note heading`, src_ref: `ext:n${i + 1}` },
        blocks: [{ kind: "table" as const, table_ref: t.id }],
        items: [],
      })),
    ];
    const dm = baseDoc({ tables, sections });
    const plan = buildSitePlan(dm, stubBlueprint());
    expect(plan.nav.some((n) => n.href === "directors-report.html")).toBe(true);
    expect(plan.nav.some((n) => n.href === "auditors-report.html")).toBe(true);
    expect(plan.nav.some((n) => n.href === "financials/accounting-policies.html")).toBe(true);
    expect(plan.nav.some((n) => n.href === "financials/notes.html")).toBe(true);
    expect(plan.pages.filter((p) => /^financials\/notes-\d/.test(p.path)).length).toBeGreaterThan(0);
    expect(plan.pages.length).toBeGreaterThan(12);
  });

  it("classifies interim vs dual-entity AFS shapes", () => {
    const interim = buildSitePlan(
      baseDoc({
        meta: {
          company: "Test Co",
          period_label: "HY1",
          doc_kind: "interim_unaudited",
          currency: "ZAR",
        },
      }),
      stubBlueprint(),
    );
    expect(classifyDocShape(baseDoc({ meta: { company: "T", period_label: "HY1", doc_kind: "interim_unaudited", currency: "ZAR" } }))).toBe(
      "interim_short",
    );
    const dual = baseDoc({
      meta: {
        company: "SPAR",
        period_label: "2025",
        doc_kind: "annual_audited",
        currency: "ZAR",
      },
      tables: [
        {
          id: "doc:tbl_1",
          src_table: "ext:t1",
          must_appear: true,
          table_type: "statement",
          header_matrix: [
            [
              { raw: "GROUP", col_span: 1, row_span: 1, src_ref: "ext:t1:h0" },
              { raw: "COMPANY", col_span: 1, row_span: 1, src_ref: "ext:t1:h1" },
            ],
          ],
          unit_context: { default: "Rm", per_row: {} },
          row_groups: [],
          rows: [{ cells: [cell("Revenue"), cell("10"), cell("9")] }],
        },
      ],
    });
    expect(classifyDocShape(dual)).toBe("afs_dual_entity");
    void interim;
  });

  it("planNotePages returns null for small interim note sets", () => {
    const titleBy = new Map([["doc:tbl_1", "2. Revenue"]]);
    const dm = baseDoc({
      tables: [noteTable("doc:tbl_1", 2)],
      sections: [
        {
          id: "doc:sec_tbl_1",
          kind: "note",
          note_number: 2,
          title: { text: "2. Revenue", src_ref: "ext:n2" },
          blocks: [{ kind: "table", table_ref: "doc:tbl_1" }],
          items: [],
        },
      ],
    });
    expect(planNotePages(dm, ["doc:tbl_1"], titleBy)).toBeNull();
  });

  it("names paginated note groups from extracted note topics", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `doc:tbl_n${i + 1}`);
    const titleBy = new Map(ids.map((id, i) => [id, `${i + 1}. ${i === 0 ? "Revenue" : `Disclosure ${i + 1}`}`]));
    const dm = baseDoc({
      tables: ids.map((id, i) => noteTable(id, i + 1)),
      sections: ids.map((id, i) => ({
        id: `doc:sec_${id}`,
        kind: "note" as const,
        note_number: i + 1,
        title: { text: `${i + 1}. ${i === 0 ? "Revenue" : `Disclosure ${i + 1}`}`, src_ref: `ext:n${i + 1}` },
        blocks: [{ kind: "table" as const, table_ref: id }],
        items: [] as [],
      })),
    });
    const plan = planNotePages(dm, ids, titleBy);
    expect(plan).not.toBeNull();
    expect(plan!.groups[0]?.title).toMatch(/Notes 1–10 — Revenue/);
    expect(plan!.groups[0]?.nav).toMatch(/Revenue/);
    expect(plan!.groups[1]?.title).toMatch(/Notes 11–12 — Disclosure 11/);
  });

  it("skips generic Notes-to-the-Group shell banners when naming groups", () => {
    expect(noteTopicFromTitle("Notes to the Group financial statements (continued)")).toBeNull();
    expect(noteTopicFromTitle("Notes to the Company financial statements")).toBeNull();
    expect(noteTopicFromTitle("1. Accounting policies")).toBe("Accounting policies");

    const ids = Array.from({ length: 12 }, (_, i) => `doc:tbl_n${i + 1}`);
    const titleBy = new Map(
      ids.map((id, i) => [
        id,
        i < 10
          ? `${i + 1}. ${i === 0 ? "Accounting policies" : `Disclosure ${i + 1}`}`
          : "Notes to the Group financial statements (continued)",
      ]),
    );
    const dm = baseDoc({
      tables: ids.map((id, i) => noteTable(id, i + 1)),
      sections: ids.flatMap((id, i) => [
        {
          id: `doc:sec_shell_${id}`,
          kind: "note" as const,
          note_number: i + 1,
          title: { text: "Notes to the Group financial statements (continued)", src_ref: `ext:shell${i + 1}` },
          blocks: [{ kind: "table" as const, table_ref: id }],
          items: [] as [],
        },
        ...(i < 10
          ? [
              {
                id: `doc:sec_${id}`,
                kind: "note" as const,
                note_number: i + 1,
                title: {
                  text: `${i + 1}. ${i === 0 ? "Accounting policies" : `Disclosure ${i + 1}`}`,
                  src_ref: `ext:n${i + 1}`,
                },
                blocks: [{ kind: "table" as const, table_ref: id }],
                items: [] as [],
              },
            ]
          : []),
      ]),
    });
    const plan = planNotePages(dm, ids, titleBy);
    expect(plan).not.toBeNull();
    expect(plan!.groups[0]?.title).toMatch(/Notes 1–10 — Accounting policies/);
    expect(plan!.groups[1]?.title).toBe("Notes 11–12");
    expect(plan!.groups[1]?.title).not.toMatch(/Notes to the Group/i);
  });

  it("parses MTN-style note numbers without a period", () => {
    expect(noteNumberOf("2 RESULTS OF OPERATIONS")).toBe(2);
    expect(noteNumberOf("2 RESULTS OF OPERATIONS (continued)")).toBe(2);
    expect(noteNumberOf("1 ACCOUNTING FRAMEWORK AND CRITICAL JUDGEMENTS")).toBe(1);
    expect(noteNumberOf("2.1 Operating segments")).toBe(2);
    expect(noteNumberOf("Notes to the Group financial statements (continued)")).toBeNull();
  });

  it("splits Group/Company statement books into separate nav entries", () => {
    const tables = [
      {
        id: "doc:tbl_g_pnl",
        src_table: "ext:gpnl",
        must_appear: true,
        table_type: "statement" as const,
        header_matrix: [[{ raw: "2025", col_span: 1, row_span: 1, src_ref: "ext:gpnl:h" }]],
        unit_context: { default: "Rm", per_row: {} },
        row_groups: [],
        rows: [{ cells: [cell("Revenue"), cell("10")] }],
      },
      {
        id: "doc:tbl_c_pnl",
        src_table: "ext:cpnl",
        must_appear: true,
        table_type: "statement" as const,
        header_matrix: [[{ raw: "2025", col_span: 1, row_span: 1, src_ref: "ext:cpnl:h" }]],
        unit_context: { default: "Rm", per_row: {} },
        row_groups: [],
        rows: [{ cells: [cell("Revenue"), cell("3")] }],
      },
    ];
    const sections: FinancialDocModel["sections"] = [
      {
        id: "doc:sec_directorsReport",
        kind: "directorsReport",
        title: { text: "Directors' report", src_ref: "ext:dr" },
        blocks: [{ kind: "paragraph", text: "The directors submit their report.", src_ref: "ext:dr1" }],
        items: [],
      },
      {
        id: "doc:sec_g_pnl",
        kind: "statement",
        statement_type: "pnl_oci",
        title: { text: "Group income statement", src_ref: "ext:gpnl" },
        blocks: [{ kind: "table", table_ref: "doc:tbl_g_pnl" }],
        items: [],
      },
      {
        id: "doc:sec_c_pnl",
        kind: "statement",
        statement_type: "pnl_oci",
        title: { text: "Company statement of comprehensive income", src_ref: "ext:cpnl" },
        blocks: [{ kind: "table", table_ref: "doc:tbl_c_pnl" }],
        items: [],
      },
    ];
    const dm = baseDoc({ tables, sections });
    expect(docModelHasSeparateEntityBooks(dm)).toBe(true);
    expect(classifyDocShape(dm)).toBe("afs_group_company_split");
    const plan = buildSitePlan(dm, stubBlueprint());
    expect(plan.nav.some((n) => n.href === "financials/group/income-statement.html")).toBe(true);
    expect(plan.nav.some((n) => n.href === "financials/company/income-statement.html")).toBe(true);
    expect(plan.nav.some((n) => n.href === "financials/income-statement.html")).toBe(false);
    expect(plan.pages.find((p) => p.path === "financials/group/income-statement.html")?.title).toBe(
      "Group Statement of Profit or Loss",
    );
    expect(plan.nav.find((n) => n.href === "financials/group/income-statement.html")?.label).toBe(
      "Group Statement of Profit or Loss",
    );
  });

  it("uses official IAS/IFRS titles on interim statement pages and nav", () => {
    const dm = baseDoc({
      meta: {
        company: "DRDGOLD Limited",
        period_label: "HY1 FY2026",
        doc_kind: "interim_unaudited",
        currency: "ZAR",
      },
      sections: [
        {
          id: "doc:sec_tbl_1",
          kind: "statement",
          statement_type: "pnl_oci",
          title: {
            text: "Condensed Consolidated Statement of Profit or Loss and Other Comprehensive Income",
            src_ref: "ext:t1:r0c0",
          },
          blocks: [{ kind: "table", table_ref: "doc:tbl_1" }],
          items: [],
        },
      ],
      tables: [
        {
          id: "doc:tbl_1",
          src_table: "ext:t1",
          must_appear: true,
          table_type: "statement",
          header_matrix: [[{ raw: "2025", col_span: 1, row_span: 1, src_ref: "ext:t1:h" }]],
          unit_context: { default: "Rm", per_row: {} },
          row_groups: [],
          rows: [{ cells: [cell("Revenue"), cell("10")] }],
        },
      ],
    });
    const plan = buildSitePlan(dm, stubBlueprint());
    expect(plan.pages.find((p) => p.path === "financials/income-statement.html")?.title).toBe(
      "Condensed Consolidated Statement of Profit or Loss and Other Comprehensive Income",
    );
    expect(plan.nav.find((n) => n.href === "financials/income-statement.html")?.label).toBe(
      "Condensed Consolidated Statement of Profit or Loss and Other Comprehensive Income",
    );
    expect(plan.nav.find((n) => n.href === "financials/balance-sheet.html")?.label).toBe(
      "Condensed Consolidated Statement of Financial Position",
    );
    expect(plan.nav.some((n) => n.label === "Income statement" || n.label === "Balance sheet")).toBe(
      false,
    );
  });

  it("keeps EPS and investment reconciliations on notes, not statement pages", () => {
    const dm = baseDoc({
      meta: {
        company: "DRDGOLD Limited",
        period_label: "HY1 FY2026",
        doc_kind: "interim_unaudited",
        currency: "ZAR",
      },
      sections: [
        {
          id: "doc:sec_pnl",
          kind: "statement",
          statement_type: "pnl_oci",
          title: { text: "Statement of profit or loss", src_ref: "ext:pnl" },
          blocks: [{ kind: "table", table_ref: "doc:tbl_pnl" }],
          items: [],
        },
        {
          id: "doc:sec_eps",
          kind: "note",
          note_number: 4,
          title: { text: "4. Earnings per share", src_ref: "ext:eps" },
          blocks: [{ kind: "table", table_ref: "doc:tbl_eps" }],
          items: [],
        },
        {
          id: "doc:sec_rr",
          kind: "note",
          note_number: 5,
          title: { text: "Reconciliation of investment in Rand Refinery:", src_ref: "ext:rr" },
          blocks: [{ kind: "table", table_ref: "doc:tbl_rr" }],
          items: [],
        },
      ],
      tables: [
        {
          id: "doc:tbl_pnl",
          src_table: "ext:pnl",
          must_appear: true,
          table_type: "statement",
          header_matrix: [[{ raw: "2025", col_span: 1, row_span: 1, src_ref: "ext:pnl:h" }]],
          unit_context: { default: "Rm", per_row: {} },
          row_groups: [],
          rows: [{ cells: [cell("Revenue"), cell("10")] }],
        },
        {
          id: "doc:tbl_eps",
          src_table: "ext:eps",
          must_appear: true,
          table_type: "note",
          header_matrix: [[{ raw: "Note 4", col_span: 1, row_span: 1, src_ref: "ext:eps:h" }]],
          unit_context: { default: "Rm", per_row: {} },
          row_groups: [],
          rows: [{ cells: [cell("Headline earnings"), cell("1 932.4")] }],
        },
        {
          id: "doc:tbl_rr",
          src_table: "ext:rr",
          must_appear: true,
          table_type: "reconciliation",
          header_matrix: [[{ raw: "2025", col_span: 1, row_span: 1, src_ref: "ext:rr:h" }]],
          unit_context: { default: "Rm", per_row: {} },
          row_groups: [],
          rows: [{ cells: [cell("Balance at the beginning of the period"), cell("302.0")] }],
        },
      ],
    });
    const plan = buildSitePlan(dm, stubBlueprint());
    const ids = (path: string) =>
      Object.values(plan.pages.find((p) => p.path === path)!.regions)
        .flat()
        .map((i) => Object.values(i.slots).flat())
        .flat();
    expect(ids("financials/income-statement.html")).toEqual(["doc:tbl_pnl"]);
    expect(ids("financials/income-statement.html")).not.toContain("doc:tbl_eps");
    expect(ids("financials/changes-in-equity.html")).not.toContain("doc:tbl_rr");
    expect(ids("financials/notes.html")).toEqual(expect.arrayContaining(["doc:tbl_eps", "doc:tbl_rr"]));
  });
});
