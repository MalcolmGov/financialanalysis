import { describe, expect, it } from "vitest";
import {
  applyPatches,
  assertNumeralsUnchanged,
  NumeralGuardError,
  PatchApplyError,
} from "./refine";

describe("applyPatches", () => {
  it("applies exact unique search/replace", () => {
    const html = "<div class='hero'>Hello</div><p>World</p>";
    const out = applyPatches(html, [{ search: "class='hero'", replace: "class='masthead'" }]);
    expect(out).toContain("class='masthead'");
    expect(out).not.toContain("class='hero'");
  });

  it("fails on ambiguous exact matches without occurrence", () => {
    expect(() =>
      applyPatches("<b>x</b><b>x</b>", [{ search: "<b>x</b>", replace: "<b>y</b>" }]),
    ).toThrow(PatchApplyError);
  });

  it("honors occurrence for ambiguous matches", () => {
    const out = applyPatches("<b>x</b><b>x</b>", [
      { search: "<b>x</b>", replace: "<b>y</b>", occurrence: 2 },
    ]);
    expect(out).toBe("<b>x</b><b>y</b>");
  });

  it("fuzzy-matches whitespace differences", () => {
    const html = "<nav>\n  <a>Home</a>\n</nav>";
    const out = applyPatches(html, [
      { search: "<nav> <a>Home</a> </nav>", replace: "<nav><a>Overview</a></nav>" },
    ]);
    expect(out).toContain("<a>Overview</a>");
  });

  it("matches HTML entities and quote-style flex", () => {
    const html = `<h1 class='hero'>Q1&nbsp;results</h1>`;
    const out = applyPatches(html, [
      {
        search: `<h1 class="hero">Q1 results</h1>`,
        replace: `<h1 class='hero'>Interim results</h1>`,
      },
    ]);
    expect(out).toContain("Interim results");
  });

  it("unescapes literal \\n in the search string", () => {
    const html = "<p>Line one\nLine two</p>";
    const out = applyPatches(html, [
      { search: "<p>Line one\\nLine two</p>", replace: "<p>Line one<br>Line two</p>" },
    ]);
    expect(out).toContain("<br>");
  });
});

describe("assertNumeralsUnchanged", () => {
  it("allows non-numeric edits", () => {
    const parent = "<p>Revenue R2 712.8 million</p>";
    const child = "<p class='lead'>Revenue R2 712.8 million</p>";
    expect(() => assertNumeralsUnchanged(parent, child)).not.toThrow();
  });

  it("rejects altered figures", () => {
    const parent = "<p>Revenue R2 712.8 million</p>";
    const child = "<p>Revenue R2 713.8 million</p>";
    expect(() => assertNumeralsUnchanged(parent, child)).toThrow(NumeralGuardError);
  });
});
