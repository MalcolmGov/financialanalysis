import type {
  DocCell,
  ExtractionResult,
  ExtractionTable,
  FinancialDocModel,
  FinTable,
} from "@rs/contracts";
import { classifySectionTitle, classifyTable, headerRows, noteNumberOf } from "./classify.js";

/**
 * ExtractionResult → FinancialDocModel. Numbers are NEVER re-interpreted: each
 * cell keeps its verbatim `raw` string and a `src_ref` back to the extraction.
 * Classification only labels; it never rewrites a value. The mapper's `kind`
 * decision (number | text | nil | noteRef) governs how the renderer tags a cell
 * for the audit — it does not alter the displayed string.
 */

const NIL = /^[—–-]$/;
const DIGIT = /[0-9]/;
/** Notes column: "5" or "5, 7" — cross-refs, not financial figures. */
const NOTE_REF = /^\d{1,2}(?:\s*,\s*\d{1,2})*$/;

function cellKind(text: string, isRowHeader: boolean, colIndex: number): DocCell["kind"] {
  const t = text.trim();
  if (t === "") return "text";
  if (NIL.test(t)) return "nil";
  if (isRowHeader || colIndex === 0) return "text";
  if (!DIGIT.test(t)) return "text";
  return "number";
}

type ExtCell = ExtractionTable["cells"][number];

/**
 * Resolve header colspan without inventing columns.
 * Docling often marks the title colspan=2 while also emitting a discrete Notes
 * cell at c+1 — trusting both yields 5 logical cols vs 4 body cols and shreds
 * the table layout (numbers land in the notes col width).
 */
function resolvedHeaderColSpan(
  claimed: number,
  r: number,
  c: number,
  numCols: number,
  byPos: Map<string, ExtCell>,
): number {
  let span = Math.max(1, claimed);
  for (let k = 1; k < span && c + k < numCols; k++) {
    if (byPos.has(`${r}:${c + k}`)) {
      span = 1;
      break;
    }
  }
  return Math.min(span, numCols - c);
}

function buildFinTable(table: ExtractionTable, docTableId: string, mustAppear: boolean): FinTable {
  const nHeader = headerRows(table);
  const byPos = new Map<string, (typeof table.cells)[number]>();
  for (const c of table.cells) byPos.set(`${c.r}:${c.c}`, c);

  // Header matrix: advance by resolved colspan so covered empty slots are skipped.
  const header_matrix = [];
  for (let r = 0; r < nHeader; r++) {
    const row = [];
    for (let c = 0; c < table.num_cols; ) {
      const cell = byPos.get(`${r}:${c}`);
      const col_span = resolvedHeaderColSpan(cell?.col_span ?? 1, r, c, table.num_cols, byPos);
      row.push({
        raw: cell?.text ?? "",
        col_span,
        row_span: cell?.row_span ?? 1,
        src_ref: `ext:${table.id}:r${r}c${c}`,
      });
      c += col_span;
    }
    header_matrix.push(row);
  }

  // Data rows — dense grid (one cell per column).
  const rows = [];
  for (let r = nHeader; r < table.num_rows; r++) {
    const cells: DocCell[] = [];
    for (let c = 0; c < table.num_cols; c++) {
      const cell = byPos.get(`${r}:${c}`);
      const raw = cell?.text ?? "";
      const isRowHeader = cell?.is_row_header ?? false;
      let kind = cellKind(raw, isRowHeader, c);
      if (kind === "number" && NOTE_REF.test(raw.trim()) && c === 1) {
        // Notes column cross-ref — not a data value.
        kind = "noteRef";
      }
      cells.push({
        src_ref: `ext:${table.id}:r${r}c${c}`,
        raw,
        kind,
        footnote_refs: [],
        ...(kind === "noteRef"
          ? { note_number: Number(raw.trim().split(/\s*,\s*/)[0]!) || null }
          : {}),
      });
    }
    rows.push({ cells });
  }

  const cls = classifyTable(table);
  return {
    id: docTableId,
    src_table: `ext:${table.id}`,
    must_appear: mustAppear,
    table_type: cls.table_type,
    header_matrix,
    unit_context: { default: "Rm", per_row: {} },
    row_groups: [],
    rows,
  };
}

type Body = ExtractionResult["body"];
type BlockNode = Body[number];

function flattenBody(nodes: Body, out: BlockNode[] = []): BlockNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) flattenBody(n.children, out);
  }
  return out;
}

const LETTER_START = /dear shareholder|shareholder letter/i;
const HIGHLIGHTS = /^highlights$/i;
const DIVIDEND = /cash dividend|dividend declaration|salient dates/i;
const NOTES_START = /notes to the condensed|notes to the consolidated|notes to the financial/i;
/** Prose ends where the primary statements begin. */
const STATEMENTS_START =
  /statement of (profit or loss|financial position|changes in equity|cash flows)|condensed consolidated financial statements|notes to the/i;
