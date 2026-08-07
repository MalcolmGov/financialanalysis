import { describe, expect, it } from "vitest";
import {
  extractYear,
  findCurrentPeriodColIndex,
  findCurrentPeriodSpan,
  markCurrentPeriodColumns,
} from "./current-period";
import { polishPrototypeHtml, READABLE_CSS } from "./polish-prototype";

describe("current-period shading", () => {
  it("extracts years from date headers", () => {
    expect(extractYear("31 Dec 2025")).toBe(2025);
    expect(extractYear("2024")).toBe(2024);
    expect(extractYear("R'000")).toBeNull();
  });

  it("picks the latest year column (leftmost on ties)", () => {
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

  it("shades all leaf columns under a current-period colspan group (rowspan-aware)", () => {
    const html = `<table>
<thead>
<tr>
<th rowspan="2"></th>
<th colspan="4">Six months ended 31 Dec 2025</th>
<th colspan="4">Six months ended 31 Dec 2024</th>
</tr>
<tr>
<th>Ergo</th><th>FWGR</th><th>Other</th><th>Total</th>
<th>Ergo</th><th>FWGR</th><th>Other</th><th>Total</th>
</tr>
</thead>
<tbody>
<tr>
<th>Revenue</th>
<td>1</td><td>2</td><td>3</td><td>4</td>
<td>5</td><td>6</td><td>7</td><td>8</td>
</tr>
</tbody>
</table>`;
    const span = findCurrentPeriodSpan(html.match(/<thead[\s\S]*?<\/thead>/i)![0]);
    expect(span).toEqual({ start: 1, end: 5, year: 2025 });
    const out = markCurrentPeriodColumns(html);
    expect(out).toContain('data-cur-col="2 3 4 5"');
    // All four 2025 body cells shaded; prior year not
    expect(out).toMatch(/<td class="cur">1<\/td>/);
    expect(out).toMatch(/<td class="cur">2<\/td>/);
    expect(out).toMatch(/<td class="cur">3<\/td>/);
    expect(out).toMatch(/<td class="cur">4<\/td>/);
    expect(out).not.toMatch(/<td class="cur">5<\/td>/);
    expect(out).toContain("<td>5</td>");
    // First Ergo (under 2025) marked; 2024 Ergo not the only match — count cur Ergo = 1
    expect((out.match(/<th class="cur">Ergo<\/th>/g) || []).length).toBe(1);
    expect((out.match(/<th class="cur">FWGR<\/th>/g) || []).length).toBe(1);
  });

  it("polish injects CSS and marks current period", () => {
    expect(READABLE_CSS).toContain("td.cur");
    expect(READABLE_CSS).toContain("--rs-period-shade");
    expect(READABLE_CSS).toContain("--dna-shading");
    const html = `<!doctype html><html><head></head><body>
<table><thead><tr><th>Item</th><th>2025</th><th>2024</th></tr></thead>
<tbody><tr><th>Sales</th><td>10</td><td>20</td></tr></tbody></table>
</body></html>`;
    const out = polishPrototypeHtml(html);
    expect(out).toContain('data-rs-readable="1"');
    expect(out).toContain('data-cur-col="2"');
    expect(out).toContain('class="cur">10');
  });
});
