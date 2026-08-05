import { z } from "zod";
import { BBox, IsoDateTime, Sha256 } from "./common.js";

/** Number-integrity audit — Gates A + B + the extraction↔PDF cross-check. Blocking. */

export const DomAuditFailure = z.object({
  page: z.string(),
  token: z.string(),
  dom_path: z.string(),
  data_src: z.string().nullable(),
  source_raw: z.string().nullable(),
  reason: z.enum([
    "verbatim-mismatch",
    "no-data-src",
    "dangling-src",
    "numeral-in-microcopy",
    "position-context-mismatch",
  ]),
  source_prov: z.object({ page: z.number().int(), bbox: BBox }).nullable(),
});

export const NumberAuditReport = z.object({
  schema_version: z.literal("audit-numbers/1"),
  audit_id: z.string(),
  site_plan_id: z.string(),
  render_hash: Sha256,
  verdict: z.enum(["pass", "fail"]),
  gates: z.object({
    referential: z.object({
      status: z.enum(["pass", "fail"]),
      dangling_refs: z.array(z.string()),
      coverage: z.object({
        must_appear_cells: z.number().int(),
        placed: z.number().int(),
        missing: z.array(z.string()),
      }),
    }),
    dom_audit: z.object({
      status: z.enum(["pass", "fail"]),
      pages_scanned: z.number().int(),
      numeric_tokens_found: z.number().int(),
      matched: z.number().int(),
      allowlisted: z.number().int(),
      failures: z.array(DomAuditFailure),
    }),
    /** Born-digital PDFs: Docling cells diffed against the pdfium text layer per bbox. */
    extraction_crosscheck: z.object({
      status: z.enum(["pass", "fail", "skipped_scanned_source"]),
      cells_checked: z.number().int(),
      mismatches: z.array(
        z.object({ cell_ref: z.string(), docling: z.string(), text_layer: z.string() }),
      ),
    }),
    arithmetic_advisory: z.object({
      checked: z.number().int(),
      discrepancies: z.number().int(),
      note: z.string(),
    }),
  }),
  /** Human-approved, per-entry justification. Nothing lands here automatically. */
  allowlist: z.array(
    z.object({
      pattern: z.string(),
      context: z.string(),
      approved_by: z.string(),
      justification: z.string(),
    }),
  ),
  blocking: z.literal(true),
});
export type NumberAuditReport = z.infer<typeof NumberAuditReport>;

export const QAReport = z.object({
  schema_version: z.literal("qa/1"),
  qa_report_id: z.string(),
  audit_id: z.string(),
  render_hash: Sha256,
  verdict: z.enum(["pass", "fail", "pass_with_warnings"]),
  automated: z.object({
    smoke: z.object({
      viewport: z.string(),
      no_body_h_scroll: z.enum(["pass", "fail"]),
      table_overflow_contained: z.enum(["pass", "fail"]),
      charts_rendered: z.enum(["pass", "fail"]),
      anchors_resolve: z.enum(["pass", "fail"]),
      external_requests: z.object({
        status: z.enum(["pass", "fail"]),
        count: z.number().int(),
      }),
    }),
    downloads: z.array(
      z.object({
        path: z.string(),
        sha256_matches_source: z.boolean(),
        bytes: z.number().int(),
      }),
    ),
    axe: z.object({
      status: z.enum(["pass", "fail"]),
      violations: z.array(z.string()),
      contrast_pairs_checked: z.number().int(),
    }),
  }),
  human_checklist: z.object({
    status: z.enum(["pending", "signed_off"]),
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        state: z.enum(["pending", "checked", "flagged"]),
        note: z.string().default(""),
      }),
    ),
    signed_off_by: z.string().nullable(),
    signed_off_at: IsoDateTime.nullable(),
  }),
  export_eligible: z.boolean(),
});
export type QAReport = z.infer<typeof QAReport>;

export const ExportBundle = z.object({
  schema_version: z.literal("export/1"),
  bundle_id: z.string(),
  project_id: z.string(),
  created_at: IsoDateTime,
  inputs: z.object({
    doc_model_hash: Sha256,
    site_plan_id: z.string(),
    blueprint_version_id: z.string(),
    blueprint_checksum: Sha256,
    render_hash: Sha256,
  }),
  integrity: z.object({
    number_audit_id: z.string(),
    qa_report_id: z.string(),
    verdict: z.literal("pass"),
    human_signoff_by: z.string(),
  }),
  entrypoints: z.object({ index: z.string() }),
  layout: z.enum(["singleFile", "multiPage"]),
  files: z.array(
    z.object({
      path: z.string(),
      bytes: z.number().int(),
      sha256: Sha256,
      content_type: z.string().optional(),
      licence: z.string().optional(),
    }),
  ),
  external_requests: z.literal(0),
  hosting: z.object({
    requires_server: z.literal(false),
    relative_links: z.literal(true),
  }),
  zip: z.object({ blob_path: z.string(), sha256: Sha256, bytes: z.number().int() }),
});
export type ExportBundle = z.infer<typeof ExportBundle>;
