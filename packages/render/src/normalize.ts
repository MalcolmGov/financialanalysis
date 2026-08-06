/**
 * Number normalization for MATCHING ONLY — never for display. The rendered
 * site always shows the source's verbatim string; these helpers exist so the
 * DOM audit can compare a rendered token against its source cell tolerantly of
 * whitespace tokenization, while still catching a single changed digit.
 */

/** All whitespace used as thousands grouping: normal, NBSP, thin, narrow-nbsp. */
const GROUPING_WS = /[\s   ]/g;

/** Footnote markers that may trail a numeric cell. */
const TRAILING_MARKERS = /[¹²³⁴⁵⁶⁷⁸⁹⁰*#^†‡]+$/u;

/** A token that carries at least one digit (so it must be traceable). */
export const NUMERIC_TOKEN = /[0-9]/;

/**
 * Canonical comparison key for a numeric string. Strips grouping whitespace and
 * trailing footnote markers; preserves digits, decimal separators, sign,
 * parentheses and currency/unit glyphs so "2 712.8" ≡ "2 712.8" but
 * "2 712.8" ≢ "2 172.8" (a transposition is preserved and therefore caught).
 */
export function normalizeForMatch(raw: string): string {
  return raw.replace(GROUPING_WS, "").replace(TRAILING_MARKERS, "").trim();
}

/** True when two strings are the same number after grouping-whitespace tolerance. */
export function numericEquivalent(a: string, b: string): boolean {
  return normalizeForMatch(a) === normalizeForMatch(b);
}

/** Nil markers — an em/en dash or hyphen standing in for "no value". */
export function isNilMarker(raw: string): boolean {
  return ["—", "–", "-", ""].includes(raw.trim());
}
