import { z } from "zod";
import { BBox, BlobRef, Confidence, IsoDateTime, Prov, Sha256 } from "./common.js";

/**
 * ExtractionResult v1 — the canonical output of the Docling worker.
 *
 * THE VERBATIM RULE: every `text` and cell value is a byte-for-byte string
 * from the source document. No numeric parsing, no whitespace collapsing,
 * no locale normalization. "2 712.8", "(12,4)", "R million" survive exactly.
 * The `enrichment` annex may ADD parsed candidates; it can never replace strings.
 */

export const PageInfo = z.object({
  page_no: z.number().int().min(1),
  width_pt: z.number(),
  height_pt: z.number(),
  image: z.object({
    blob_path: z.string(),
    width_px: z.number().int(),
    height_px: z.number().int(),
    scale: z.number(),
    /** px = pt * px_per_pt maps any bbox onto the page PNG with no other transform. */
    px_per_pt: z.number(),
  }),
});

export const BlockType = z.enum([
  "heading",
  "paragraph",
  "list",
  "list_item",
  "caption",
  "footnote",
  "code",
  "formula",
  "table_ref",
  "figure_ref",
  "page_header",
  "page_footer",
]);

export interface BlockNode {
  id: string;
  type: z.infer<typeof BlockType>;
  level?: number;
  /** VERBATIM. Absent on ref/container types. */
  text?: string;
  /** table_ref / figure_ref only. */
  ref?: string;
  prov: z.infer<typeof Prov>[];
  children: BlockNode[];
}
export const BlockNode: z.ZodType<BlockNode> = z.object({
  id: z.string(),
  type: BlockType,
  level: z.number().int().optional(),
  text: z.string().optional(),
  ref: z.string().optional(),
  prov: z.array(Prov),
  get children() {
    return z.array(BlockNode);
  },
}) as z.ZodType<BlockNode>;

export const TableCell = z.object({
  r: z.number().int().nonnegative(),
  c: z.number().int().nonnegative(),
  row_span: z.number().int().min(1),
  col_span: z.number().int().min(1),
  /** VERBATIM string — the only source of truth for values. */
  text: z.string(),
  is_col_header: z.boolean(),
  is_row_header: z.boolean(),
  is_section: z.boolean(),
  bbox: BBox.optional(),
  confidence: Confidence.optional(),
});
export type TableCell = z.infer<typeof TableCell>;

export const ExtractionTable = z.object({
  id: z.string(),
  caption_block: z.string().nullable(),
  prov: z.array(Prov),
  num_rows: z.number().int(),
  num_cols: z.number().int(),
  cells: z.array(TableCell),
  column_roles: z.array(z.string()).nullable(),
});
export type ExtractionTable = z.infer<typeof ExtractionTable>;

export const ExtractionFigure = z.object({
  id: z.string(),
  caption_block: z.string().nullable(),
  prov: z.array(Prov),
  image: z.object({
    blob_path: z.string(),
    mime: z.string(),
    width_px: z.number().int(),
    height_px: z.number().int(),
  }),
  classification: z.enum(["logo", "banner", "chart", "photo", "decorative"]).nullable(),
});

export const ExtractionWarning = z.object({
  code: z.enum(["SCANNED_SOURCE", "LOW_CONFIDENCE_TABLE", "FURNITURE_AMBIGUOUS"]),
  pages: z.array(z.number().int()).optional(),
  message: z.string(),
});

/**
 * Enrichment annex — owned by the extraction post-processor so the design
 * studio (step 4) has sections/KPIs at generation time (the gap the
 * adversarial review flagged). Candidates only: `value_raw` stays verbatim,
 * `numeric_annotations` never replace cell strings.
 */
export const Enrichment = z.object({
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      level: z.number().int(),
      page_span: z.tuple([z.number().int(), z.number().int()]),
      block_ids: z.array(z.string()),
    }),
  ),
  key_figures: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      /** VERBATIM, e.g. "R2 712.8 million" */
      value_raw: z.string(),
      src_ref: z.string(),
      comparative_raw: z.string().optional(),
      unit: z.string().optional(),
      page: z.number().int(),
    }),
  ),
  /** ref → parsed candidate. Advisory only. */
  numeric_annotations: z.record(
    z.string(),
    z.object({
      value: z.number().nullable(),
      negative: z.boolean(),
      nil: z.boolean(),
    }),
  ),
});

