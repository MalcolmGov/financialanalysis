/**
 * Advisory statement re-summing. Never a Gate A/B blocker — source PDFs warn
 * that rounding can produce computational discrepancies. Uses verbatim cell
 * strings parsed only for this check.
 */
import type { FinancialDocModel, FinTable } from "@rs/contracts";
import { classifyStatementRow, rowHasNumeric } from "./row-taxonomy.js";

export type ArithmeticDiscrepancy = {
  tableId: string;
  label: string;
  column: number;
  expected: number;
  actual: number;
};

export type ArithmeticAdvisory = {
  checked: number;
  discrepancies: number;
  note: string;
  items: ArithmeticDiscrepancy[];
};

const GROUPING = /[\s\u00a0\u202f\u2009,]/g;

export function parseAdvisoryNumber(raw: string): number | null {
  const s = raw.replace(/\u00a0/g, " ").trim();
  if (!s || /^[—–-]$/.test(s)) return null;
  const negative = s.startsWith("(") && s.endsWith(")");
  const core = (negative ? s.slice(1, -1) : s).replace(GROUPING, "").replace(/^[R$€£]+/i, "");
  if (!/\d/.test(core)) return null;
  const n = Number(core);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function closeEnough(sum: number, total: number): boolean {
  return Math.abs(sum - total) <= Math.max(0.51, Math.abs(total) * 0.005);
}

function checkStatementTable(table: FinTable): ArithmeticDiscrepancy[] {
  if (table.table_type !== "statement" || table.rows.length < 3) return [];
  const out: ArithmeticDiscrepancy[] = [];
  const maxCols = Math.max(...table.rows.map((r) => r.cells.length), 0);
  for (let col = 1; col < maxCols; col++) {
    let addends: number[] = [];
    let nested = false;
    for (const row of table.rows) {
      const label = (row.cells[0]?.raw ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const role = classifyStatementRow(label, rowHasNumeric(row.cells));
      const kind = row.cells[col]?.kind;
      const parsed = kind === "number" ? parseAdvisoryNumber(row.cells[col]?.raw ?? "") : null;
      if (role === "section") {
        addends = [];
        nested = false;
        continue;
      }
      if (role === "line" && parsed != null) {
        addends.push(parsed);
        continue;
      }
      if ((role === "subtotal" || role === "total") && parsed != null) {
        if (!nested && addends.length >= 2) {
          const sum = addends.reduce((a, b) => a + b, 0);
          if (!closeEnough(sum, parsed)) {
            out.push({
              tableId: table.id,
              label: label.slice(0, 80),
              column: col,
              expected: parsed,
              actual: Number(sum.toFixed(4)),
            });
          }
        }
        if (role === "subtotal") nested = true;
        addends = [];
        if (role === "total") nested = false;
      }
    }
  }
  return out;
}

export function arithmeticAdvisory(docModel: FinancialDocModel): ArithmeticAdvisory {
  const items: ArithmeticDiscrepancy[] = [];
  let checked = 0;
  for (const table of docModel.tables) {
    if (table.table_type !== "statement") continue;
    const found = checkStatementTable(table);
    const totals = table.rows.filter((r) => {
      const label = (r.cells[0]?.raw ?? "").replace(/\s+/g, " ").trim();
      return classifyStatementRow(label, rowHasNumeric(r.cells)) === "total";
    }).length;
    checked += totals;
    items.push(...found);
  }
  const discrepancies = items.length;
  return {
    checked,
    discrepancies,
    note:
      discrepancies === 0
        ? checked === 0
          ? "No statement totals had a simple line-item window to re-sum (nested groups skipped)."
          : "Statement totals that could be re-summed agree within rounding tolerance."
        : `${discrepancies} advisory mismatch(es) among ${checked} statement total row(s). Rounding admitted by the source; not a Gate A/B fail.`,
    items: items.slice(0, 20),
  };
}
