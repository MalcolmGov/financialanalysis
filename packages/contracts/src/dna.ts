import { z } from "zod";
import { BBox, Confidence, IsoDateTime, Sha256 } from "./common.js";

/**
 * DesignDNA v1 — the machine-readable visual identity of the source PDF.
 * Producer: step 3 (probe + vision + reconciler). The single shape every
 * downstream consumer (studio, linter, chart theming) reads.
 */

export const ColorEntry = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  weight: z.number().optional(),
  sources: z.array(z.enum(["vector-fill", "glyph", "rule", "image"])).optional(),
  pages: z.array(z.number().int()).optional(),
  provenance: z.enum(["probe", "vision", "probe+vision", "human"]),
  confidence: Confidence,
  evidence: z.object({ page: z.number().int(), bbox: BBox }).optional(),
});
export type ColorEntry = z.infer<typeof ColorEntry>;

/** Well-known role keys; additional roles allowed. */
export const CORE_PALETTE_ROLES = [
  "paper",
  "ink",
  "brand",
  "accent",
  "masthead-bg",
  "table-header-bg",
  "table-header-text",
  "table-shading",
  "footer-accent",
] as const;

export const FontFaceMapping = z.object({
  web_family: z.string(),
  provider: z.enum(["fontsource-selfhost", "system", "client-upload"]),
  files: z.array(z.string()),
  licence: z.string(),
  match_quality: z.enum(["exact", "metric-compatible", "panose-nearest"]),
  confidence: Confidence,
});

export const DnaFontFace = z.object({
  pdf_name: z.string(),
  family: z.string(),
  weight: z.number().int(),
  italic: z.boolean(),
  role: z.enum(["headings", "body", "table"]),
  glyph_share: z.number(),
  embedded: z.boolean(),
  mapping: FontFaceMapping,
});

export const DnaTableStyle = z.object({
  header_bg: z.string(),
  header_text: z.string(),
  header_case: z.string(),
  rules: z.record(
    z.string(),
    z.object({ pt: z.number(), color: z.string(), bold: z.boolean().optional() }),
  ),
  zebra: z.boolean(),
  period_shading: z
    .object({ role: z.string(), target: z.string() })
    .nullable(),
  numeric_alignment: z.enum(["right", "left"]),
  negative_format: z.enum(["parentheses", "minus"]),
  thousands_separator: z.enum(["thin-space", "space", "comma", "none"]),
  decimal_places: z.string(),
  units_header: z.string().optional(),
});

export const DesignDNA = z.object({
  schema_version: z.literal("dna/1"),
  dna_id: z.string(),
  project_id: z.string(),
  /** Bumped by human edits. */
  revision: z.number().int().min(1),
  source_pdf: z.object({ sha256: Sha256, pages: z.number().int() }),
  confidence: z.object({
    overall: Confidence,
    flags: z.array(
      z.object({ path: z.string(), reason: z.string(), confidence: Confidence }),
    ),
  }),
  palette: z.object({
    /** Role name → measured color. Vision assigns roles; probe supplies values. */
    roles: z.record(z.string(), ColorEntry),
    measured: z.array(ColorEntry),
    /** Imagery ramp (banner/photo quantization) — motif use only, never text. */
    imagery: z.array(z.string()),
  }),
  type: z.object({
    faces: z.array(DnaFontFace),
    stack: z.object({ heading: z.string(), body: z.string() }),
    scale: z.object({
      observed_pt: z.array(z.number()),
      web_base_px: z.number(),
      ratio: z.number(),
    }),
    heading_treatment: z.object({
      color: z.string(),
      case: z.string(),
      weight: z.number().int(),
    }),
  }),
  spacing: z.object({
    rhythm_px: z.array(z.number()),
    page_margins_pt: z.array(z.number()),
    columns: z.record(z.string(), z.number().int()),
  }),
  table_style: DnaTableStyle,
  components: z.array(
    z.object({
      id: z.string(),
      evidence: z.object({ page: z.number().int(), bbox: BBox }).optional(),
      spec: z.string(),
    }),
  ),
  motifs: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["photography", "logo", "text", "pattern"]),
      asset_role: z.string().optional(),
      value: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
  tone_words: z.array(z.string()),
  theme: z.object({
    mode: z.enum(["single-light", "single-dark", "dual"]),
    rationale: z.string(),
  }),
  human_edits: z.array(
    z.object({
      path: z.string(),
      from: z.unknown(),
      to: z.unknown(),
      by: z.string(),
      at: IsoDateTime,
    }),
  ),
});
export type DesignDNA = z.infer<typeof DesignDNA>;

