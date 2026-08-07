import { describe, expect, it } from "vitest";
import { buildStudioBrief } from "./build-content";
import { ensureContentCoverage } from "./content-coverage";
import type { ContentSample } from "./studio";

const fullContent: ContentSample = {
  company: "DRD Gold",
  period: "HY1 2025",
  kpis: [
    { label: "Revenue", value: "R5 053.2 million" },
    { label: "Headline earnings", value: "R1 234.5 million" },
  ],
  table: {
    caption: "Statement of Profit or Loss",
    headers: ["", "2025", "2024"],
    rows: [
      ["Revenue", "5 053.2", "3 802.3"],
      ["Cost of sales", "(2 591.4)", "(2 490.4)"],
      ["Gross profit", "2 461.8", "1 311.9"],
    ],
  },
  tables: [
    {
      id: "doc:tbl_pnl",
      caption: "Statement of Profit or Loss",
      headers: ["", "2025", "2024"],
      rows: [
        ["Revenue", "5 053.2", "3 802.3"],
        ["Cost of sales", "(2 591.4)", "(2 490.4)"],
        ["Gross profit", "2 461.8", "1 311.9"],
      ],
      table_type: "statement",
      must_appear: true,
    },
    {
      id: "doc:tbl_cf",
      caption: "Statement of Cash Flows",
      headers: ["", "2025", "2024"],
      rows: [
        ["Net cash inflow from operating activities", "2 309.1", "1 283.0"],
        ["Cash and cash equivalents", "1 100.0", "800.0"],
      ],
      table_type: "statement",
      must_appear: true,
    },
    {
      id: "doc:tbl_note3",
      caption: "Note 3 — Revenue",
      headers: ["", "2025", "2024"],
      rows: [["Gold revenue", "4 900.0", "3 700.0"]],
      table_type: "note",
    },
  ],
  chart: {
    title: "Group performance (Rm)",
    categories: ["Revenue", "Cost of sales"],
    series: [
      { label: "2025", values: ["5 053.2", "(2 591.4)"] },
      { label: "2024", values: ["3 802.3", "(2 490.4)"] },
    ],
  },
  letter: {
    heading: "Dear Shareholder",
    paragraphs: [
      "This is a long shareholder letter paragraph about Vision 2028 and Ergo that should be recovered if missing from the HTML shell.",
      "Second long paragraph about FWGR and safety performance that must also appear in the coverage appendix when omitted.",
      "Third paragraph with more operational detail for the brief summary path.",
      "Fourth paragraph that must not appear in the slim studio brief.",
    ],
  },
  sections: [
    {
      id: "highlights",
      kind: "highlights",
      heading: "Highlights",
      paragraphs: [
        "Record revenue of R5 053.2 million for the half year under review with strong volumes.",
        "Second highlights paragraph that should be truncated in the brief.",
      ],
    },
  ],
  dividend: ["Dividend of 20 cents per share declared.", "Salient date: payment on 15 September."],
};

describe("buildStudioBrief", () => {
  it("keeps kpis/chart and strips table rows for the LLM", () => {
    const brief = buildStudioBrief(fullContent);
    expect(brief.company).toBe("DRD Gold");
    expect(brief.kpis).toHaveLength(2);
    expect(brief.chart.categories).toEqual(["Revenue", "Cost of sales"]);
    expect(brief.tables).toHaveLength(3);
    for (const t of brief.tables!) {
      expect(t.rows).toEqual([]);
      expect(t.caption.length).toBeGreaterThan(0);
      expect(t.id.length).toBeGreaterThan(0);
    }
    expect(brief.table.rows).toEqual([]);
    expect(brief.letter.paragraphs.length).toBeLessThanOrEqual(3);
    expect(brief.letter.paragraphs.join(" ")).not.toContain("must not appear in the slim");
    // Full content unchanged
    expect(fullContent.tables![0]!.rows.length).toBeGreaterThan(0);
  });
});

describe("shell + ensureContentCoverage", () => {
  it("injects all full tables into empty shell anchors", () => {
    const shell = `<!doctype html><html><head><style>:root{--dna-ink:#231F20;--dna-paper:#fff}</style></head><body>
<nav><a href="#highlights">Highlights</a><a href="#financial-statements">Financial statements</a><a href="#notes">Notes</a><a href="#shareholder-letter">Letter</a></nav>
<section id="highlights"><h2>Highlights</h2><p>R5 053.2 million</p></section>
<section id="financial-statements" data-dna-component="statements-region"><h2>Financial statements</h2></section>
<section id="notes" data-dna-component="note-block"><h2>Notes</h2></section>
<section id="shareholder-letter" data-dna-component="letter-block"><h2>Dear Shareholder</h2></section>
</body></html>`;

    const out = ensureContentCoverage(shell, fullContent);
    expect(out).toContain("5 053.2");
    expect(out).toContain("(2 591.4)");
    expect(out).toContain("2 309.1");
    expect(out).toContain("4 900.0");
    expect(out).toContain("Vision 2028");
    expect(out).toContain("FWGR and safety");
    // Prefer shell anchors over appendix when available
    expect(out).toMatch(/id=["']financial-statements["'][\s\S]*5 053\.2/);
    expect(out).toMatch(/id=["']notes["'][\s\S]*4 900\.0/);
    expect(out).toMatch(/id=["']shareholder-letter["'][\s\S]*Vision 2028/);
  });

  it("still injects via appendix when shell omits section anchors", () => {
    const sparse = `<!doctype html><html><head></head><body>
<nav><a href="#highlights">Highlights</a></nav>
<p>Hello with KPI R5 053.2 million only</p>
</body></html>`;
    const out = ensureContentCoverage(sparse, fullContent);
    expect(out).toContain("full-statements");
    expect(out).toContain("Statement of Cash Flows");
    expect(out).toContain("2 309.1");
    expect(out).toContain("Vision 2028");
  });
});