/**
 * Ops band start inside a long shareholder letter — DRD packs Ergo/FWGR/ops
 * summary under these headings rather than a standalone "Review of operations".
 */
const OPS_BAND_START =
  /^(review of operations|group operational\b|operational$|ergo mining proprietary|far west gold recoveries)/i;
/** Trailing letter chrome that belongs with dividend / close, not ops. */
const LETTER_TRAILING_STOP = /^(cash dividend|dividend declaration|looking ahead|ni[eë]l\s)/i;

/**
 * Prose sections from reading-ordered body blocks — deterministic.
 * Letter runs to the first financial-statements heading; notes run from the
 * notes heading to EOF; other lexicon headings take the following prose window.
 */
export function extractProseSections(extraction: ExtractionResult): FinancialDocModel["sections"] {
  const flat = flattenBody(extraction.body);
  const sections: FinancialDocModel["sections"] = [];

  const proseBlocks = (start: number, stop: (b: BlockNode, i: number) => boolean) => {
    const blocks: { kind: "paragraph" | "heading" | "list"; text: string; src_ref: string }[] = [];
    for (let i = start; i < flat.length; i++) {
      const b = flat[i];
      if (i > start && stop(b, i)) break;
      // Section title is stored on the section; skip the opening heading node.
      if (i === start && b.type === "heading") continue;
      if (b.text && (b.type === "paragraph" || b.type === "list_item" || b.type === "heading")) {
        const kind = b.type === "heading" ? "heading" : b.type === "list_item" ? "list" : "paragraph";
        blocks.push({ kind, text: b.text, src_ref: `ext:${b.id}` });
      }
    }
    return blocks;
  };

  const letterStart = flat.findIndex((b) => b.type === "heading" && LETTER_START.test(b.text ?? ""));
  if (letterStart >= 0) {
    const blocks = proseBlocks(letterStart, (b) => b.type === "heading" && STATEMENTS_START.test(b.text ?? ""));
    if (blocks.length) {
      // Prefer a dedicated ops band when the letter swallows operational prose.
      const opsAt = blocks.findIndex(
        (b) => b.kind === "heading" && OPS_BAND_START.test((b.text ?? "").trim()),
      );
      const trailAt = blocks.findIndex(
        (b) => b.kind === "heading" && LETTER_TRAILING_STOP.test((b.text ?? "").trim()),
      );
      let letterBlocks = blocks;
      let opsBlocks: typeof blocks = [];
      if (opsAt >= 0) {
        const opsEnd = trailAt > opsAt ? trailAt : blocks.length;
        letterBlocks = blocks.slice(0, opsAt);
        opsBlocks = blocks.slice(opsAt, opsEnd);
        // Keep post-ops closing narrative (Looking Ahead / signoff) on the letter
        // when it trails the dividend stop — dividend section owns Cash Dividend.
        if (trailAt > opsAt) {
          const after = blocks.slice(trailAt).filter((b) => {
            const t = (b.text ?? "").trim();
            return !DIVIDEND.test(t) && !/^cash dividend$/i.test(t);
          });
          // Looking Ahead + CEO signoff stay with the letter when present after ops.
          const closeStart = after.findIndex(
            (b) => b.kind === "heading" && /^looking ahead/i.test((b.text ?? "").trim()),
          );
          if (closeStart >= 0) letterBlocks = [...letterBlocks, ...after.slice(closeStart)];
        }
      } else if (trailAt >= 0) {
        // No ops heading — still peel Cash Dividend out of the letter body.
        letterBlocks = blocks.slice(0, trailAt);
        const after = blocks.slice(trailAt);
        const closeStart = after.findIndex(
          (b) => b.kind === "heading" && /^looking ahead/i.test((b.text ?? "").trim()),
        );
        if (closeStart >= 0) letterBlocks = [...letterBlocks, ...after.slice(closeStart)];
      }
      if (letterBlocks.length) {
        sections.push({
          id: "doc:sec_letter",
          kind: "letter",
          title: {
            text: flat[letterStart].text ?? "Shareholder letter",
            src_ref: `ext:${flat[letterStart].id}`,
          },
          blocks: letterBlocks,
          items: [],
        });
      }
      if (opsBlocks.length) {
        sections.push({
          id: "doc:sec_reviewOfOperations",
          kind: "reviewOfOperations",
          title: {
            text: opsBlocks[0]?.text?.trim() || "Review of operations",
            src_ref: opsBlocks[0]?.src_ref ?? `ext:${flat[letterStart].id}`,
          },
          blocks: opsBlocks,
          items: [],
        });
      }
    }
  }

  const hiStart = flat.findIndex((b) => b.type === "heading" && HIGHLIGHTS.test((b.text ?? "").trim()));
  if (hiStart >= 0) {
    const blocks = proseBlocks(hiStart, (b) => b.type === "heading");
    if (blocks.length)
      sections.push({
        id: "doc:sec_highlights",
        kind: "highlights",
        title: { text: "Highlights", src_ref: `ext:${flat[hiStart].id}` },
        blocks,
        items: [],
      });
  }

  const divStart = flat.findIndex((b) => b.type === "heading" && DIVIDEND.test(b.text ?? ""));
  if (divStart >= 0) {
    const blocks = proseBlocks(divStart, (b) => b.type === "heading" && !DIVIDEND.test(b.text ?? ""));
    if (blocks.length)
      sections.push({
        id: "doc:sec_dividend",
        kind: "dividendDeclaration",
        title: { text: flat[divStart].text ?? "Cash dividend", src_ref: `ext:${flat[divStart].id}` },
        blocks,
        items: [],
      });
  }

  const notesStart = flat.findIndex((b) => b.type === "heading" && NOTES_START.test(b.text ?? ""));
  if (notesStart >= 0) {
    const blocks = proseBlocks(notesStart, () => false);
    if (blocks.length)
      sections.push({
        id: "doc:sec_notes",
        kind: "note",
        title: { text: flat[notesStart].text ?? "Notes", src_ref: `ext:${flat[notesStart].id}` },
        blocks,
        items: [],
      });
  }

  // Lexicon-driven short sections on the cover (shareholder info, directors, …).
  const seenKinds = new Set(sections.map((s) => s.kind));
  for (let i = 0; i < flat.length; i++) {
    const b = flat[i];
    if (b.type !== "heading" || !b.text) continue;
    const { kind } = classifySectionTitle(b.text);
    if (
      kind === "other" ||
      kind === "statement" ||
      kind === "letter" ||
      kind === "highlights" ||
      kind === "dividendDeclaration" ||
      kind === "note" ||
      seenKinds.has(kind)
    ) {
      continue;
    }
    const blocks = proseBlocks(i, (n) => n.type === "heading");
    if (!blocks.length) continue;
    seenKinds.add(kind);
    sections.push({
      id: `doc:sec_${kind}`,
      kind,
      title: { text: b.text, src_ref: `ext:${b.id}` },
      blocks,
      items: [],
    });
  }

  return sections;
}

