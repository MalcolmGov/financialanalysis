import { describe, expect, it } from "vitest";
import { patchApplyRetryHint } from "./site-chat";

describe("patchApplyRetryHint", () => {
  it("coaches unique-search when the apply was ambiguous", () => {
    const hint = patchApplyRetryHint("patch[0]: search matched 4 times (fuzzy) — set occurrence or tighten the anchor", [
      { search: "<nav class='site-nav'><a href='index.html'>Overview</a>", replace: "<nav>" },
    ]);
    expect(hint).toMatch(/Lengthen the copy-pasted HTML/);
    expect(hint).toMatch(/Failing anchors/);
    expect(hint).toMatch(/site-nav/);
  });

  it("coaches exact copy when the search was missing", () => {
    const hint = patchApplyRetryHint("patch[0]: search not found (exact, entity, or whitespace-fuzzy)", [
      { search: "<h1>Invented heading</h1>", replace: "<h1>Next</h1>" },
    ]);
    expect(hint).toMatch(/not in CURRENT FILE/);
    expect(hint).toMatch(/Invented heading/);
  });
});
