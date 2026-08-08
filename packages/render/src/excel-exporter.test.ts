import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { FinancialDocModel } from "@rs/contracts";
import {
  buildWorkbookXlsx,
  collectExcelSheets,
  exportExcelFromDocModel,
  zipDeflated,
} from "./excel-exporter.js";

const PNL = {
  id: "doc:tbl_pnl",
  src_table: "ext:t_pnl",
  must_appear: true,
  table_type: "statement" as const,
  header_matrix: [
    [
      { raw: "", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:r0c0" },
      { raw: "Six months ended 31 Dec 2025", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:r0c1" },
      { raw: "Six months ended 31 Dec 2024", col_span: 1, row_span: 1, src_ref: "ext:t_pnl:r0c2" },
    ],
  ],
  unit_context: { default: "Rm", per_row: {} },
  row_groups: [],
  rows: [
    {
      cells: [
        { src_ref: "ext:t_pnl:r1c0", raw: "Revenue", kind: "text" as const, footnote_refs: [] },
        { src_ref: "ext:t_pnl:r1c1", raw: "5 053.2", kind: "number" as const, footnote_refs: [] },
        { src_ref: "ext:t_pnl:r1c2", raw: "3 802.3", kind: "number" as const, footnote_refs: [] },
      ],
    },
    {
      cells: [
        {
          src_ref: "ext:t_pnl:r2c0",
          raw: "Profit for the period",
          kind: "text" as const,
          footnote_refs: [],
        },
        { src_ref: "ext:t_pnl:r2c1", raw: "1 927.7", kind: "number" as const, footnote_refs: [] },
        { src_ref: "ext:t_pnl:r2c2", raw: "970.1", kind: "number" as const, footnote_refs: [] },
      ],
    },
  ],
};

const BS = {
  ...PNL,
  id: "doc:tbl_bs",
  src_table: "ext:t_bs",
  rows: [
    {
      cells: [
        { src_ref: "ext:t_bs:r1c0", raw: "Total assets", kind: "text" as const, footnote_refs: [] },
        { src_ref: "ext:t_bs:r1c1", raw: "12 345.6", kind: "number" as const, footnote_refs: [] },
        { src_ref: "ext:t_bs:r1c2", raw: "11 000.0", kind: "number" as const, footnote_refs: [] },
      ],
    },
  ],
  header_matrix: [
    [
      { raw: "", col_span: 1, row_span: 1, src_ref: "ext:t_bs:r0c0" },
      { raw: "31 Dec 2025", col_span: 1, row_span: 1, src_ref: "ext:t_bs:r0c1" },
      { raw: "30 Jun 2025", col_span: 1, row_span: 1, src_ref: "ext:t_bs:r0c2" },
    ],
  ],
};

function docModel(): FinancialDocModel {
  return {
    schema_version: "docmodel/1",
    doc_model_id: "dm_xlsx",
    extraction_id: "ext_1",
    content_hash: "b".repeat(64),
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
        blocks: [{ kind: "table", table_ref: "doc:tbl_pnl" }],
        items: [],
      },
      {
        id: "doc:sec_bs",
        kind: "statement",
        statement_type: "financial_position",
        blocks: [{ kind: "table", table_ref: "doc:tbl_bs" }],
        items: [],
      },
    ],
    tables: [PNL, BS],
    footnotes: [],
    mapping_review: [],
  } as FinancialDocModel;
}

/** Extract uncompressed entry bytes from our deflated ZIP. */
function unzipEntry(zip: Uint8Array, name: string): string {
  const buf = Buffer.from(zip);
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const entryName = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (entryName !== name) continue;
    if (method === 0) return data.toString("utf8");
    if (method === 8) return inflateRawSync(data).toString("utf8");
    throw new Error(`unsupported method ${method}`);
  }
  throw new Error(`missing zip entry ${name}`);
}

describe("ExcelExporter", () => {
  it("collects statement sheets with stable names", () => {
    const sheets = collectExcelSheets(docModel());
    expect(sheets.map((s) => s.name)).toEqual(["Income Statement", "Balance Sheet"]);
    expect(sheets.map((s) => s.slug)).toEqual(["income-statement", "balance-sheet"]);
  });

  it("writes verbatim FinTable numbers into XLSX sheet XML", () => {
    const sheets = collectExcelSheets(docModel());
    const xlsx = buildWorkbookXlsx(sheets, {
      company: "DRDGOLD Limited",
      periodLabel: "HY1 FY2026",
    });
    // ZIP local header signature
    expect(xlsx[0]).toBe(0x50);
    expect(xlsx[1]).toBe(0x4b);
    const sheet1 = unzipEntry(xlsx, "xl/worksheets/sheet1.xml");
    expect(sheet1).toContain("5 053.2");
    expect(sheet1).toContain("1 927.7");
    expect(sheet1).toContain("Revenue");
    expect(sheet1).toContain("Condensed Consolidated Statement of Profit or Loss");
    expect(sheet1).toContain("DRDGOLD Limited · HY1 FY2026");
    expect(sheet1).toContain("frozen");
    expect(sheet1).toContain("<cols>");
    expect(sheet1).toContain('customWidth="1"');
    expect(sheet1).toContain("fitToPage");
    const styles = unzipEntry(xlsx, "xl/styles.xml");
    expect(styles).toContain("cellXfs");
    expect(styles).toContain("FF839097");
    expect(styles).toContain("Arial");
    const sheet2 = unzipEntry(xlsx, "xl/worksheets/sheet2.xml");
    expect(sheet2).toContain("Total assets");
    expect(sheet2).toContain("12 345.6");
    expect(sheet2).toContain("Condensed Consolidated Statement of Financial Position");
  });

  it("exports multi-sheet workbook + per-statement files", () => {
    const result = exportExcelFromDocModel(docModel());
    expect(result.workbookSheetNames).toEqual(["Income Statement", "Balance Sheet"]);
    expect(result.files["assets/excel/financial-statements.xlsx"]).toBeTruthy();
    expect(result.files["assets/excel/income-statement.xlsx"]).toBeTruthy();
    expect(result.files["assets/excel/balance-sheet.xlsx"]).toBeTruthy();
    expect(result.statementFiles.map((f) => f.slug)).toEqual([
      "income-statement",
      "balance-sheet",
    ]);
  });

  it("zipDeflated round-trips XML payload", () => {
    const zip = zipDeflated({ "hello.txt": "5 053.2" });
    expect(unzipEntry(zip, "hello.txt")).toBe("5 053.2");
  });
});
