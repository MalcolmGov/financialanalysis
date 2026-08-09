/**
 * Bright-brand contrast — remap DNA roles so yellow/gold brands (MTN, etc.)
 * stay IR-legible. Brand accent stays vivid; chrome/text/shading stay dark.
 */

import { hexToRgb } from "./color.js";
import { IR_NEUTRAL_FALLBACKS } from "./ir-fallbacks.js";

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance 0–1. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio 1–21. */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** High-luminance fills (MTN yellow ≈ 0.78) that fail as text/chrome backgrounds. */
export function isHighLuminance(hex: string, threshold = 0.55): boolean {
  return relativeLuminance(hex) >= threshold;
}

/** Mix two hex colors; `t` is weight of `a` (0–1). */
export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const w = Math.min(1, Math.max(0, t));
  const m = (i: number) => Math.round(ra[i]! * w + rb[i]! * (1 - w));
  return `#${[m(0), m(1), m(2)].map((x) => x.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Text on brand CTA fill: paper on dark brands, ink on light (gold) brands. */
export function onBrandHex(brandHex: string, inkHex: string, paperHex: string): string {
  const vsPaper = contrastRatio(brandHex, paperHex);
  const vsInk = contrastRatio(brandHex, inkHex);
  return vsPaper >= vsInk ? paperHex : inkHex;
}

/**
 * Brand-tinted text on paper — use raw brand only when AA-ish; else ink.
 * Prevents yellow kickers / share labels on cream.
 */
export function brandTextOnPaper(brandHex: string, inkHex: string, paperHex: string): string {
  return contrastRatio(brandHex, paperHex) >= 4.5 ? brandHex : inkHex;
}

export type DnaRoleMap = Record<string, { hex?: string } | undefined>;

export interface IrChromeTokens {
  paper: string;
  ink: string;
  brand: string;
  accent: string;
  /** Dark chrome fill — never raw yellow. */
  masthead: string;
  onBrand: string;
  /** Text accents on paper (kickers, share label). */
  brandText: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  /** Soft current-period wash — never full brand paint. */
  shading: string;
  footerAccent: string;
  brightBrand: boolean;
}

/**
 * Resolve IR chrome tokens from DesignDNA palette roles.
 * Keeps brand vivid for accents/CTAs; remaps bright masthead/shading/headers.
 */
export function resolveIrChromeTokens(roles: DnaRoleMap | null | undefined): IrChromeTokens {
  const r = roles ?? {};
  const paper = r.paper?.hex ?? IR_NEUTRAL_FALLBACKS.paper;
  const ink = r.ink?.hex ?? IR_NEUTRAL_FALLBACKS.ink;
  const brand = r.brand?.hex ?? IR_NEUTRAL_FALLBACKS.brand;
  const accent = r.accent?.hex ?? brand;
  const brightBrand = isHighLuminance(brand) || contrastRatio(brand, paper) < 2.2;

  const rawMasthead = r["masthead-bg"]?.hex ?? IR_NEUTRAL_FALLBACKS.masthead;
  const mastheadUnsafe =
    isHighLuminance(rawMasthead) ||
    contrastRatio(rawMasthead, paper) < 2.5 ||
    contrastRatio("#FFFFFF", rawMasthead) < 2.8;
  const masthead = mastheadUnsafe
    ? contrastRatio(ink, paper) >= 7
      ? ink
      : IR_NEUTRAL_FALLBACKS.masthead
    : rawMasthead;

  const onBrand = onBrandHex(brand, ink, paper);
  const brandText = brandTextOnPaper(brand, ink, paper);

  const rawShade =
    r["table-shading"]?.hex ?? r["current-period-shading"]?.hex ?? IR_NEUTRAL_FALLBACKS.shading;
  const shadeUnsafe =
    isHighLuminance(rawShade) ||
    contrastRatio(rawShade, paper) < 1.35 ||
    (brightBrand && rawShade.toUpperCase() === brand.toUpperCase());
  // Keep a whisper of brand (~8%) so the cur column reads as tint, not paint.
  const shading = shadeUnsafe ? mixHex(brand, paper, 0.08) : rawShade;

  let tableHeaderBg = r["table-header-bg"]?.hex ?? IR_NEUTRAL_FALLBACKS.tableHeaderBg;
  let tableHeaderText = r["table-header-text"]?.hex ?? IR_NEUTRAL_FALLBACKS.tableHeaderText;
  if (contrastRatio(tableHeaderText, tableHeaderBg) < 3.5) {
    if (isHighLuminance(tableHeaderBg)) {
      tableHeaderBg = masthead;
      tableHeaderText = paper;
    } else if (isHighLuminance(tableHeaderText)) {
      tableHeaderText = paper;
      if (contrastRatio(tableHeaderText, tableHeaderBg) < 3.5) {
        tableHeaderBg = IR_NEUTRAL_FALLBACKS.tableHeaderBg;
        tableHeaderText = IR_NEUTRAL_FALLBACKS.tableHeaderText;
      }
    } else {
      tableHeaderBg = IR_NEUTRAL_FALLBACKS.tableHeaderBg;
      tableHeaderText = IR_NEUTRAL_FALLBACKS.tableHeaderText;
    }
  }

  const footerAccent = r["footer-accent"]?.hex ?? brand;

  return {
    paper,
    ink,
    brand,
    accent,
    masthead,
    onBrand,
    brandText,
    tableHeaderBg,
    tableHeaderText,
    shading,
    footerAccent,
    brightBrand,
  };
}

/** :root block for multipage IR export / studio shell. */
export function buildIrTokenBlock(
  roles: DnaRoleMap | null | undefined,
  fonts?: { heading?: string; body?: string },
): string {
  const t = resolveIrChromeTokens(roles);
  const decl = [
    `--dna-paper:${t.paper}`,
    `--dna-ink:${t.ink}`,
    `--dna-brand:${t.brand}`,
    `--dna-accent:${t.accent}`,
    `--dna-masthead:${t.masthead}`,
    `--dna-on-brand:${t.onBrand}`,
    `--dna-brand-text:${t.brandText}`,
    `--dna-table-header-bg:${t.tableHeaderBg}`,
    `--dna-table-header-text:${t.tableHeaderText}`,
    `--dna-shading:${t.shading}`,
    `--dna-footer-accent:${t.footerAccent}`,
  ];
  if (t.brightBrand) decl.push(`--dna-bright-brand:1`);
  if (fonts?.heading) decl.push(`--dna-font-heading:${fonts.heading}`);
  if (fonts?.body) decl.push(`--dna-font-body:${fonts.body}`);
  return `:root{${decl.join(";")}}`;
}
