import { describe, expect, it } from "vitest";
import {
  extractYear,
  findCurrentPeriodColIndex,
  markCurrentPeriodColumns,
} from "./current-period";
import { polishPrototypeHtml, READABLE_CSS } from "./polish-prototype";

describe("current-period shading", () => {
  it("extracts years from date headers", () => {
    expect(extractYear("31 Dec 2025")).toBe(2025);
    expect(extractYear("2024")).toBe(2024);
    expect(extractYear("R'000")).toBeNull();
  });

  it("picks the latest year column (rightmost on ties)", () => {
    expect(findCurrentPeriodColIndex(["", "2024", "2025"])).toBe(2);
    expect(findCurrentPeriodColIndex(["Note", "31 Dec 2025", "31 Dec 2024"])).toBe(1);
  });

  it("marks tables with data-cur-col and .cur", () => {
    const html = `<table><thead><tr><th></th><th>2024</th><th>2025</th></tr></thead><tbody><tr><th>Revenue</th><td>1</td><td>2</td></tr></tbody></table>`;
    const out = markCurrentPeriodColumns(html);
    expect(out).toContain('data-cur-col="3"');
    expect(out).toMatch(/<th[^>]*class="cur"[^>]*>2025/);
    expect(out).toMatch(/<td class="cur">2<\/td>/);
  });

  it("polish injects CSS and marks current period", () => {
    expect(READABLE_CSS).toContain("td.cur");
    expect(READABLE_CSS).toContain("--dna-shading");
    const html = `<!doctype html><html><head></head><body>
<table><thead><tr><th>Item</th><th>2023</th><th>2024</th></tr></thead>
<tbody><tr><th>Sales</th><td>10</td><td>20</td></tr></tbody></table>
</body></html>`;
    const out = polishPrototypeHtml(html);
    expect(out).toContain('data-rs-readable="1"');
    expect(out).toContain('data-cur-col="3"');
    expect(out).toContain("td.cur");
  });
});
