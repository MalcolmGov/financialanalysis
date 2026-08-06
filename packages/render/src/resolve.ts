import type { ExtractionResult, FinancialDocModel } from "@rs/contracts";

/**
 * Reference resolution. A numeric slot only ever holds an `ext:`/`doc:` ref;
 * resolution returns the VERBATIM source string. The AI never supplies the
 * value — it supplies the pointer, and this is where the pointer is followed.
 */

export interface ResolveContext {
  extraction: ExtractionResult;
  docModel: FinancialDocModel;
}

const CELL_REF = /^ext:(.+):r(\d+)c(\d+)$/;

/** Resolve an `ext:table:rNcM` cell ref to its verbatim string, or null. */
export function resolveCell(ref: string, ctx: ResolveContext): string | null {
  const m = CELL_REF.exec(ref);
  if (!m) return null;
  const [, tableId, rs, cs] = m;
  const table = ctx.extraction.tables[tableId];
  if (!table) return null;
  const r = Number(rs);
  const c = Number(cs);
  const cell = table.cells.find((x) => x.r === r && x.c === c);
  return cell ? cell.text : null;
}

/** True if the ref points at a resolvable source cell. */
export function refResolves(ref: string, ctx: ResolveContext): boolean {
  if (ref.startsWith("ext:") && CELL_REF.test(ref)) {
    return resolveCell(ref, ctx) !== null;
  }
  if (ref.startsWith("doc:")) {
    const id = ref;
    return (
      ctx.docModel.tables.some((t) => t.id === id) ||
      ctx.docModel.sections.some((s) => s.id === id)
    );
  }
  return false;
}

/** Find a FinancialDocModel table by its `doc:` id. */
export function findDocTable(ref: string, ctx: ResolveContext) {
  return ctx.docModel.tables.find((t) => t.id === ref) ?? null;
}
