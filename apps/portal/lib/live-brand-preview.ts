/**
 * Client-safe live brand chrome for the Results Studio iframe.
 * Mirrors the essentials of @rs/render brand-contrast without pulling render into the client bundle.
 */

const PAPER = "#FFFFFF";
const INK = "#231F20";

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Normalize to #RRGGBB uppercase, or null if invalid. */
export function normalizeBrandHex(raw: string): string | null {
  const t = raw.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(t);
  if (short) {
    const [r, g, b] = short[1]!.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const full = /^#?([0-9a-f]{6})$/i.exec(t);
  if (!full) return null;
  return `#${full[1]!.toUpperCase()}`;
}

export type LiveBrandTokens = {
  brand: string;
  onBrand: string;
  brandText: string;
  footerAccent: string;
  accent: string;
  brightBrand: boolean;
};

/** Derive iframe chrome vars from a brand accent (keeps masthead/ink/paper untouched). */
export function liveBrandTokens(
  brandHex: string,
  opts?: { ink?: string; paper?: string },
): LiveBrandTokens | null {
  const brand = normalizeBrandHex(brandHex);
  if (!brand) return null;
  const ink = normalizeBrandHex(opts?.ink ?? INK) ?? INK;
  const paper = normalizeBrandHex(opts?.paper ?? PAPER) ?? PAPER;
  const vsPaper = contrastRatio(brand, paper);
  const vsInk = contrastRatio(brand, ink);
  const onBrand = vsPaper >= vsInk ? paper : ink;
  const brandText = vsPaper >= 4.5 ? brand : ink;
  const brightBrand = relativeLuminance(brand) >= 0.55 || vsPaper < 2.2;
  return {
    brand,
    onBrand,
    brandText,
    footerAccent: brand,
    accent: brand,
    brightBrand,
  };
}

/** Apply brand chrome CSS variables on an IR preview document. */
export function applyLiveBrandToDocument(
  doc: Document,
  brandHex: string,
  opts?: { ink?: string; paper?: string },
): boolean {
  const tokens = liveBrandTokens(brandHex, opts);
  if (!tokens) return false;
  const root = doc.documentElement;
  root.style.setProperty("--dna-brand", tokens.brand);
  root.style.setProperty("--dna-accent", tokens.accent);
  root.style.setProperty("--dna-on-brand", tokens.onBrand);
  root.style.setProperty("--dna-brand-text", tokens.brandText);
  root.style.setProperty("--dna-footer-accent", tokens.footerAccent);
  if (tokens.brightBrand) {
    root.style.setProperty("--dna-bright-brand", "1");
    root.setAttribute("data-bright-brand", "1");
  } else {
    root.style.removeProperty("--dna-bright-brand");
    root.removeAttribute("data-bright-brand");
  }
  return true;
}

export function applyLiveBrandToIframe(
  iframe: HTMLIFrameElement | null,
  brandHex: string,
  opts?: { ink?: string; paper?: string },
): boolean {
  if (!iframe) return false;
  try {
    const doc = iframe.contentDocument;
    if (!doc?.documentElement) return false;
    return applyLiveBrandToDocument(doc, brandHex, opts);
  } catch {
    // Cross-origin or not ready.
    return false;
  }
}
