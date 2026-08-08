import { describe, expect, it } from "vitest";
import { renderSelectionTooltip, renderStickyNav } from "./chrome.js";
import { renderKpiCardsHtml, segmentHighlightKpis } from "./home-kpis.js";
import { SITE_RUNTIME_JS, siteRuntimeHref } from "./site-runtime.js";

const DRD_HIGHLIGHTS =
  "Operating profit increased by 72% to R2 712.8 million Headline earnings increased by 99% to R1 932.4 million Interim cash dividend of 50 SA cps R1 651.3 million of capital expenditure All-in sustaining costs margin 2 of 48% Gold production decreased by 9% to 2 337 kilograms";

describe("siteRuntimeHref", () => {
  it("resolves relative asset path by page depth", () => {
    expect(siteRuntimeHref("index.html")).toBe("assets/site.js");
    expect(siteRuntimeHref("commentary.html")).toBe("assets/site.js");
    expect(siteRuntimeHref("financials/balance-sheet.html")).toBe("../assets/site.js");
  });
});

describe("SITE_RUNTIME_JS", () => {
  it("covers mark/share, count-up, reveal, and mobile nav", () => {
    expect(SITE_RUNTIME_JS).toContain("data-countup");
    expect(SITE_RUNTIME_JS).toContain("IntersectionObserver");
    expect(SITE_RUNTIME_JS).toContain("user-mark");
    expect(SITE_RUNTIME_JS).toContain("rs-marks-");
    expect(SITE_RUNTIME_JS).toContain("localStorage");
    expect(SITE_RUNTIME_JS).toContain("share-tooltip");
    expect(SITE_RUNTIME_JS).toContain("sel-share-mark");
    expect(SITE_RUNTIME_JS).toContain("data-nav-toggle");
    expect(SITE_RUNTIME_JS).toContain("initReveal");
    expect(SITE_RUNTIME_JS).toContain("data-final");
    expect(SITE_RUNTIME_JS).toContain("showToast");
    expect(SITE_RUNTIME_JS).toContain('data-share="email"');
    expect(SITE_RUNTIME_JS).toContain("is-scrolled");
    expect(SITE_RUNTIME_JS).toContain("Escape");
    expect(SITE_RUNTIME_JS).toContain("data-brand-img");
    expect(SITE_RUNTIME_JS).toContain("initBrandImages");
    expect(SITE_RUNTIME_JS).toContain("nav-brand--logo");
  });
});

describe("mobile nav chrome", () => {
  it("emits toggle + mobile link list", () => {
    const html = renderStickyNav(
      [
        { label: "Home", href: "index.html" },
        { label: "Commentary", href: "commentary.html" },
        { label: "Income statement", href: "financials/income-statement.html" },
        { label: "Downloads", href: "downloads.html" },
      ],
      "index.html",
    );
    expect(html).toContain('data-nav-toggle');
    expect(html).toContain('id="nav-mobile"');
    expect(html).toContain("nav-mobile__link");
    expect(html).toContain("commentary.html");
    expect(renderSelectionTooltip()).toContain("sel-share-copy");
    expect(renderSelectionTooltip()).toContain("sel-share-mark");
    expect(renderSelectionTooltip()).toContain("sel-share-linkedin");
    expect(renderSelectionTooltip()).toContain("share-tip__label");
  });
});

describe("home KPI segmentation", () => {
  it("extracts verbatim DRD highlight figures without inventing digits", () => {
    const cards = segmentHighlightKpis(DRD_HIGHLIGHTS, "ext:blk-0004");
    expect(cards.length).toBeGreaterThanOrEqual(5);
    const values = cards.map((c) => c.display);
    expect(values.some((v) => v.includes("2 712.8"))).toBe(true);
    expect(values.some((v) => v.includes("1 932.4"))).toBe(true);
    expect(values.some((v) => /50\s*SA\s*cps/i.test(v))).toBe(true);
    expect(values.some((v) => v.includes("1 651.3"))).toBe(true);
    expect(values.some((v) => v.includes("48"))).toBe(true);
    expect(values.some((v) => v.includes("2 337"))).toBe(true);
    for (const c of cards) {
      expect(DRD_HIGHLIGHTS.replace(/\s+/g, "")).toContain(c.display.replace(/\s+/g, ""));
      expect(c.countup).toBeGreaterThan(0);
    }
  });

  it("renders data-countup spans with data-final matching valueText", () => {
    const cards = segmentHighlightKpis(DRD_HIGHLIGHTS);
    const html = renderKpiCardsHtml(cards);
    expect(html).toContain('data-dna-component="kpi-grid"');
    expect(html).toContain("data-countup=");
    expect(html).toContain("data-final=");
    expect(html).toContain("data-allow-number");
    expect(html).toContain("kpi-card");
    expect(html).toContain("kpi-title");
    expect(html).toContain("Operating Profit");
    expect(html).toContain("kpi-delta");
    expect(html).toContain("2 712.8");
  });
});
