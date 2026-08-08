import type { ExtractionResult, ExtractionTable, SectionKind, StatementType } from "@rs/contracts";

/**
 * Rule-based classification, grounded in IFRS/JSE naming conventions (which are
 * highly conventional — the lexicon carries ~85% of a Workiva-style results
 * PDF). Ambiguous nodes would fall to an AI classify-by-ID pass and a human
 * mapping queue; that lane is additive and never rewrites content.
 */

const STATEMENT_TITLES: { re: RegExp; type: StatementType }[] = [
  { re: /profit or loss|comprehensive income/i, type: "pnl_oci" },
  { re: /financial position/i, type: "financial_position" },
  { re: /changes in equity/i, type: "changes_in_equity" },
  { re: /cash flows?/i, type: "cash_flows" },
];

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
  for (const s of STATEMENT_TITLES) {
    if (s.re.test(title)) return { kind: "statement", statement_type: s.type };
  }
  for (const e of SECTION_TITLE_LEXICON) {
    if (e.re.test(title)) return { kind: e.kind };
  }
  const note = NOTE_HEADING.exec(title.trim());
  if (note) return { kind: "note" };
  return { kind: "other" };
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

  return { is_financial: isFinancial, table_type };
}
