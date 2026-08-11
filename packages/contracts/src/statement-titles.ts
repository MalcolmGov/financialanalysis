import type { StatementType } from "./docmodel.js";

export type FinancialDocKind =
  | "interim_unaudited"
  | "interim_reviewed"
  | "annual_audited";

export type StatementEntity = "group" | "company";

export interface StatementTitleOpts {
  docKind: FinancialDocKind;
  statementType: StatementType;
  /** Separate Group / Company books (MTN). */
  entity?: StatementEntity | null;
  /** Dual GROUP+COMPANY column bands (Spar). */
  dualEntity?: boolean;
  /** Source section caption — used only to drop OCI when the AFS P&L is standalone. */
  sourceTitle?: string;
  /** Operator period label (e.g. HY1 FY2026) — HY/interim beats a stale annual doc_kind. */
  periodLabel?: string;
}

const STEMS: Record<StatementType, string> = {
  pnl_oci: "Statement of Profit or Loss and Other Comprehensive Income",
  financial_position: "Statement of Financial Position",
  changes_in_equity: "Statement of Changes in Equity",
  cash_flows: "Statement of Cash Flows",
};

export function isInterimDocKind(docKind: FinancialDocKind): boolean {
  return docKind === "interim_unaudited" || docKind === "interim_reviewed";
}

/** Condensed prefix: interim doc_kind, HY/interim period, or source already says condensed. */
export function usesCondensedStatementPrefix(opts: {
  docKind: FinancialDocKind;
  periodLabel?: string;
  sourceTitle?: string;
}): boolean {
  if (isInterimDocKind(opts.docKind)) return true;
  const period = (opts.periodLabel ?? "").replace(/\u00a0/g, " ").trim();
  if (/^HY\d/i.test(period) || /\binterim\b/i.test(period) || /\bhalf[\s-]?year\b/i.test(period)) {
    return true;
  }
  return /\bcondensed\b/i.test(opts.sourceTitle ?? "");
}

function pnlStem(sourceTitle?: string): string {
  const t = (sourceTitle ?? "").replace(/\u00a0/g, " ");
  if (
    t &&
    /\bincome\s+statement\b/i.test(t) &&
    !/comprehensive|\boci\b|profit or loss/i.test(t)
  ) {
    return "Statement of Profit or Loss";
  }
  return STEMS.pnl_oci;
}

function bookPrefix(opts: StatementTitleOpts): string {
  const condensed = usesCondensedStatementPrefix(opts);
  if (opts.entity === "company") return "Company ";
  if (opts.entity === "group") {
    return condensed ? "Condensed Group " : "Group ";
  }
  return condensed ? "Condensed Consolidated " : "Consolidated ";
}

/** Official IAS 1 / IFRS page + nav title (paths stay short: income-statement.html). */
export function officialStatementTitle(opts: StatementTitleOpts): string {
  const stem =
    opts.statementType === "pnl_oci" ? pnlStem(opts.sourceTitle) : STEMS[opts.statementType];
  const title = `${bookPrefix(opts)}${stem}`;
  if (opts.dualEntity && !opts.entity) return `${title} (Group and Company)`;
  return title;
}

/** Same official wording as the page title — wrap in CSS, do not shorten. */
export function officialStatementNavLabel(opts: StatementTitleOpts): string {
  return officialStatementTitle({ ...opts, dualEntity: false });
}

export function officialStatementEyebrow(
  docKind: FinancialDocKind,
  extras?: { dualEntity?: boolean; entity?: StatementEntity | null; periodLabel?: string },
): string {
  if (extras?.dualEntity) return "Group and Company";
  if (extras?.entity === "group") return "Group statements";
  if (extras?.entity === "company") return "Company statements";
  const condensed = usesCondensedStatementPrefix({
    docKind,
    periodLabel: extras?.periodLabel,
  });
  if (!condensed && docKind === "annual_audited") return "Consolidated financial statements";
  if (docKind === "interim_reviewed") return "Condensed Consolidated — Reviewed";
  return "Condensed Consolidated — Unaudited";
}