function extractionTableTitle(table: ExtractionTable, extId: string): string {
  if (table.caption_block?.trim()) return table.caption_block.trim();
  const row0 = table.cells
    .filter((c) => c.r === 0)
    .sort((a, b) => a.c - b.c)
    .map((c) => c.text.trim())
    .filter(Boolean);
  if (row0[0]) return row0[0];
  return `Table ${extId}`;
}

export function mapToDocModel(
  extraction: ExtractionResult,
  meta: FinancialDocModel["meta"],
): FinancialDocModel {
  const tables: FinTable[] = [];
  const sections: FinancialDocModel["sections"] = [...extractProseSections(extraction)];

  let i = 0;
  for (const [extId, table] of Object.entries(extraction.tables)) {
    const cls = classifyTable(table);
    // Full-document fidelity: include every extracted table (ops, facts, notes).
    i++;
    const docId = `doc:tbl_${i}`;
    const mustAppear = true;
    tables.push(buildFinTable(table, docId, mustAppear));
    const title = extractionTableTitle(table, extId);
    const titleCls = classifySectionTitle(title);
    const noteNum = noteNumberOf(title);
    const sectionKind =
      noteNum != null || titleCls.kind === "note"
        ? ("note" as const)
        : cls.table_type === "sensitivity" || /segment/i.test(title) || titleCls.kind === "segments"
          ? ("segments" as const)
          : titleCls.statement_type || cls.is_financial
            ? ("statement" as const)
            : ("other" as const);
    sections.push({
      id: `doc:sec_tbl_${i}`,
      kind: sectionKind,
      statement_type: titleCls.statement_type,
      note_number: noteNum ?? undefined,
      title: { text: title, src_ref: `ext:${extId}:r0c0` },
      blocks: [{ kind: "table", table_ref: docId }],
      items: [],
    });
  }

  return {
    schema_version: "docmodel/1",
    doc_model_id: `dm_${extraction.extraction_id}`,
    extraction_id: extraction.extraction_id,
    content_hash: extraction.source.sha256,
    meta,
    sections,
    tables,
    footnotes: [],
    mapping_review: [],
  };
}
