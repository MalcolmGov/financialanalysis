import { z } from "zod";

/** All bboxes everywhere: PDF points, origin TOP-LEFT, y increases downward. */
export const BBox = z.object({
  l: z.number(),
  t: z.number(),
  r: z.number(),
  b: z.number(),
});
export type BBox = z.infer<typeof BBox>;

export const Prov = z.object({
  page_no: z.number().int().min(1),
  bbox: BBox,
  charspan: z.tuple([z.number().int(), z.number().int()]).optional(),
});
export type Prov = z.infer<typeof Prov>;

export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const Confidence = z.number().min(0).max(1);
export const IsoDateTime = z.string();

/** Pointer to a private-Blob object. Paths only — never URLs. */
export const BlobRef = z.object({
  blob_path: z.string().min(1),
  sha256: Sha256,
  bytes: z.number().int().nonnegative(),
  mime: z.string().optional(),
});
export type BlobRef = z.infer<typeof BlobRef>;

/**
 * What every workflow step returns: a small pointer into the artifacts
 * registry. Step return values are persisted for replay — bodies never
 * ride in them.
 */
export const ArtifactKind = z.enum([
  "source_pdf",
  "extraction_result",
  "design_dna",
  "brief",
  "brand_assets",
  "prototype_spec",
  "prototype",
  "blueprint",
  "doc_model",
  "site_plan",
  "render_tree",
  "number_audit",
  "qa_report",
  "export_bundle",
]);
export const ArtifactRef = z.object({
  schema: z.literal("ArtifactRef@1"),
  artifact_id: z.string(),
  kind: ArtifactKind,
  version: z.number().int().min(1),
  blob_path: z.string(),
  sha256: Sha256,
  bytes: z.number().int().nonnegative(),
  content_type: z.string(),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

/** Reference schemes. `ext:` = ExtractionResult node/cell, `doc:` = FinancialDocModel, `bp:` = blueprint. */
export const ExtRef = z.string().regex(/^ext:/);
export const DocRef = z.string().regex(/^doc:/);
export const BpRef = z.string().regex(/^bp:/);
/** The only string a numeric slot may ever hold. A digit is unrepresentable. */
export const NumericSlotRef = z.string().regex(/^(ext:|doc:)/);
/** Microcopy fence: AI-authored free text may contain no numerals at all. */
export const NoNumeralsText = z.string().regex(/^[^0-9]*$/);

/** Table cell address inside an extraction table: `ext:{tableId}:r{row}c{col}` */
export const cellRef = (tableId: string, row: number, col: number): string =>
  `ext:${tableId}:r${row}c${col}`;
export const parseCellRef = (
  ref: string,
): { table_id: string; row: number; col: number } | null => {
  const m = /^ext:(.+):r(\d+)c(\d+)$/.exec(ref);
  return m ? { table_id: m[1], row: Number(m[2]), col: Number(m[3]) } : null;
};
