import { describe, expect, it } from "vitest";
import { htmlHasDualEntityBoard } from "./enrich.js";
import { renderEntityCue } from "./chrome.js";

describe("htmlHasDualEntityBoard", () => {
  it("rejects single-entity interim HTML that merely mentions Group/Company in prose", () => {
    const html = `
      <main>
        <p>The Group and the Company present condensed consolidated results.</p>
        <table class="fin-table" data-density="notes">
          <thead><tr><th class="h-title">Revenue</th><th class="h-fig">2025</th><th class="h-fig">2024</th></tr></thead>
        </table>
      </main>`;
    expect(htmlHasDualEntityBoard(html)).toBe(false);
  });

  it("accepts dual-entity density attribute from the renderer", () => {
    const html = `<table class="fin-table" data-density="dual-entity"><thead></thead></table>`;
    expect(htmlHasDualEntityBoard(html)).toBe(true);
  });

  it("accepts both Group and Company h-entity header cells", () => {
    const html = `
      <table class="fin-table">
        <thead>
          <tr>
            <th></th>
            <th class="h-entity">Group</th>
            <th class="h-entity">Company</th>
          </tr>
        </thead>
      </table>`;
    expect(htmlHasDualEntityBoard(html)).toBe(true);
  });

  it("rejects a lone Group entity header", () => {
    const html = `
      <table class="fin-table">
        <thead><tr><th class="h-entity">Group</th><th class="h-fig">2025</th></tr></thead>
      </table>`;
    expect(htmlHasDualEntityBoard(html)).toBe(false);
  });
});

describe("renderEntityCue", () => {
  it("emits dual cue only when dualEntity is true", () => {
    expect(renderEntityCue("financials/income-statement.html")).toBe("");
    expect(renderEntityCue("financials/income-statement.html", { dualEntity: false })).toBe("");
    const dual = renderEntityCue("financials/income-statement.html", { dualEntity: true });
    expect(dual).toContain("entity-cue--dual");
    expect(dual).toContain("Side-by-side columns");
  });
});
