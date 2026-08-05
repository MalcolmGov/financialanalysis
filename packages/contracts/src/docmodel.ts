import { z } from "zod";
import { ExtRef, Sha256 } from "./common.js";

/**
 * FinancialDocModel — the typed document built by step 7's mapper.
 * Every block and cell carries a srcRef into the ExtractionResult; prose is
 * stored verbatim with a content hash so the DOM audit can verify blocks
 * wholesale. Nothing here is AI-authored content — only AI-assisted labels.
 */

export const NormalizedNumber = z.object({
  value: z.number().nullable(),
  negative: z.boolean(),
  nil: z.boolean(),
});

export const DocCellKind = z.enum(["text", "number", "nil", "noteRef"]);

export const DocCell = z.object({
  src_ref: ExtRef,
  /** VERBATIM. */
  raw: z.string(),
  kind: DocCellKind,
  normalized: NormalizedNumber.optional(),
  footnote_refs: z.array(z.string()).default([]),
  note_number: z.number().int().nullable().optional(),
});
export type DocCell = z.infer<typeof DocCell>;

export const HeaderCell = z.object({
  raw: z.string(),
  col_span: z.number().int().min(1),
  row_span: z.number().int().min(1).default(1),
  src_ref: ExtRef,
});

export const TableType = z.enum([
  "statement",
  "note",
  "reconciliation",
  "facts",
  "sensitivity",
  "wide",
]);

export const FinTable = z.object({
  id: z.string().regex(/^doc:/),
  src_table: ExtRef,
  /** All statement + note tables default true; omission is a Gate-A failure. */
  must_appear: z.boolean(),
  table_type: TableType,
  header_matrix: z.array(z.array(HeaderCell)),
  unit_context: z.object({
    default: z.string(),
    per_row: z.record(z.string(), z.string()).default({}),
  }),
  row_groups: z.array(
    z.object({
      label: z.string(),
      rows: z.array(z.number().int()),
      subtotal_row: z.number().int().nullable(),
    }),
  ),
  rows: z.array(z.object({ cells: z.array(DocCell) })),
});
export type FinTable = z.infer<typeof FinTable>;

export const SectionKind = z.enum([
  "cover",
  "highlights",
  "reviewOfOperations",
  "shareholderInfo",
  "stockTraded",
  "issuedCapital",
  "marketCap",
  "letter",
  "statement",
  "cashReconciliation",
  "note",
  "segments",
  "dividendDeclaration",
  "directors",
  "forwardLooking",
  "contacts",
  "disclaimers",
  "other",
]);

export const StatementType = z.enum([
  "pnl_oci",
  "financial_position",
  "changes_in_equity",
  "cash_flows",
]);

export const DocBlock = z.object({
  kind: z.enum(["heading", "paragraph", "list", "signoff", "table"]),
  /** VERBATIM prose; inline numerals ride inside and are hash-verified. */
  text: z.string().optional(),
  src_ref: ExtRef.optional(),
  text_hash: z.string().optional(),
  table_ref: z.string().optional(),
});

export const DocSection = z.object({
  id: z.string().regex(/^doc:/),
  kind: SectionKind,
  statement_type: StatementType.optional(),
  note_number: z.number().int().optional(),
  title: z.object({ text: z.string(), src_ref: ExtRef }).optional(),
  blocks: z.array(DocBlock).default([]),
  items: z
    .array(
      z.object({
        id: z.string(),
        label: z.object({ text: z.string(), src_ref: ExtRef }),
        value: z.object({ raw: z.string(), src_ref: ExtRef }),
      }),
    )
    .default([]),
});

export const FinancialDocModel = z.object({
  schema_version: z.literal("docmodel/1"),
  doc_model_id: z.string(),
  extraction_id: z.string(),
  content_hash: Sha256,
  meta: z.object({
    company: z.string(),
    period_label: z.string(),
    doc_kind: z.enum(["interim_unaudited", "interim_reviewed", "annual_audited"]),
    currency: z.string(),
  }),
  sections: z.array(DocSection),
  tables: z.array(FinTable),
  footnotes: z.array(
    z.object({
      id: z.string(),
      marker: z.string(),
      text: z.string(),
      src_ref: ExtRef,
    }),
  ),
  /** Low-confidence classifications waiting for the human mapping queue. */
  mapping_review: z.array(
    z.object({
      node_id: ExtRef,
      proposed_kind: SectionKind,
      confidence: z.number(),
      status: z.enum(["pending", "accepted", "reassigned"]),
    }),
  ),
});
export type FinancialDocModel = z.infer<typeof FinancialDocModel>;
