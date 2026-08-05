import { z } from "zod";
import { BlobRef, IsoDateTime, NumericSlotRef, Sha256 } from "./common.js";

/**
 * Blueprint v1 — the locked design authority for steps 7–9.
 *
 * THE SLOT RULE (the panel's most important consolidation): there is NO
 * numeric-literal slot type. Anything numeric is `ref`-typed and can only
 * hold an `ext:`/`doc:` reference. A transposed digit is unrepresentable.
 * Free-text slots are numeral-fenced. No slot accepts HTML, CSS, class
 * names, or token overrides.
 */

export const SlotDef = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    /** Enforced at plan validation: AI-authored text contains no numerals. */
    no_numerals: z.literal(true).default(true),
    max_chars: z.number().int().optional(),
    required: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("ref"),
    /** ^(ext:|doc:) — validated again at plan time. */
    accepts: z.enum(["cell", "block", "table", "figure", "any"]).default("any"),
    required: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("enum"),
    values: z.array(z.string()).min(1),
    required: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("asset"),
    role: z.string(),
    required: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("chart"),
    required: z.boolean().default(true),
  }),
]);
export type SlotDef = z.infer<typeof SlotDef>;

export const ComponentDef = z.object({
  id: z.string().regex(/^bp:/),
  name: z.string(),
  /** Deterministic HTML template with {{slot:*}} placeholders. Renderer-executed. */
  html: z.string(),
  css: z.string(),
  slots: z.record(z.string(), SlotDef),
  variants: z.array(z.string()).default([]),
  constraints: z
    .object({
      grid_min_per_row: z.number().int().optional(),
      grid_max_per_row: z.number().int().optional(),
      max_instances_per_page: z.number().int().optional(),
    })
    .optional(),
});
export type ComponentDef = z.infer<typeof ComponentDef>;

export const PageTemplate = z.object({
  id: z.string().regex(/^bp:/),
  name: z.string(),
  shell_html: z.string(),
  regions: z.array(
    z.object({
      id: z.string(),
      accepts: z.array(z.string()),
      min: z.number().int().default(0),
      max: z.number().int().nullable().default(null),
    }),
  ),
});
export type PageTemplate = z.infer<typeof PageTemplate>;

export const BlueprintStatus = z.enum(["proposed", "locked", "superseded", "rejected"]);

export const Blueprint = z.object({
  schema_version: z.literal("1.0"),
  blueprint_version_id: z.string(),
  project_id: z.string(),
  cycle: z.number().int().min(1),
  source_prototype_version_id: z.string(),
  source_prototype_sha256: Sha256,
  status: BlueprintStatus,
  locked_at: IsoDateTime.nullable(),
  locked_by: z.string().nullable(),
  /** sha256 of canonical JSON minus this field; stamped on every downstream artifact. */
  checksum: Sha256,

  tokens: z.object({
    /** The single :root block — the only CSS custom properties that exist. */
    css: z.string(),
    values: z.record(z.string(), z.string()),
  }),
  typography: z.object({
    font_faces: z.array(
      z.object({
        family: z.string(),
        src_blob_path: z.string().nullable(),
        licence: z.enum(["embeddable", "fallback-only"]),
        fallbacks: z.array(z.string()),
      }),
    ),
    ramp: z.array(
      z.object({
        role: z.string(),
        size: z.string(),
        weight: z.number().int(),
        token_refs: z.array(z.string()),
      }),
    ),
  }),
  breakpoints: z.array(
    z.object({
      name: z.string(),
      min_width: z.number().int().nullable(),
      max_width: z.number().int().nullable(),
      behaviour: z.string().optional(),
    }),
  ),
  navigation: z.object({
    model: z.string(),
    items: z.array(
      z.object({ id: z.string(), label: z.string(), template: z.string() }),
    ),
  }),
  page_templates: z.array(PageTemplate),
  components: z.array(ComponentDef),
  table_styles: z.object({
    header_bg: z.string(),
    header_fg: z.string(),
    current_period_shade: z.string().nullable(),
    numeric_alignment: z.enum(["right", "left"]),
    zebra: z.boolean(),
    rule_style: z.string(),
    /** Applied identically by renderer, verifier, XLSX. Source strings stay verbatim. */
    negative_number_style: z.enum(["parens", "minus"]),
    number_grouping: z.enum(["space", "thin-space", "comma", "none"]),
  }),
  chart_theme: z.object({
    /** Token refs, resolved at render — never raw hexes. */
    palette: z.array(z.string()),
    grid_color: z.string(),
    font_role: z.string(),
    number_format: z.object({
      locale: z.string(),
      thousands: z.string(),
      currency_prefix: z.string().optional(),
    }),
    allowed_chart_kinds: z.array(z.enum(["bar", "groupedBar", "line", "waterfall", "donut"])),
  }),
  print_stylesheet: BlobRef.nullable(),
  /** AA-verified at LOCK time — the late-axe-failure fix. */
  a11y: z.object({
    approved_text_pairs: z.array(
      z.object({ fg: z.string(), bg: z.string(), ratio: z.number() }),
    ),
  }),
  assets: z.array(
    z.object({ id: z.string(), role: z.string(), blob_path: z.string() }),
  ),
  usage_rules: z.array(z.string()),
});
export type Blueprint = z.infer<typeof Blueprint>;

/** Convenience: the ref pattern a "ref" slot value must satisfy. */
export const REF_SLOT_PATTERN = NumericSlotRef;
