import { describe, expect, it } from "vitest";
import { linkNoteRefHtml, notesBaseHref, noteHref } from "./notes-linker.js";
import { classifyStatementRow, rowRoleClass } from "./row-taxonomy.js";

describe("row taxonomy", () => {
  it("classifies section / subtotal / total / line", () => {
    expect(classifyStatementRow("Assets", false)).toBe("section");
    expect(classifyStatementRow("Equity and liabilities", false)).toBe("section");
    expect(classifyStatementRow("Non-current assets", true)).toBe("subtotal");
    expect(classifyStatementRow("Current liabilities", true)).toBe("subtotal");
    expect(classifyStatementRow("Total assets", true)).toBe("total");
    expect(classifyStatementRow("Total equity and liabilities", true)).toBe("total");
    expect(classifyStatementRow("Property plant and equipment", true)).toBe("line");
    expect(rowRoleClass("subtotal")).toBe("r-subtotal bd-blue");
    expect(rowRoleClass("section")).toBe("r-section bd-tan");
    expect(rowRoleClass("total")).toBe("r-total");
  });
});

describe("notes linker", () => {
  it("builds relative note hrefs from page path", () => {
    expect(notesBaseHref("financials/balance-sheet.html")).toBe("notes.html");
    expect(notesBaseHref("financials/notes.html")).toBeNull();
    expect(notesBaseHref("statements/index.html")).toBe("../financials/notes.html");
    expect(noteHref("notes.html", 2)).toBe("notes.html#note-2");
  });

  it("links single and multi note refs without rewriting digits", () => {
    const esc = (s: string) => s.replace(/&/g, "&amp;");
    expect(linkNoteRefHtml("2", "notes.html", esc)).toBe(
      '<a class="note-ref" href="notes.html#note-2">2</a>',
    );
    expect(linkNoteRefHtml("5, 8", "notes.html", esc)).toBe(
      '<a class="note-ref" href="notes.html#note-5">5</a>, <a class="note-ref" href="notes.html#note-8">8</a>',
    );
  });
});
