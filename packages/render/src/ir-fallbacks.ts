/**
 * Neutral IR chrome defaults — used when DesignDNA omits a role.
 *
 * These are intentionally NOT DRDGOLD gold/olive. Issuer look-and-feel comes
 * from DesignDNA tokens (+ Brand kit logo/hero). DRDGOLD HY1 FY2026 is a
 * reference project whose DNA supplies #FCAF17 / #0F3B2E; it is not the
 * global theme.
 */

export const IR_NEUTRAL_FALLBACKS = {
  paper: "#FFFFFF",
  ink: "#231F20",
  /** Deep slate — professional IR accent when DNA brand is absent. */
  brand: "#243B53",
  accent: "#334155",
  /** Dark slate masthead (not olive). */
  masthead: "#1B2A3A",
  tableHeaderBg: "#64748B",
  tableHeaderText: "#FFFFFF",
  shading: "#F2F2F2",
  footerAccent: "#243B53",
  /** Shadow base matching slate masthead (rgb of #0F172A). */
  shadowRgb: "15,23,42",
} as const;

/** DRDGOLD reference palette — documentation / detection only; never CSS defaults. */
export const DRDGOLD_REFERENCE_PALETTE = {
  brand: "#FCAF17",
  masthead: "#0F3B2E",
  tableHeaderBg: "#839097",
  olderBrand: "#B8912A",
} as const;

export type IrNeutralFallbacks = typeof IR_NEUTRAL_FALLBACKS;
