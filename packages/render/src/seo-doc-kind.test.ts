import { describe, expect, it } from "vitest";
import { docKindLabel, inferDocKind, resolveDocKindLabel } from "./seo.js";

describe("doc kind labels", () => {
  it("labels annual_audited as Annual Financial Statements", () => {
    expect(docKindLabel("annual_audited")).toBe("Annual Financial Statements");
  });

  it("infers AFS from cover wording / year ended", () => {
    expect(
      inferDocKind(["THE SPAR GROUP LTD ANNUAL FINANCIAL STATEMENTS 2025"], "FY2025"),
    ).toBe("annual_audited");
    expect(inferDocKind(["for the year ended 26 September 2025"], "FY2025")).toBe(
      "annual_audited",
    );
  });

  it("keeps interim when cover says interim", () => {
    expect(
      inferDocKind(
        ["Condensed consolidated unaudited interim results for the six months ended 31 December 2025"],
        "HY1 FY2026",
      ),
    ).toBe("interim_unaudited");
  });

  it("prefers cover AFS wording over stale interim meta", () => {
    expect(
      resolveDocKindLabel("interim_unaudited", {
        texts: ["Annual Financial Statements"],
        periodLabel: "FY2025",
      }),
    ).toBe("Annual Financial Statements");
  });
});
