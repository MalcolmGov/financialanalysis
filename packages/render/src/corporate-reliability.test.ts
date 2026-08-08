import { describe, expect, it } from "vitest";
import { CHROME_CSS, renderStickyNav } from "./chrome.js";
import {
  auditCorporateReliability,
  checkBrandFallback,
  checkLegalCompanyChrome,
  checkPageMinContent,
  checkRevealProgressiveEnhancement,
  visibleTextBytes,
} from "./corporate-reliability.js";
import { SITE_RUNTIME_JS } from "./site-runtime.js";

describe("checkRevealProgressiveEnhancement", () => {
  it("passes CHROME_CSS progressive reveal guard", () => {
    const r = checkRevealProgressiveEnhancement(CHROME_CSS);
    expect(r.ok).toBe(true);
  });

  it("fails unguarded .reveal { opacity:0 }", () => {
    const r = checkRevealProgressiveEnhancement(".reveal{opacity:0;transform:translateY(12px)}");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("reveal-opacity-unguarded");
  });

  it("passes html.rs-motion-gated hide", () => {
    const r = checkRevealProgressiveEnhancement(
      "html.rs-motion .reveal:not(.is-visible){opacity:0}.reveal{opacity:1}",
    );
    expect(r.ok).toBe(true);
  });
});

describe("visibleTextBytes / min content", () => {
  it("ignores style and script payloads", () => {
    const html = `<html><head><style>.x{opacity:0}</style><script>var x="pad".repeat(99)</script></head><body><h1>Hello IR</h1><p>Results for investors</p></body></html>`;
    expect(visibleTextBytes(html)).toBeLessThan(80);
    expect(visibleTextBytes(html)).toBeGreaterThan(10);
  });

  it("fails near-blank pages", () => {
    const r = checkPageMinContent("<html><body><p>x</p></body></html>", "index.html");
    expect(r.ok).toBe(false);
  });
});

describe("checkBrandFallback", () => {
  it("requires text mark with logo + onerror", () => {
    const withLogo = renderStickyNav(
      [{ label: "Home", href: "index.html" }],
      "index.html",
      "DRDGOLD",
      "assets/brand/logo.png",
    );
    expect(checkBrandFallback(withLogo).ok).toBe(true);
    expect(withLogo).toContain("onerror=");
    expect(withLogo).toContain("nav-brand__name");
  });

  it("accepts text-only brand", () => {
    const textOnly = renderStickyNav(
      [{ label: "Home", href: "index.html" }],
      "index.html",
      "DRDGOLD",
    );
    expect(checkBrandFallback(textOnly).ok).toBe(true);
  });
});

describe("auditCorporateReliability", () => {
  it("passes a minimal PE-safe multipage fixture", () => {
    const nav = renderStickyNav(
      [{ label: "Home", href: "index.html" }],
      "index.html",
      "Acme",
    );
    const body =
      "Investor results centre with commentary, condensed statements, notes, and downloads for the reporting period. ".repeat(
        8,
      );
    const page = `<!doctype html><html><head><style>${CHROME_CSS}</style></head><body>${nav}<main class="reveal">${body}</main><script src="assets/site.js"></script></body></html>`;
    const site = {
      files: {
        "index.html": page,
        "commentary.html": page.replace("index.html", "commentary.html"),
        "assets/site.js": SITE_RUNTIME_JS,
      },
      binaries: {
        "assets/fonts/open-sans-latin-400-normal.woff2": new Uint8Array(64).fill(1),
      },
    };
    const audit = auditCorporateReliability(site);
    const fails = audit.findings.filter((f) => !f.ok);
    expect(fails, JSON.stringify(fails, null, 2)).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it("fails when project slug leaks into chrome", () => {
    const nav = renderStickyNav(
      [{ label: "Home", href: "index.html" }],
      "index.html",
      "DRD Gold 1",
    );
    const body =
      "Investor results centre with commentary, condensed statements, notes, and downloads for the reporting period. ".repeat(
        8,
      );
    const page = `<!doctype html><html><head><style>${CHROME_CSS}</style><title>Home · DRD Gold 1</title></head><body>${nav}<main class="home-hero reveal"><h1 data-allow-number>DRD Gold 1</h1>${body}</main><script src="assets/site.js"></script></body></html>`;
    const audit = auditCorporateReliability(
      {
        files: {
          "index.html": page,
          "assets/site.js": SITE_RUNTIME_JS,
        },
        binaries: {
          "assets/fonts/open-sans-latin-400-normal.woff2": new Uint8Array(64).fill(1),
        },
      },
      { expectedLegalName: "DRDGOLD", forbiddenProjectTitles: ["DRD Gold 1"] },
    );
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "project-slug-in-chrome" && !f.ok)).toBe(true);
    expect(checkLegalCompanyChrome(page, "index.html", { expectedLegalName: "DRDGOLD" }).some((f) => !f.ok)).toBe(
      true,
    );
  });

  it("fails site with unguarded reveal hide", () => {
    const badCss = ".kpi-card{opacity:0}";
    const page = `<!doctype html><html><head><style>${badCss}</style></head><body><span class="nav-brand__name">X</span>${"content ".repeat(80)}</body></html>`;
    const audit = auditCorporateReliability({
      files: {
        "index.html": page,
        "assets/site.js": "/* no rs-motion */",
      },
      binaries: {
        "assets/fonts/open-sans-latin-400-normal.woff2": new Uint8Array(64).fill(1),
      },
    });
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "reveal-opacity-unguarded" && !f.ok)).toBe(true);
  });
});