export const ExtractionResult = z.object({
  schema_version: z.literal("1.0"),
  extraction_id: z.string(),
  org_id: z.string(),
  project_id: z.string(),
  source: z.object({
    blob_path: z.string(),
    sha256: Sha256,
    size_bytes: z.number().int(),
    page_count: z.number().int(),
    pdf_meta: z.object({
      title: z.string().default(""),
      producer: z.string().default(""),
      created: z.string().default(""),
      modified: z.string().default(""),
    }),
  }),
  engine: z.object({
    docling_version: z.string(),
    backend: z.string(),
    table_mode: z.enum(["accurate", "fast"]),
    ocr_applied: z.boolean(),
    ocr_engine: z.string().nullable(),
  }),
  pages: z.array(PageInfo),
  /** Reading order. Consumers MUST use this order — never re-sort by bbox. */
  body: z.array(BlockNode),
  /** Page headers/footers. Brand-motif material for step 3; NEVER body copy for step 7. */
  furniture: z.array(BlockNode),
  tables: z.record(z.string(), ExtractionTable),
  figures: z.record(z.string(), ExtractionFigure),
  warnings: z.array(ExtractionWarning),
  enrichment: Enrichment,
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

// ── Worker job API ────────────────────────────────────────────────────────────

export const ExtractionErrorCode = z.enum([
  "NOT_A_PDF",
  "PDF_ENCRYPTED",
  "PDF_CORRUPT",
  "PAGE_LIMIT_EXCEEDED",
  "SIZE_LIMIT_EXCEEDED",
  "SOURCE_FETCH_FAILED",
  "CHECKSUM_MISMATCH",
  "EXTRACTION_TIMEOUT",
  "EXTRACTION_FAILED",
  "WORKER_CRASH",
  "CANCELLED",
]);

export const ExtractionError = z.object({
  code: ExtractionErrorCode,
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const ExtractionJobSubmit = z.object({
  schema_version: z.literal("1.0"),
  /** Idempotency key — retried steps re-attach rather than double-submit. */
  job_id: z.string(),
  org_id: z.string(),
  project_id: z.string(),
  source: z.object({
    signed_url: z.string(),
    blob_path: z.string(),
    sha256: Sha256,
    size_bytes: z.number().int(),
  }),
  output_prefix: z.string(),
  options: z.object({
    ocr: z.enum(["auto", "force", "off"]).default("auto"),
    ocr_langs: z.array(z.string()).default(["en"]),
    table_mode: z.enum(["accurate", "fast"]).default("accurate"),
    images_scale: z.number().default(2.0),
    page_range: z.tuple([z.number().int(), z.number().int()]).nullable().default(null),
    document_timeout_s: z.number().int().default(3600),
  }),
  webhook: z.object({ url: z.string(), hmac_key_id: z.string() }),
});

export const ExtractionJobStatus = z.enum([
  "queued",
  "fetching",
  "converting",
  "postprocessing",
  "uploading_assets",
  "succeeded",
  "failed",
  "cancelled",
]);

export const ExtractionStatus = z.object({
  schema_version: z.literal("1.0"),
  job_id: z.string(),
  status: ExtractionJobStatus,
  progress: z.object({
    pages_done: z.number().int(),
    total_pages: z.number().int().nullable(),
  }),
  ocr_applied: z.boolean().nullable(),
  timings_ms: z.record(z.string(), z.number()).default({}),
  error: ExtractionError.nullable(),
});

export const ExtractionResultPointer = z.object({
  schema_version: z.literal("1.0"),
  job_id: z.string(),
  extraction_json_path: z.string(),
  manifest_path: z.string(),
  stats: z.object({
    pages: z.number().int(),
    tables: z.number().int(),
    figures: z.number().int(),
    blocks: z.number().int(),
    extraction_json_bytes: z.number().int(),
    warnings: z.number().int(),
  }),
});

/** HMAC-signed, terminal-only, idempotent on job_id+status. */
export const ExtractionWebhook = z.object({
  schema_version: z.literal("1.0"),
  job_id: z.string(),
  status: z.enum(["succeeded", "failed"]),
  result_pointer: ExtractionResultPointer.nullable(),
  error: ExtractionError.nullable(),
  attempt: z.number().int(),
  sent_at: IsoDateTime,
});

export const UploadRecord = z.object({
  schema_version: z.literal("1.0"),
  upload_id: z.string(),
  org_id: z.string(),
  project_id: z.string(),
  blob_path: z.string(),
  sha256: Sha256,
  size_bytes: z.number().int(),
  page_count: z.number().int(),
  pdf_meta: z.object({
    title: z.string(),
    producer: z.string(),
    created: z.string(),
    encrypted: z.boolean(),
  }),
  status: z.enum(["validated", "rejected"]),
  uploaded_by: z.string(),
  uploaded_at: IsoDateTime,
});

export const UPLOAD_LIMITS = {
  max_bytes: 150 * 1024 * 1024,
  max_pages: 250,
} as const;
export type BlobRefT = z.infer<typeof BlobRef>;
