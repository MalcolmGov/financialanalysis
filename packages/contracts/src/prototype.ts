import { z } from "zod";
import { BlobRef, Confidence, IsoDateTime, Sha256 } from "./common.js";

/**
 * Prototype conformance — ONE spec, shared by the step-4 generator and the
 * step-5 refinement engine. The linter in this package is the single gate.
 *
 * Two stored forms resolve the panel's size-cap conflict:
 *  - placeholder form: {{ASSET:*}} markers, ≤ PLACEHOLDER_MAX_BYTES.
 *    This is the ONLY form LLMs ever see (generation, patching, extraction).
 *  - assembled form: data-URI assets substituted, ≤ ASSEMBLED_MAX_BYTES.
 *    This is the ONLY form browsers ever see (preview, screenshots).
 */
export const CONFORMANCE = {
  TOKEN_PREFIX: "--dna-",
  DATA_COMPONENT_ATTR: "data-dna-component",
  DATA_SOURCE_PAGE_ATTR: "data-dna-source-page",
  CHART_CONFIG_SCRIPT_TYPE: "application/json",
  CHART_CONFIG_ATTR: "data-dna-chart",
  ASSET_PLACEHOLDER: /\{\{ASSET:[a-zA-Z0-9:_-]+\}\}/,
  PLACEHOLDER_MAX_BYTES: 250_000,
  ASSEMBLED_MAX_BYTES: 6 * 1024 * 1024,
  /** ≥ this share of :root palette values must derive from the DNA (ΔE ≤ DELTA_E_TOLERANCE). */
  DNA_PALETTE_DERIVATION_MIN: 0.9,
  DELTA_E_TOLERANCE: 4,
  /**
   * Closes the near-monochrome loophole. Financial documents are legitimately
   * ink-on-paper heavy, so a fraction cap on neutrals produces false positives.
   * Instead the design must APPLY at least this many distinct non-neutral,
   * DNA-derived colors — a pure-greyscale "one lone accent" generic site fails.
   */
  MIN_DISTINCT_BRAND_COLORS: 1,
  /** Neutral share above this is a soft warning only, never a hard fail. */
  NEUTRAL_COVERAGE_WARN: 0.95,
  FIDELITY_GATE_TOTAL: 75,
  FIDELITY_GATE_DIM_FLOOR: 0.5,
  MAX_REPAIR_ITERATIONS: 2,
} as const;

export const LintReport = z.object({
  passed: z.boolean(),
  errors: z.array(z.object({ rule: z.string(), detail: z.string() })),
  warnings: z.array(z.object({ rule: z.string(), detail: z.string() })),
});
export type LintReport = z.infer<typeof LintReport>;

export const FidelityAudit = z.object({
  schema_version: z.literal("audit/1"),
  artifact_id: z.string(),
  iteration: z.number().int(),
  token_conformance: z.object({
    pass: z.boolean(),
    token_block_verbatim: z.boolean(),
    violations: z.array(
      z.object({
        selector: z.string(),
        property: z.string(),
        value: z.string(),
        nearest_dna_delta_e: z.number().nullable(),
        fix: z.string(),
      }),
    ),
    non_neutral_area_traceability: z.number(),
    neutral_coverage: z.number(),
  }),
  banned_patterns: z.object({
    pass: z.boolean(),
    hits: z.array(z.object({ pattern: z.string(), rationale: z.string() })),
  }),
  structural: z.object({
    html_valid: z.boolean(),
    duplicate_ids: z.array(z.string()),
    external_requests: z.array(z.string()),
    chart_values_verified: z.boolean(),
    placeholders_resolved: z.boolean(),
    file_bytes: z.number().int(),
    console_errors: z.array(z.string()),
    axe_contrast_violations: z.number().int(),
    /** Numeral diff vs parent version — refinement may never alter a digit. */
    numerals_unchanged: z.boolean(),
  }),
  fidelity: z.object({
    model: z.string(),
    total: z.number(),
    dims: z.record(z.string(), z.number()),
    swap_test: z.object({ could_be_any_company: z.boolean(), why: z.string() }),
    evidence: z.array(z.string()),
  }),
  verdict: z.enum(["pass", "repair", "flagged"]),
});
export type FidelityAudit = z.infer<typeof FidelityAudit>;

export const PrototypeSpec = z.object({
  schema_version: z.literal("spec/1"),
  spec_id: z.string(),
  dna_revision: z.number().int(),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      components: z.array(z.string()).default([]),
      content_refs: z.array(z.string()).default([]),
    }),
  ),
  /** Verbatim-copy contract: the generator must reproduce this block byte-for-byte. */
  token_block: z.string(),
  chart: z.object({
    type: z.enum(["bar", "grouped-bar", "line", "donut"]),
    title: z.string(),
    categories: z.array(z.object({ text: z.string(), src_ref: z.string().optional() })),
    series: z.array(
      z.object({
        label: z.string(),
        values: z.array(z.object({ raw: z.string(), src_ref: z.string() })),
      }),
    ),
  }),
  nav: z.object({ style: z.string(), items: z.array(z.string()) }),
  asset_placeholders: z.array(z.string()),
});
export type PrototypeSpec = z.infer<typeof PrototypeSpec>;

export const RefinementMode = z.enum(["initial", "patch", "regen"]);

export const PrototypeArtifact = z.object({
  schema_version: z.literal("prototype/1"),
  prototype_version_id: z.string(),
  project_id: z.string(),
  cycle: z.number().int().min(1),
  version_number: z.number().int().min(1),
  parent_version_id: z.string().nullable(),
  /** {{ASSET:*}} form — the only form LLMs see. ≤ 250 KB. */
  placeholder_html: BlobRef,
  /** data-URI form — the only form browsers see. ≤ 6 MB. */
  assembled_html: BlobRef,
  preview: z
    .object({ desktop: BlobRef.optional(), mobile: BlobRef.optional() })
    .optional(),
  dna_ref: z.object({ dna_id: z.string(), revision: z.number().int(), sha256: Sha256 }),
  spec_ref: z.object({ spec_id: z.string(), sha256: Sha256 }).optional(),
  manifest: z.object({
    sections: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        source_pages: z.array(z.number().int()),
      }),
    ),
    components_used: z.array(z.string()),
    tokens_declared: z.number().int(),
    breakpoints: z.array(z.number().int()),
  }),
  lint_report: LintReport,
  audit: FidelityAudit.optional(),
  refinement: z.object({
    mode: RefinementMode,
    prompt_text: z.string().nullable(),
    patch: z
      .array(
        z.object({
          search: z.string(),
          replace: z.string(),
          occurrence: z.number().int().optional(),
        }),
      )
      .nullable(),
  }),
  lineage: z.object({
    passes: z.array(
      z.object({
        name: z.string(),
        model: z.string(),
        input_tokens: z.number().int().optional(),
        cache_read_tokens: z.number().int().optional(),
        output_tokens: z.number().int().optional(),
        ms: z.number().int().optional(),
      }),
    ),
    total_cost_usd: z.number(),
  }),
  /** Failed the fidelity gate after escalation; review UI must surface the audit. */
  flagged: z.boolean(),
  created_at: IsoDateTime,
});
export type PrototypeArtifact = z.infer<typeof PrototypeArtifact>;
