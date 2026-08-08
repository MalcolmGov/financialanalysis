import type { BlockNode, ExtractionResult, FinancialDocModel } from "@rs/contracts";

/**
 * Reference resolution. A numeric slot only ever holds an `ext:`/`doc:` ref;
 * resolution returns the VERBATIM source string. The AI never supplies the
 * value — it supplies the pointer, and this is where the pointer is followed.
 */

/** Optional brand imagery for multipage chrome (relative paths or data-URIs). */
export interface BrandAssetUris {
  /** Nav / hero logo — only when a real project asset exists. */
  logo?: string;
  /** Home photographic masthead / banner. */
  banner?: string;
  /**
   * Banner crop kind for hero CSS:
   * - strip: ultra-wide extraction figure (cinematic IR band)
   * - photo: wide photo figure
   * - page: full page-1 render fallback (crop to top)
   */
  bannerKind?: "strip" | "photo" | "page";
}

export interface ResolveContext {
  extraction: ExtractionResult;
  docModel: FinancialDocModel;
  /** Present when BrandAssetBundle figures were resolved for this render. */
  brandAssets?: BrandAssetUris;
}

const CELL_REF = /^ext:(.+):r(\d+)c(\d+)$/;

function findBlock(id: string, nodes: BlockNode[]): BlockNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findBlock(id, n.children);
    if (child) return child;
  }
  return null;
}

/**
 * Resolve an `ext:` ref to its verbatim string, or null.
 * Supports table cells (`ext:tableId:rNcM`) and extraction body/furniture
 * blocks (`ext:blk-0003`) used by multipage prose enrichment.
 */
export function resolveCell(ref: string, ctx: ResolveContext): string | null {
  const m = CELL_REF.exec(ref);
  if (m) {
    const [, tableId, rs, cs] = m;
    const table = ctx.extraction.tables[tableId];
    if (!table) return null;
    const r = Number(rs);
    const c = Number(cs);
    const cell = table.cells.find((x) => x.r === r && x.c === c);
    return cell ? cell.text : null;
  }
  if (ref.startsWith("ext:")) {
    const id = ref.slice("ext:".length);
    if (!id || id.includes(":")) return null;
    const block =
      findBlock(id, ctx.extraction.body) ?? findBlock(id, ctx.extraction.furniture);
    return block?.text ?? null;
  }
  return null;
}

/** True if the ref points at a resolvable source cell or block. */
export function refResolves(ref: string, ctx: ResolveContext): boolean {
  if (ref.startsWith("ext:")) {
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
