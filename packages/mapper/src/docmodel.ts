import type {
  DocCell,
  ExtractionResult,
  ExtractionTable,
  FinancialDocModel,
  FinTable,
} from "@rs/contracts";
import { classifyTable, headerRows } from "./classify.js";

/**
 * ExtractionResult → FinancialDocModel. Numbers are NEVER re-interpreted: each
 * cell keeps its verbatim `raw` string and a `src_ref` back to the extraction.
 * Classification only labels; it never rewrites a value. The mapper's `kind`
 * decision (number | text | nil | noteRef) governs how the renderer tags a cell
 * for the audit — it does not alter the displayed string.
 */

const NIL = /^[—–-]$/;
const DIGIT = /[0-9]/;
/** A note cross-reference column cell: a bare small integer (e.g. "5"). */
const NOTE_REF = /^\d{1,2}$/;

function cellKind(text: string, isRowHeader: boolean, colIndex: number): DocCell["kind"] {
  const t = text.trim();
  if (t === "") return "text";
  if (NIL.test(t)) return "nil";
  if (isRowHeader || colIndex === 0) return "text";
  if (!DIGIT.test(t)) return "text";
  return "number";
}

function buildFinTable(table: ExtractionTable, docTableId: string, mustAppear: boolean): FinTable {
  const nHeader = headerRows(table);
  const byPos = new Map<string, (typeof table.cells)[number]>();
  for (const c of table.cells) byPos.set(`${c.r}:${c.c}`, c);

  // Header matrix: the top nHeader rows.
  const header_matrix = [];
  for (let r = 0; r < nHeader; r++) {
    const row = [];
    for (let c = 0; c < table.num_cols; c++) {
      const cell = byPos.get(`${r}:${c}`);
      row.push({
        raw: cell?.text ?? "",
        col_span: cell?.col_span ?? 1,
        row_span: cell?.row_span ?? 1,
        src_ref: `ext:${table.id}:r${r}c${c}`,
      });
    }
    header_matrix.push(row);
  }

  // Data rows.
  const rows = [];
  for (let r = nHeader; r < table.num_rows; r++) {
    const cells: DocCell[] = [];
    for (let c = 0; c < table.num_cols; c++) {
      const cell = byPos.get(`${r}:${c}`);
      const raw = cell?.text ?? "";
      const isRowHeader = cell?.is_row_header ?? false;
      let kind = cellKind(raw, isRowHeader, c);
      if (kind === "number" && NOTE_REF.test(raw.trim()) && c === 1) {
        // A small-integer second column adjacent to the label is a note ref,
        // not a data value (IAS 1 "Notes" column) — do not treat as a number.
        kind = "noteRef";
      }
      cells.push({
        src_ref: `ext:${table.id}:r${r}c${c}`,
        raw,
        kind,
        footnote_refs: [],
        ...(kind === "noteRef" ? { note_number: Number(raw.trim()) || null } : {}),
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

export function mapToDocModel(
  extraction: ExtractionResult,
  meta: FinancialDocModel["meta"],
): FinancialDocModel {
  const tables: FinTable[] = [];
  const sections: FinancialDocModel["sections"] = [];

  let i = 0;
  for (const [extId, table] of Object.entries(extraction.tables)) {
    const cls = classifyTable(table);
    if (!cls.is_financial) continue;
    i++;
    const docId = `doc:tbl_${i}`;
    // Statements and notes must appear in full; incidental facts tables need not.
    const mustAppear = cls.table_type !== "facts";
    tables.push(buildFinTable(table, docId, mustAppear));
    sections.push({
      id: `doc:sec_${i}`,
      kind: "statement",
      title: { text: table.caption_block ?? `Table ${i}`, src_ref: `ext:${extId}:r0c0` },
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
