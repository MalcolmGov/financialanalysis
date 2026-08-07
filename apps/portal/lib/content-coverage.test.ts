import { describe, expect, it } from "vitest";
import { ensureContentCoverage, renderContentTable } from "./content-coverage";
import type { ContentSample } from "./studio";

const sample: ContentSample = {
  company: "DRD Gold",
  period: "HY1",
  kpis: [{ label: "Revenue", value: "R5 053.2 million" }],
  table: {
    caption: "Statement of Profit or Loss",
    headers: ["", "2025", "2024"],
    rows: [
      ["Revenue", "5 053.2", "3 802.3"],
      ["Cost of sales", "(2 591.4)", "(2 490.4)"],
    ],
  },
  tables: [
    {
      id: "doc:tbl_1",
      caption: "Statement of Profit or Loss",
      headers: ["", "2025", "2024"],
      rows: [
        ["Revenue", "5 053.2", "3 802.3"],
        ["Cost of sales", "(2 591.4)", "(2 490.4)"],
      ],
    },
    {
      id: "doc:tbl_2",
      caption: "Statement of Cash Flows",
      headers: ["", "2025", "2024"],
      rows: [["Net cash inflow from operating activities", "2 309.1", "1 283.0"]],
    },
  ],
  chart: { title: "x", categories: [], series: [] },
  letter: {
    heading: "Dear Shareholder",
    paragraphs: [
      "This is a long shareholder letter paragraph about Vision 2028 and Ergo that should be recovered if missing from the HTML shell.",
      "Second long paragraph about FWGR and safety performance that must also appear in the coverage appendix when omitted.",
    ],
  },
};

describe("ensureContentCoverage", () => {
  it("injects missing tables and letter paragraphs", () => {
    const sparse = `<!doctype html><html><head></head><body>
<nav><a href="#highlights">Highlights</a></nav>
<p>Hello with KPI R5 053.2 million only</p>
</body></html>`;
    const out = ensureContentCoverage(sparse, sample);
    expect(out).toContain("full-statements");
    expect(out).toContain("Statement of Profit or Loss");
    expect(out).toContain("5 053.2");
    expect(out).toContain("Statement of Cash Flows");
    expect(out).toContain("2 309.1");
    expect(out).toContain("Vision 2028");
    expect(out).toContain('href="#full-statements"');
  });

  it("does not inject when tables already present", () => {
    const rich = `<!doctype html><html><body>
<p>Revenue 5 053.2 Cost of sales (2 591.4)</p>
<p>Net cash inflow from operating activities 2 309.1</p>
<p>This is a long shareholder letter paragraph about Vision 2028 and Ergo that should be recovered if missing from the HTML shell.</p>
<p>Second long paragraph about FWGR and safety performance that must also appear in the coverage appendix when omitted.</p>
</body></html>`;
    const out = ensureContentCoverage(rich, sample);
    expect(out).not.toContain("rs-coverage-appendix");
  });

  it("renders a DNA-friendly table", () => {
    const html = renderContentTable(sample.tables![0]!);
    expect(html).toContain("<table>");
    expect(html).toContain("5 053.2");
    expect(html).toContain("statement-table");
  });
});
