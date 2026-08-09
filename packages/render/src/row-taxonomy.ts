/**
 * Semantic statement row roles for WW-style fin-table presentation.
 * Classification is label + numeric presence only — never invents numbers.
 */

export type RowRole = "section" | "line" | "subtotal" | "total";

const SECTION_ONLY =
  /^(assets|equity and liabilities|equity|liabilities|cash\s*flows?\s+(from|used)\s+.+|operating activities|investing activities|financing activities)$/i;

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
  const t = label.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "line";

  if (TOTAL.test(t)) return "total";

  // Section banners (ASSETS / CASH FLOWS FROM…) win even if Docling leaked
  // a digit into the row — otherwise SPAR/AFS dual-entity CF loses bd-tan.
  if (SECTION_ONLY.test(t)) return "section";

  if (!hasNumeric) {
    return "section";
  }

  if (SUBTOTAL.test(t) || /^equity$/i.test(t)) return "subtotal";
  return "line";
}

/**
 * WW-style row classes: semantic role + border density helpers.
 * - section → r-section bd-tan (gold-muted rule)
 * - subtotal → r-subtotal bd-blue
 * - total → r-total
 * - line → r-line (hover handled in CSS)
 */
export function rowRoleClass(role: RowRole): string {
  switch (role) {
    case "section":
      return "r-section bd-tan";
    case "subtotal":
      return "r-subtotal bd-blue";
    case "total":
      return "r-total";
    default:
      return "r-line";
  }
}

/** Mark first/last numeric group edges for WW grp / grp-top / grp-bot column frames. */
export function groupBorderClass(
  role: RowRole,
  prev: RowRole | null,
  next: RowRole | null,
): string {
  if (role === "total") return " grp grp-bot";
  if (role !== "line" && role !== "subtotal") return "";
  const parts = ["grp"];
  if (prev == null || prev === "section" || prev === "total") parts.push("grp-top");
  if (next == null || next === "section" || next === "total") parts.push("grp-bot");
  return ` ${parts.join(" ")}`;
}
