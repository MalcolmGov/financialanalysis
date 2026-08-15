import { describe, expect, it } from "vitest";
import type { FinancialDocModel, FinTable } from "@rs/contracts";
import { arithmeticAdvisory, parseAdvisoryNumber } from "./arithmetic-advisory";

function cell(raw: string, kind: "text" | "number" = "number") {
  return { src_ref: "ext:t:r0c0", raw, kind, footnote_refs: [] };
}

function table(rows: FinTable["rows"]): FinTable {
  return {
    id: "doc:tbl_1",
    src_table: "ext:t",
    must_appear: true,
    table_type: "statement",
    header_matrix: [],
    unit_context: { default: "Rm", per_row: {} },
    row_groups: [],
    rows,
  };
}

function model(tables: FinTable[]): FinancialDocModel {
  return {
    schema_version: "docmodel/1",
    doc_model_id: "dm",
    extraction_id: "ex",
    project_id: "p",
    meta: { company: "Co", period_label: "FY26", doc_kind: "interim_unaudited", currency: "ZAR" },
    tables,
    sections: [],
    kpis: [],
    checksum: "0".repeat(64),
  } as FinancialDocModel;
}

describe("parseAdvisoryNumber", () => {
  it("parses SA grouped positives and parentheses negatives", () => {
    expect(parseAdvisoryNumber("2 712.8")).toBe(2712.8);
    expect(parseAdvisoryNumber("(12.4)")).toBe(-12.4);
    expect(parseAdvisoryNumber("—")).toBeNull();
  });
});

describe("arithmeticAdvisory", () => {
  it("flags a total that does not equal preceding lines", () => {
    const report = arithmeticAdvisory(
      model([
        table([
          { cells: [cell("Revenue", "text"), cell("10")] },
          { cells: [cell("Other income", "text"), cell("5")] },
          { cells: [cell("Total revenue", "text"), cell("99")] },
        ]),
      ]),
    );
    expect(report.checked).toBe(1);
    expect(report.discrepancies).toBe(1);
  });

  it("accepts a total within rounding tolerance", () => {
    const report = arithmeticAdvisory(
      model([
        table([
          { cells: [cell("Revenue", "text"), cell("10.0")] },
          { cells: [cell("Other income", "text"), cell("5.0")] },
          { cells: [cell("Total revenue", "text"), cell("15.0")] },
        ]),
      ]),
    );
    expect(report.discrepancies).toBe(0);
    expect(report.checked).toBe(1);
  });
});