/** resumeHook payload for the DNA approval gate. */
export const DnaCorrection = z.object({
  schema_version: z.literal("dna-correction/1"),
  dna_id: z.string(),
  edits: z.array(z.object({ path: z.string(), value: z.unknown() })),
  approve: z.boolean(),
  approved_by: z.string(),
  note: z.string().optional(),
});
export type DnaCorrection = z.infer<typeof DnaCorrection>;

export const BrandAssetBundle = z.object({
  schema_version: z.literal("assets/1"),
  project_id: z.string(),
  assets: z.array(
    z.object({
      role: z.string(),
      blob_path: z.string().optional(),
      css: z.string().optional(),
      px: z.tuple([z.number().int(), z.number().int()]).optional(),
      mime: z.string().optional(),
      licence: z.string().optional(),
      origin: z.string().optional(),
      background: z.string().optional(),
    }),
  ),
  embed_budget_bytes: z.number().int(),
});
export type BrandAssetBundle = z.infer<typeof BrandAssetBundle>;

export const ClientBrief = z.object({
  schema_version: z.literal("brief/1"),
  project_id: z.string(),
  company_name: z.string(),
  report_title: z.string(),
  audience: z.enum(["investors", "media", "both"]),
  must_include_sections: z.array(z.string()).default([]),
  tone_notes: z.string().default(""),
  theme_preference: z.enum(["auto", "light", "dark", "both"]).default("auto"),
  /** Inspiration only — NEVER copied; never fetched by the generator. */
  reference_sites: z.array(z.string()).default([]),
  /** Official logo upload (recommended path — removes the weakest extraction link). */
  logo_blob_path: z.string().nullable().default(null),
  /** Commissioned / official hero photography (full-bleed masthead). */
  hero_blob_path: z.string().nullable().default(null),
  language: z.string().default("en-ZA"),
});
export type ClientBrief = z.infer<typeof ClientBrief>;

const BrandKitAsset = z.object({
  blob_path: z.string().min(1),
  mime: z.string().min(1),
  filename: z.string().optional(),
  uploaded_at: IsoDateTime,
  uploaded_by: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
});

/**
 * Operator/client brand kit — official SVG/PNG wordmark + full-bleed hero photo.
 * Prefer these over extraction-heuristic figures when present.
 */
export const ProjectBrandKit = z.object({
  schema_version: z.literal("brand-kit/1"),
  project_id: z.string(),
  logo: BrandKitAsset.nullable().default(null),
  hero: BrandKitAsset.extend({
    /** Client hero is always treated as full-bleed photo (not PDF strip). */
    kind: z.literal("photo").default("photo"),
  })
    .nullable()
    .default(null),
  updated_at: IsoDateTime,
});
export type ProjectBrandKit = z.infer<typeof ProjectBrandKit>;

export const PublishChecklistItem = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "fail", "warn", "na"]),
  detail: z.string().optional(),
  critical: z.boolean().default(false),
});
export type PublishChecklistItem = z.infer<typeof PublishChecklistItem>;

/** IR head / CFO formal acceptance of the multipage delivery pack. */
export const PublishSignoff = z.object({
  schema_version: z.literal("publish-signoff/1"),
  project_id: z.string(),
  draft_id: z.string(),
  draft_version: z.number().int().positive(),
  signed_off_by: z.string(),
  signed_off_by_email: z.string().optional(),
  signed_off_at: IsoDateTime,
  checklist: z.array(PublishChecklistItem),
  blockers: z.array(z.string()).default([]),
  corporate_reliability: z.enum(["pass", "fail"]),
  gate_a: z.string(),
  gate_b: z.string(),
  company: z.string().optional(),
  brand_logo: z.boolean().optional(),
  brand_banner: z.boolean().optional(),
  logo_origin: z.string().optional(),
  banner_origin: z.string().optional(),
});
export type PublishSignoff = z.infer<typeof PublishSignoff>;
