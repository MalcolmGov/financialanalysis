import { describe, expect, it } from "vitest";
import {
  BRAND_IMG_ONERROR,
  CHROME_CSS,
  renderSelectionTooltip,
  renderShareBar,
  renderStickyNav,
} from "./chrome.js";
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
    expect(SITE_RUNTIME_JS).toContain("sel-share-email");
    expect(SITE_RUNTIME_JS).toContain("data-nav-toggle");
    expect(SITE_RUNTIME_JS).toContain("initReveal");
    expect(SITE_RUNTIME_JS).toContain("data-final");
    expect(SITE_RUNTIME_JS).toContain("showToast");
    expect(SITE_RUNTIME_JS).toContain('data-share="email"');
    expect(SITE_RUNTIME_JS).toContain("is-scrolled");
    expect(SITE_RUNTIME_JS).toContain("Escape");
    expect(SITE_RUNTIME_JS).toContain("initEscape");
    expect(SITE_RUNTIME_JS).toContain("closeMobileNav");
    expect(SITE_RUNTIME_JS).toContain("closeNavDropdowns");
    expect(SITE_RUNTIME_JS).toContain("Close menu");
    expect(SITE_RUNTIME_JS).toContain("data-brand-img");
    expect(SITE_RUNTIME_JS).toContain("data-banner-img");
    expect(SITE_RUNTIME_JS).toContain("initBrandImages");
    expect(SITE_RUNTIME_JS).toContain("failBannerImg");
    expect(SITE_RUNTIME_JS).toContain("nav-brand--logo");
    expect(SITE_RUNTIME_JS).toContain("rs-motion");
    expect(SITE_RUNTIME_JS).toContain("getBoundingClientRect");
    expect(SITE_RUNTIME_JS).toContain("setTimeout");
  });

  it("arms rs-motion only inside initReveal (not at parse time)", () => {
    const armIdx = SITE_RUNTIME_JS.indexOf("classList.add('rs-motion')");
    const initIdx = SITE_RUNTIME_JS.indexOf("function initReveal");
    expect(armIdx).toBeGreaterThan(initIdx);
  });

  it("stays lean vs WW-scale runtime bloat", () => {
    const bytes = Buffer.byteLength(SITE_RUNTIME_JS, "utf8");
    expect(bytes).toBeGreaterThan(4_000);
    expect(bytes).toBeLessThan(22_000);
  });

  it("restores exact data-final after count-up (no invented figures)", () => {
    expect(SITE_RUNTIME_JS).toContain("el.textContent = finalText");
    expect(SITE_RUNTIME_JS).toMatch(/never invent/i);
  });
});

describe("brand img fallback", () => {
  it("emits inline onerror on logo imgs", () => {
    const html = renderStickyNav(
      [{ label: "Home", href: "index.html" }],
      "index.html",
      "DRDGOLD",
      "assets/brand/logo.svg",
    );
    expect(html).toContain("data-brand-img");
    expect(html).toContain("onerror=");
    expect(html).toContain(BRAND_IMG_ONERROR.slice(0, 24));
    expect(html).toContain("nav-brand__name");
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
    expect(html).toContain("data-nav-toggle");
    expect(html).toContain('id="nav-mobile"');
    expect(html).toContain("nav-mobile__link");
    expect(html).toContain("commentary.html");
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain('aria-label="Open menu"');
  });

  it("PE CSS keeps mobile links visible without rs-motion", () => {
    expect(CHROME_CSS).toContain("html:not(.rs-motion) .nav-mobile");
    expect(CHROME_CSS).toContain("html.rs-motion .nav-mobile.is-open");
    expect(CHROME_CSS).toContain("html.nav-mobile-open");
  });

  it("full-bleeds page-shell / heroes while keeping content rails", () => {
    expect(CHROME_CSS).toMatch(
      /main\[data-dna-component="page-shell"\]\{[^}]*max-width:none/,
    );
    expect(CHROME_CSS).toMatch(/\.home-hero\{[^}]*max-width:none/);
    expect(CHROME_CSS).toMatch(/\.page-hero\{[^}]*max-width:none/);
    expect(CHROME_CSS).toMatch(/\.page-statement\{[^}]*max-width:none/);
    expect(CHROME_CSS).toMatch(/\.home-body,\.prose-body\{[^}]*max-width:1120px/);
    expect(CHROME_CSS).not.toMatch(
      /\.home-body,\.prose-body,\.page-statement\{[^}]*max-width:1120px/,
    );
  });
});

describe("share chrome", () => {
  it("emits labeled Copy / Highlight / LinkedIn / Email tip + share bar", () => {
    const tip = renderSelectionTooltip();
    expect(tip).toContain("sel-share-copy");
    expect(tip).toContain("sel-share-mark");
    expect(tip).toContain("sel-share-linkedin");
    expect(tip).toContain("sel-share-email");
    expect(tip).toContain('role="dialog"');
    expect(tip).toContain("aria-label");
    const bar = renderShareBar();
    expect(bar).toContain('data-share="copy"');
    expect(bar).toContain('data-share="linkedin"');
    expect(bar).toContain('data-share="email"');
    expect(bar).toContain("share-toast");
    expect(bar).toContain("aria-live");
    // No dead href="#" LinkedIn chrome
    expect(bar).not.toContain('href="#"');
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

  it("uses complete highlight sentences as KPI captions (no mid-phrase stubs)", () => {
    const cards = segmentHighlightKpis(DRD_HIGHLIGHTS);
    const html = renderKpiCardsHtml(cards);
    expect(html).toContain("Operating profit increased by 72% to R2 712.8 million");
    expect(html).toContain("Interim cash dividend of 50 SA cps");
    expect(html).toContain("R1 651.3 million of capital expenditure");
    expect(html).not.toMatch(/kpi-label[^>]*>Operating profit increased by 72% to</);
    expect(html).not.toMatch(/kpi-label[^>]*>Interim cash dividend of</);
  });
});
