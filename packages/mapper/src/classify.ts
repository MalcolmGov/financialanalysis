import type { ExtractionResult, ExtractionTable, SectionKind, StatementType } from "@rs/contracts";

/**
 * Rule-based classification, grounded in IFRS/JSE naming conventions (which are
 * highly conventional — the lexicon carries ~85% of a Workiva-style results
 * PDF). Ambiguous nodes would fall to an AI classify-by-ID pass and a human
 * mapping queue; that lane is additive and never rewrites content.
 */

const STATEMENT_TITLES: { re: RegExp; type: StatementType }[] = [
  { re: /profit or loss|comprehensive income|statement of (?:profit|income)/i, type: "pnl_oci" },
  { re: /financial position|balance\s*sheet/i, type: "financial_position" },
  { re: /changes in\s+equity/i, type: "changes_in_equity" },
  { re: /cash\s*flows?/i, type: "cash_flows" },
];

/** Row-label fingerprints when caption/row0 is GROUP/COMPANY/Rmillion (AFS dual-entity). */
const STATEMENT_ROW_LABELS: { re: RegExp; type: StatementType }[] = [
  { re: /^(assets|non[- ]current assets|current assets|equity and liabilities)$/i, type: "financial_position" },
  { re: /^cash\s*flows?\s+(from|used)/i, type: "cash_flows" },
  { re: /^(continuing operations|revenue\b|gross profit)/i, type: "pnl_oci" },
  { re: /^(balance at\b|stated capital|treasury shares)/i, type: "changes_in_equity" },
];

/** Weak titles that are entity headers, not statement names. */
const WEAK_TABLE_TITLE = /^(group|company|rmillion|r'?000|notes|rm\b)$/i;

const SECTION_TITLE_LEXICON: { re: RegExp; kind: SectionKind }[] = [
  { re: /^highlights$/i, kind: "highlights" },
  { re: /review of operations|group operational/i, kind: "reviewOfOperations" },
  { re: /shareholder information/i, kind: "shareholderInfo" },
  { re: /issued capital/i, kind: "issuedCapital" },
  { re: /market capitalisation|market cap/i, kind: "marketCap" },
  { re: /shareholder letter|dear shareholder/i, kind: "letter" },
  { re: /operating segments/i, kind: "segments" },
  { re: /cash dividend|dividend declaration|salient dates/i, kind: "dividendDeclaration" },
  { re: /directors?$/i, kind: "directors" },
  { re: /forward.looking/i, kind: "forwardLooking" },
  { re: /for further information|registered address/i, kind: "contacts" },
];

const NOTE_HEADING = /^(\d{1,2})\.\s+\S/;

/** Column-header fingerprints that identify a financial table. */
const PERIOD_HEADER =
  /six months ended|year ended|as at|\d{1,2}\s+\w+\s+\d{4}|unaudited|audited|reviewed|R\s?million|Rm\b|R'000|US\$m|per share|cps/i;

export interface TableClassification {
  is_financial: boolean;
  table_type: "statement" | "note" | "reconciliation" | "facts" | "sensitivity" | "wide";
  statement_type?: StatementType;
  note_number?: number;
}

/** Classify a section title string. */
export function classifySectionTitle(title: string): { kind: SectionKind; statement_type?: StatementType } {
  const normalized = title.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  for (const s of STATEMENT_TITLES) {
    if (s.re.test(normalized)) return { kind: "statement", statement_type: s.type };
  }
  // Notes band — stop assigning primary statements once notes begin.
  if (/^notes?\s+to\s+the\b/i.test(normalized) || /^notes?\s+to\s+the\s+financial/i.test(normalized)) {
    return { kind: "note" };
  }
  for (const e of SECTION_TITLE_LEXICON) {
    if (e.re.test(normalized)) return { kind: e.kind };
  }
  const note = NOTE_HEADING.exec(normalized);
  if (note) return { kind: "note" };
  return { kind: "other" };
}

export function isWeakTableTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").replace(/\u00a0/g, " ").trim();
  if (!t) return true;
  return WEAK_TABLE_TITLE.test(t);
}

/** Infer statement type from early row labels when the title is weak (e.g. "GROUP"). */
export function statementTypeFromRowLabels(table: ExtractionTable): StatementType | null {
  const labels = table.cells
    .filter((c) => c.c === 0 && !c.is_col_header)
    .sort((a, b) => a.r - b.r)
    .slice(0, 12)
    .map((c) => c.text.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);
  for (const label of labels) {
    for (const e of STATEMENT_ROW_LABELS) {
      if (e.re.test(label)) return e.type;
    }
  }
  return null;
}

export function noteNumberOf(title: string): number | null {
  const m = NOTE_HEADING.exec(title.trim());
  return m ? Number(m[1]) : null;
}

/** Header cells of a table = the top rows flagged is_col_header. */
export function headerRows(table: ExtractionTable): number {
  let n = 0;
  for (let r = 0; r < table.num_rows; r++) {
    const rowIsHeader = table.cells.some((c) => c.r === r && c.is_col_header);
    if (rowIsHeader) n = r + 1;
    else if (n > 0) break;
  }
  return n;
}

export function classifyTable(table: ExtractionTable): TableClassification {
  const headerText = table.cells
    .filter((c) => c.is_col_header)
    .map((c) => c.text)
    .join(" ");
  const title = table.cells
    .filter((c) => c.r === 0)
    .sort((a, b) => a.c - b.c)
    .map((c) => c.text)
    .join(" ");
  const isFinancial = PERIOD_HEADER.test(headerText) && table.num_cols >= 2;

  // Wide reconciliations (segments/AISC): many data columns.
  const wide = table.num_cols >= 8;
  // Sensitivity: "1%/(1%)" increase/decrease patterns.
  const sensitivity = /increase|decrease|1%|sensitivity/i.test(headerText);
  // Ops / assumptions: dedicated unit column (kg, R per kg, %, …).
  const col1 = table.cells
    .filter((c) => c.c === 1 && c.r > 0)
    .map((c) => c.text.trim())
    .filter(Boolean);
  const unitLike = col1.filter((u) => /^(kg|oz|%|R\b|US\$|R\/|years?\b)/i.test(u)).length;
  const facts =
    /review\s+of\s+operations/i.test(title) ||
    (/%\s*change/i.test(headerText) && unitLike >= 2) ||
    (col1.length >= 3 && unitLike >= Math.ceil(col1.length * 0.6) && table.num_cols <= 5);

  let table_type: TableClassification["table_type"] = "statement";
  if (wide) table_type = "wide";
  else if (sensitivity) table_type = "sensitivity";
  else if (facts) table_type = "facts";

  const fromTitle = classifySectionTitle(title).statement_type;
  const statement_type =
    fromTitle ?? (table_type === "statement" ? statementTypeFromRowLabels(table) ?? undefined : undefined);

  return { is_financial: isFinancial, table_type, statement_type };
}
