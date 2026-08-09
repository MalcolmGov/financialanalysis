import { describe, expect, it } from "vitest";
import {
  normalizeIrThemeId,
  suggestIrThemeId,
  themeIdFromDna,
} from "./ir-theme.js";
import { CHROME_CSS } from "./chrome.js";

describe("ir-theme", () => {
  it("normalizes unknown values to classic", () => {
    expect(normalizeIrThemeId(undefined)).toBe("classic");
    expect(normalizeIrThemeId("bold")).toBe("classic");
    expect(normalizeIrThemeId("editorial")).toBe("editorial");
  });

  it("reads theme_id from DNA", () => {
    expect(themeIdFromDna({ theme_id: "editorial" })).toBe("editorial");
    expect(themeIdFromDna({})).toBe("classic");
  });

  it("suggests editorial for retail / SPAR signals", () => {
    const s = suggestIrThemeId({
      company: "SPAR Group Ltd",
      toneWords: ["retail", "consumer"],
      sectionKinds: ["letter", "opsReview"],
    });
    expect(s.themeId).toBe("editorial");
  });

  it("suggests classic for mining interim signals", () => {
    const s = suggestIrThemeId({
      company: "DRDGOLD Limited",
      periodLabel: "HY1 FY2026 interim results",
      signals: ["gold", "mining"],
    });
    expect(s.themeId).toBe("classic");
  });

  it("ships editorial CSS variants under data-theme", () => {
    expect(CHROME_CSS).toContain('[data-theme="editorial"]');
    expect(CHROME_CSS).toContain("[data-theme=\"editorial\"] .home-hero");
    expect(CHROME_CSS).toContain("[data-theme=\"editorial\"] .kpi-card");
  });

  it("keeps CTA contrast-safe via --dna-on-brand (not dark ink on brand)", () => {
    expect(CHROME_CSS).toMatch(
      /\.home-cta__primary\{[^}]*color:var\(--dna-on-brand,#fff\)!important/,
    );
    expect(CHROME_CSS).not.toMatch(
      /\.home-cta__primary\{[^}]*color:var\(--dna-ink,#231F20\)!important/,
    );
  });

  it("editorial hero uses charcoal ink + brand accents, not all-masthead red", () => {
    expect(CHROME_CSS).toContain(
      '[data-theme="editorial"] .home-hero h1{color:var(--dna-ink,#231F20)',
    );
    expect(CHROME_CSS).toContain(
      '[data-theme="editorial"] .home-kicker{color:var(--dna-brand-text,var(--dna-ink,#231F20))}',
    );
    expect(CHROME_CSS).toContain(
      "[data-theme=\"editorial\"] .home-hero__logo--raster{mix-blend-mode:multiply}",
    );
  });

  it("classic drops sticker raster lockups and deepens masthead fills", () => {
    expect(CHROME_CSS).toContain(
      ".home-hero--classic .home-hero__lockup:has(.home-hero__logo--raster){display:none!important}",
    );
    expect(CHROME_CSS).toMatch(
      /\.site-nav\{[^}]*background:color-mix\(in srgb,var\(--dna-masthead,#1B2A3A\) 52%,#070b12\)/,
    );
  });
});
