import { describe, expect, it } from "vitest";
import { polishPrototypeHtml, READABLE_CSS } from "./polish-prototype";

describe("polishPrototypeHtml", () => {
  it("injects a data-rs-readable style before </head>", () => {
    const html = `<!doctype html><html><head><style>:root{--dna-ink:#231F20}</style></head><body><p class="pg">Pages 2 – 4</p></body></html>`;
    const out = polishPrototypeHtml(html);
    expect(out).toContain('data-rs-readable="1"');
    expect(out).toContain("--rs-content-max");
    expect(out).toContain("--rs-prose:68ch");
    expect(out).toContain("max-width:var(--rs-prose)!important");
    expect(out).toContain("line-height:1.65");
    expect(out.indexOf('data-rs-readable="1"')).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain("--rs-header-bg");
    expect(READABLE_CSS).toContain("thead th");
  });

  it("forces wrapping nav and centered content (no page overflow-x)", () => {
    expect(READABLE_CSS).toContain("overflow-x:hidden");
    expect(READABLE_CSS).toContain("flex-wrap:wrap");
    expect(READABLE_CSS).toContain("margin-inline:auto");
    expect(READABLE_CSS).toMatch(/nav[\s\S]*overflow-x:visible/);
    expect(READABLE_CSS).toContain("text-overflow:unset");
    const out = polishPrototypeHtml(
      `<!doctype html><html><head></head><body><nav style="overflow-x:auto"><a>Operating segments</a></nav><main class="wrap"><article class="prose"><p>Letter</p></article></main></body></html>`,
    );
    expect(out).toContain("overflow-x:hidden");
    expect(out).toContain("flex-wrap:wrap");
    expect(out).toContain("margin-inline:auto");
  });

  it("replaces an existing polish block idempotently", () => {
    const once = polishPrototypeHtml(
      `<!doctype html><html><head></head><body></body></html>`,
    );
    const twice = polishPrototypeHtml(once);
    expect(twice.match(/data-rs-readable="1"/g)?.length).toBe(1);
  });
});
