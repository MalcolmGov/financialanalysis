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
});
