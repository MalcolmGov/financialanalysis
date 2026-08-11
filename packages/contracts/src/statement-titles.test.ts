import { describe, expect, it } from "vitest";
import {
  officialStatementEyebrow,
  officialStatementNavLabel,
  officialStatementTitle,
} from "./statement-titles.js";

describe("officialStatementTitle", () => {
  it("uses Condensed Consolidated IAS 1 names for interim/HY packs", () => {
    expect(
      officialStatementTitle({
        docKind: "interim_unaudited",
        statementType: "pnl_oci",
      }),
    ).toBe(
      "Condensed Consolidated Statement of Profit or Loss and Other Comprehensive Income",
    );
    expect(
      officialStatementNavLabel({
        docKind: "interim_reviewed",
        statementType: "financial_position",
      }),
    ).toBe("Condensed Consolidated Statement of Financial Position");
    expect(
      officialStatementTitle({
        docKind: "interim_unaudited",
        statementType: "changes_in_equity",
      }),
    ).toBe("Condensed Consolidated Statement of Changes in Equity");
    expect(
      officialStatementTitle({
        docKind: "interim_unaudited",
        statementType: "cash_flows",
      }),
    ).toBe("Condensed Consolidated Statement of Cash Flows");
  });

  it("uses Consolidated IAS 1 names for audited AFS", () => {
    expect(
      officialStatementTitle({
        docKind: "annual_audited",
        statementType: "pnl_oci",
      }),
    ).toBe("Consolidated Statement of Profit or Loss and Other Comprehensive Income");
    expect(
      officialStatementTitle({
        docKind: "annual_audited",
        statementType: "financial_position",
      }),
    ).toBe("Consolidated Statement of Financial Position");
  });

  it("prefixes Group / Company on split books and drops OCI when source is P&L only", () => {
    expect(
      officialStatementTitle({
        docKind: "annual_audited",
        statementType: "pnl_oci",
        entity: "group",
        sourceTitle: "Group income statement",
      }),
    ).toBe("Group Statement of Profit or Loss");
    expect(
      officialStatementTitle({
        docKind: "annual_audited",
        statementType: "cash_flows",
        entity: "company",
      }),
    ).toBe("Company Statement of Cash Flows");
  });

  it("marks dual-entity boards without shortening the official name", () => {
    expect(
      officialStatementTitle({
        docKind: "annual_audited",
        statementType: "financial_position",
        dualEntity: true,
      }),
    ).toBe("Consolidated Statement of Financial Position (Group and Company)");
  });

  it("uses Condensed when period is HY even if doc_kind was stored as annual", () => {
    expect(
      officialStatementTitle({
        docKind: "annual_audited",
        statementType: "pnl_oci",
        periodLabel: "HY1 FY2026",
      }),
    ).toBe(
      "Condensed Consolidated Statement of Profit or Loss and Other Comprehensive Income",
    );
  });

  it("sets eyebrows from doc_kind", () => {
    expect(officialStatementEyebrow("interim_unaudited")).toBe(
      "Condensed Consolidated — Unaudited",
    );
    expect(officialStatementEyebrow("annual_audited")).toBe("Consolidated financial statements");
  });
});
