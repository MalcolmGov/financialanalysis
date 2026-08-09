import { describe, expect, it } from "vitest";
import {
  brandTextOnPaper,
  buildIrTokenBlock,
  contrastRatio,
  isHighLuminance,
  onBrandHex,
  resolveIrChromeTokens,
} from "./brand-contrast.js";

const MTN = {
  paper: { hex: "#FFFFFF" },
  ink: { hex: "#262626" },
  brand: { hex: "#FFCB04" },
  accent: { hex: "#E8A400" },
  "masthead-bg": { hex: "#FFCB04" },
  "table-header-bg": { hex: "#FFFFFF" },
  "table-header-text": { hex: "#FFFFFF" },
  "current-period-shading": { hex: "#FFCB04" },
  "footer-accent": { hex: "#FFCB04" },
};

describe("brand-contrast", () => {
  it("flags MTN yellow as high-luminance", () => {
    expect(isHighLuminance("#FFCB04")).toBe(true);
    expect(isHighLuminance("#1B2A3A")).toBe(false);
  });

  it("puts dark ink on MTN yellow CTAs", () => {
    expect(onBrandHex("#FFCB04", "#262626", "#FFFFFF")).toBe("#262626");
  });

  it("refuses yellow text on paper", () => {
    expect(brandTextOnPaper("#FFCB04", "#262626", "#FFFFFF")).toBe("#262626");
    expect(contrastRatio("#FFCB04", "#FFFFFF")).toBeLessThan(4.5);
  });

  it("remaps MTN masthead/shading/headers for IR chrome", () => {
    const t = resolveIrChromeTokens(MTN);
    expect(t.brightBrand).toBe(true);
    expect(t.brand).toBe("#FFCB04");
    expect(t.masthead).toBe("#262626");
    expect(t.onBrand).toBe("#262626");
    expect(t.brandText).toBe("#262626");
    expect(t.shading.toUpperCase()).not.toBe("#FFCB04");
    // Soft brand wash — still light, but ink on it stays AA-readable.
    expect(contrastRatio(t.ink, t.shading)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.tableHeaderText, t.tableHeaderBg)).toBeGreaterThanOrEqual(3.5);
  });

  it("keeps dark brand mastheads (DRD-like) intact", () => {
    const t = resolveIrChromeTokens({
      paper: { hex: "#FFFFFF" },
      ink: { hex: "#231F20" },
      brand: { hex: "#FCAF17" },
      "masthead-bg": { hex: "#0F3B2E" },
      "table-header-bg": { hex: "#839097" },
      "table-header-text": { hex: "#FFFFFF" },
      "table-shading": { hex: "#F2F2F2" },
    });
    expect(t.masthead).toBe("#0F3B2E");
    expect(t.brand).toBe("#FCAF17");
    expect(t.onBrand).toBe("#231F20");
  });

  it("emits brand-text + bright-brand flag in token block", () => {
    const css = buildIrTokenBlock(MTN, {
      heading: "'Public Sans', sans-serif",
      body: "'Public Sans', sans-serif",
    });
    expect(css).toContain("--dna-masthead:#262626");
    expect(css).toContain("--dna-brand:#FFCB04");
    expect(css).toContain("--dna-brand-text:#262626");
    expect(css).toContain("--dna-on-brand:#262626");
    expect(css).toContain("--dna-bright-brand:1");
    expect(css).not.toMatch(/--dna-masthead:#FFCB04/i);
  });
});
