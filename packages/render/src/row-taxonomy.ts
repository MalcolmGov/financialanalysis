/**
 * Semantic statement row roles for WW-style fin-table presentation.
 * Classification is label + numeric presence only — never invents numbers.
 */

export type RowRole = "section" | "line" | "subtotal" | "total";

const SECTION_ONLY =
  /^(assets|equity and liabilities|equity|liabilities|cash flows from .+|operating activities|investing activities|financing activities)$/i;

const SUBTOTAL =
  /^(non-current|current)\s+(assets|liabilities)\b|\bsub[- ]?total\b|^net (cash|assets|liabilities|debt)\b|^(gross profit|operating profit|profit before|profit for the period|total comprehensive income|headline earnings)\b/i;

const TOTAL = /^total\b/i;

/** True when any cell in the row is a real number (not nil/empty). */
export function rowHasNumeric(
  cells: Array<{ kind: string; raw: string }>,
): boolean {
  return cells.some((c) => c.kind === "number" && c.raw.trim() !== "");
}

/**
 * Classify a statement body row for CSS (`r-section` / `r-line` / `r-subtotal` / `r-total`).
 */
export function classifyStatementRow(
  label: string,
  hasNumeric: boolean,
): RowRole {
  const t = label.trim();
  if (!t) return "line";

  if (TOTAL.test(t)) return "total";

  if (!hasNumeric) {
    if (SECTION_ONLY.test(t) || t.length < 48) return "section";
    return "section";
  }

  if (SUBTOTAL.test(t) || /^equity$/i.test(t)) return "subtotal";
  return "line";
}

export function rowRoleClass(role: RowRole): string {
  return `r-${role}`;
}
