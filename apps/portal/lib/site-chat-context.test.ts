import type { ExtractionResult, FinancialDocModel } from "@rs/contracts";
import { describe, expect, it } from "vitest";
import {
  buildExtractionEvidence,
  pagePathAffinities,
  SITE_CHAT_EXTRACTION_CHAR_BUDGET,
} from "./site-chat-context";
import { buildSiteChatUserPayload, SITE_CHAT_SYSTEM } from "./site-chat";

function stubExtraction(): ExtractionResult {
  return {
    schema_version: "1.0",
    extraction_id: "ext_mtn_chat",
    org_id: "org",
    project_id: "proj",
    source: {
      blob_path: "docs/mtn.pdf",
      sha256: "a".repeat(64),
      size_bytes: 1000,
      page_count: 4,
      pdf_meta: {
        title: "MTN Group Limited Annual Financial Statements 2025",
        producer: "",
        created: "",
        modified: "",
      },
    },
    engine: {
      docling_version: "1",
      backend: "test",
      table_mode: "accurate",
      ocr_applied: false,
      ocr_engine: null,
    },
    pages: [
      {
        page_no: 1,
        width_pt: 595,
        height_pt: 842,
        image: {
          blob_path: "p1.png",
          width_px: 1,
          height_px: 1,
          scale: 1,
          px_per_pt: 1,
        },
      },
    ],
    body: [
      {
        id: "b1",
        type: "heading",
        text: "Independent auditor's report",
        prov: [{ page_no: 2, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
        children: [],
      },
      {
        id: "b2",
        type: "paragraph",
        text: "We have audited the consolidated financial statements of MTN Group Limited.",
        prov: [{ page_no: 2, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
        children: [],
      },
      {
        id: "b3",
        type: "paragraph",
        text: "Revenue from contracts with customers was R 210 000 million.",
        prov: [{ page_no: 3, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
        children: [],
      },
    ],
    furniture: [],
    tables: {
      t_pnl: {
        id: "t_pnl",
        caption_block: null,
        prov: [{ page_no: 3, bbox: { l: 0, t: 0, r: 1, b: 1 } }],
        num_rows: 2,
        num_cols: 3,
        cells: [
          {
            r: 0,
            c: 0,
            row_span: 1,
            col_span: 1,
            text: "Revenue",
            is_col_header: false,
            is_row_header: true,
            is_section: false,
          },
          {
            r: 0,
            c: 1,
            row_span: 1,
            col_span: 1,
            text: "210 000",
            is_col_header: false,
            is_row_header: false,
            is_section: false,
          },
          {
            r: 0,
            c: 2,
            row_span: 1,
            col_span: 1,
            text: "198 000",
            is_col_header: false,
            is_row_header: false,
            is_section: false,
          },
        ],
        column_roles: null,
      },
    },
    figures: {},
    warnings: [],
    enrichment: {
      sections: [
        {
          id: "s_aud",
          title: "Independent auditor's report",
          level: 1,
          page_span: [2, 2],
          block_ids: ["b1", "b2"],
        },
        {
          id: "s_pnl",
          title: "Consolidated income statement",
          level: 1,
          page_span: [3, 3],
          block_ids: ["b3"],
        },
      ],
      key_figures: [
        {
          id: "kf1",
          label: "Revenue",
          value_raw: "R 210 000 million",
          src_ref: "ext:t_pnl:r0c1",
          page: 3,
        },
      ],
      numeric_annotations: {},
    },
  } as ExtractionResult;
}

function stubDocModel(): FinancialDocModel {
  return {
    schema_version: "docmodel/1",
    doc_model_id: "dm_chat",
    extraction_id: "ext_mtn_chat",
    content_hash: "a".repeat(64),
    meta: {
      company: "MTN Group Limited",
      period_label: "for the year ended 31 December 2025",
      doc_kind: "annual_audited",
      currency: "ZAR",
    },
    sections: [
      {
        id: "doc:sec_aud",
        kind: "auditorReport",
        title: { text: "Independent auditor's report", src_ref: "ext:b1" },
        blocks: [
          {
            kind: "paragraph",
            text: "We have audited the consolidated financial statements of MTN Group Limited.",
            src_ref: "ext:b2",
          },
        ],
        items: [],
      },
      {
        id: "doc:sec_pnl",
        kind: "statement",
        statement_type: "pnl_oci",
        title: { text: "Group — Income statement", src_ref: "ext:t_pnl:r0c0" },
        blocks: [{ kind: "table", table_ref: "doc:tbl_1" }],
        items: [],
      },
      {
        id: "doc:sec_n1",
        kind: "note",
        note_number: 1,
        title: { text: "1. Accounting framework", src_ref: "ext:n1" },
        blocks: [
          {
            kind: "paragraph",
            text: "These financial statements have been prepared in accordance with IFRS.",
            src_ref: "ext:n1p",
          },
        ],
        items: [],
      },
    ],
    tables: [
      {
        id: "doc:tbl_1",
        src_table: "ext:t_pnl",
        must_appear: true,
        table_type: "statement",
        header_matrix: [
          [
            { raw: "Rm", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:h0" },
            { raw: "2025", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:h1" },
            { raw: "2024", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:h2" },
          ],
        ],
        unit_context: { default: "Rm", per_row: {} },
        row_groups: [],
        rows: [
          {
            cells: [
              {
                src_ref: "ext:t_pnl:r0c0",
                raw: "Revenue",
                kind: "text",
                footnote_refs: [],
              },
              {
                src_ref: "ext:t_pnl:r0c1",
                raw: "210 000",
                kind: "number",
                footnote_refs: [],
              },
              {
                src_ref: "ext:t_pnl:r0c2",
                raw: "198 000",
                kind: "number",
                footnote_refs: [],
              },
            ],
          },
        ],
      },
    ],
    footnotes: [],
    mapping_review: [],
  } as FinancialDocModel;
}

describe("site-chat extraction context", () => {
  it("maps income-statement pages to pnl affinity", () => {
    expect(pagePathAffinities("financials/group/income-statement.html").statementTypes).toEqual([
      "pnl_oci",
    ]);
    expect(pagePathAffinities("financials/group/income-statement.html").entity).toBe("group");
    expect(pagePathAffinities("auditors-report.html").sectionKinds).toContain("auditorReport");
  });

  it("retrieves auditor prose when editing auditors-report", () => {
    const evidence = buildExtractionEvidence({
      extraction: stubExtraction(),
      docModel: stubDocModel(),
      pagePath: "auditors-report.html",
      message: "Fix the auditor report heading spacing to match the PDF wording",
      pages: [
        { path: "index.html", title: "Home" },
        { path: "auditors-report.html", title: "Auditor's report" },
        { path: "financials/group/income-statement.html", title: "Group income" },
      ],
    });
    expect(evidence.text).toMatch(/SOURCE EXTRACTION CONTEXT/);
    expect(evidence.text).toMatch(/Independent auditor's report/);
    expect(evidence.text).toMatch(/We have audited the consolidated financial statements/);
    expect(evidence.text).toMatch(/SITE STRUCTURE/);
    expect(evidence.selectedIds.some((id) => id.startsWith("sec:"))).toBe(true);
  });

  it("retrieves income statement figures when editing that page", () => {
    const evidence = buildExtractionEvidence({
      extraction: stubExtraction(),
      docModel: stubDocModel(),
      pagePath: "financials/group/income-statement.html",
      message: "Align the Revenue row label with the PDF income statement",
      pages: [{ path: "financials/group/income-statement.html", title: "Income" }],
    });
    expect(evidence.text).toContain("210 000");
    expect(evidence.text).toMatch(/Revenue/);
    expect(evidence.text).toMatch(/KEY FIGURES/);
    expect(evidence.selectedIds).toContain("tbl:doc:tbl_1");
  });

  it("respects extraction char budget", () => {
    const evidence = buildExtractionEvidence({
      extraction: stubExtraction(),
      docModel: stubDocModel(),
      pagePath: "financials/group/income-statement.html",
      message: "Align Revenue with the PDF income statement and note framework wording",
      budget: 1_200,
    });
    expect(evidence.text.length).toBeLessThanOrEqual(1_200 + 80);
    expect(evidence.truncated).toBe(true);
  });

  it("injects extraction block into chat user payload", () => {
    const evidence = buildExtractionEvidence({
      extraction: stubExtraction(),
      docModel: stubDocModel(),
      pagePath: "auditors-report.html",
      message: "use PDF wording for the auditor intro",
    });
    const payload = buildSiteChatUserPayload({
      company: "MTN Group Limited",
      periodLabel: "FY2025",
      selectedPagePath: "auditors-report.html",
      allowedPaths: ["auditors-report.html"],
      dnaSummary: "theme: statutory",
      gateA: "pass",
      gateB: "pass",
      fileHtml: "<html><body>Auditor stub</body></html>",
      htmlTruncated: false,
      history: [],
      message: "use PDF wording for the auditor intro",
      allowNumberOverride: false,
      extractionContext: evidence.text,
      extractionTruncated: evidence.truncated,
      siteStructure: "- auditors-report.html — Auditor's report",
    });
    expect(payload).toContain("SOURCE EXTRACTION CONTEXT");
    expect(payload).toContain("We have audited the consolidated financial statements");
    expect(payload).toContain("210 000");
    expect(SITE_CHAT_SYSTEM).toMatch(/SOURCE EXTRACTION CONTEXT/);
    expect(SITE_CHAT_EXTRACTION_CHAR_BUDGET).toBeGreaterThan(50_000);
  });
});
