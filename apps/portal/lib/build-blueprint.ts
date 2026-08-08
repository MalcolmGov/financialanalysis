import type { Blueprint, DesignDNA } from "@rs/contracts";
import { buildTokenBlock } from "./studio";

/**
 * Step 6 (v1) — construct a real, lockable Blueprint directly from the
 * approved DesignDNA. This is NOT "parse the AI-generated prototype's HTML
 * into a full component inventory" (extracting an arbitrary component set
 * from generated markup is a separate, larger future feature). It derives
 * tokens, typography and table styling from the SAME DNA the prototype was
 * generated from, using a fixed, minimal component set that @rs/mapper's
 * buildSitePlan already knows how to target (one statement-table component).
 * Every value below is genuinely derived from the DNA, not placeholder data —
 * only the component INVENTORY is fixed rather than extracted from markup.
 */

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
/** WCAG 2.x contrast ratio, 1–21. */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const NEG_STYLE: Record<string, "parens" | "minus"> = { parentheses: "parens", minus: "minus" };
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Baseline layout CSS for the deterministic statements render (uses DNA tokens). */
const STATEMENT_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:0;background:var(--dna-paper,#fff);color:var(--dna-ink,#111);font-family:var(--dna-font-body,system-ui,sans-serif);line-height:1.45}
main[data-dna-component="page-shell"]{max-width:none;width:100%;margin:0;padding:0 0 2rem;display:block}
.statement-table{overflow-x:auto;-webkit-overflow-scrolling:touch}
.fin-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.fin-table th{background:var(--dna-table-header-bg,var(--dna-ink,#111));color:var(--dna-table-header-text,#fff);font-family:var(--dna-font-heading,inherit);font-weight:600;text-align:left;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 18%,transparent);vertical-align:bottom}
.fin-table th:not(:first-child),.fin-table td.cell-num{text-align:right}
.fin-table td{padding:6px 10px;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);vertical-align:top}
.fin-table td.cur,.fin-table th.cur{background:var(--dna-shading,var(--dna-table-shading,#F2F2F2))!important}
.fin-table thead th.cur{filter:brightness(.92)}
.fin-table .num{font-variant-numeric:tabular-nums}
.fin-table .cell-nil{color:color-mix(in srgb,var(--dna-ink,#111) 45%,transparent);text-align:right}
.fin-table .cell-noteRef{text-align:center;width:3.5em}
.fin-table tr.r-section td{font-weight:700;border-bottom:none;padding-top:12px}
.fin-table tr.r-subtotal td{font-weight:700}
.fin-table tr.r-total td{font-weight:700;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 45%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 22%,transparent)}
.fin-table tr.r-line td.cell-num.cur{font-weight:600}
.fin-table .note-ref{color:var(--dna-brand,#243B53);text-decoration:none;font-weight:600;border-bottom:1px dotted color-mix(in srgb,var(--dna-brand,#243B53) 55%,transparent)}
.fin-table .note-ref:hover{border-bottom-style:solid}
@media print{body{padding:0}.statement-table{overflow:visible}}
`.trim();

/**
 * The worker's probe (services/worker/app/probe.py) currently populates
 * table_style.header_bg/header_text with palette ROLE-KEY references (e.g.
 * the literal string "table-header-bg"), not resolved hex values — a
 * placeholder convention, confirmed by running this against real DNA data.
 * Resolve through palette.roles; fall back to treating the value as a literal
 * hex if it already looks like one, so this keeps working if the worker is
 * later changed to emit resolved hexes directly.
 */
function resolveTableColor(
  value: string,
  roles: Record<string, { hex: string }>,
  fallback: string,
): string {
  if (HEX.test(value)) return value;
  return roles[value]?.hex ?? fallback;
}

export function buildBlueprintV1(opts: {
  dna: DesignDNA;
  blueprintVersionId: string;
  projectId: string;
  cycle: number;
  sourcePrototypeVersionId: string;
  sourcePrototypeSha256: string;
}): Omit<Blueprint, "checksum"> {
  const { dna } = opts;
  const roles = dna.palette.roles;
  const paper = roles.paper?.hex ?? "#FFFFFF";
  const ink = roles.ink?.hex ?? "#111111";
  const headerBg = resolveTableColor(
    dna.table_style.header_bg,
    roles,
    roles["table-header-bg"]?.hex ?? roles.brand?.hex ?? ink,
  );
  const headerFg = resolveTableColor(
    dna.table_style.header_text,
    roles,
    roles["table-header-text"]?.hex ?? "#FFFFFF",
  );

  const values: Record<string, string> = {};
  for (const [role, entry] of Object.entries(roles)) values[`--dna-${role}`] = entry.hex;

  // tokens.css must include usable rules — :root alone leaves statement tables
  // as browser-default unstyled markup (broken-looking export).
  const tokensCss = `${buildTokenBlock(dna)}
${STATEMENT_BASE_CSS}`;

  return {
    schema_version: "1.0",
    blueprint_version_id: opts.blueprintVersionId,
    project_id: opts.projectId,
    cycle: opts.cycle,
    source_prototype_version_id: opts.sourcePrototypeVersionId,
    source_prototype_sha256: opts.sourcePrototypeSha256,
    status: "proposed",
    locked_at: null,
    locked_by: null,

    tokens: { css: tokensCss, values },

    typography: {
      font_faces: dna.type.faces.map((f) => ({
        family: f.mapping.web_family,
        src_blob_path: null, // font files aren't embedded yet — a later feature.
        licence: f.mapping.provider === "fontsource-selfhost" ? "embeddable" : "fallback-only",
        fallbacks: f.role === "table" ? ["ui-monospace", "monospace"] : ["ui-sans-serif", "system-ui"],
      })),
      ramp: [
        {
          role: "heading",
          size: `${Math.round(dna.type.scale.web_base_px * dna.type.scale.ratio ** 2)}px`,
          weight: dna.type.heading_treatment.weight,
          token_refs: ["--dna-font-heading"],
        },
        { role: "body", size: `${dna.type.scale.web_base_px}px`, weight: 400, token_refs: ["--dna-font-body"] },
      ],
    },
    // Responsive breakpoint extraction isn't implemented — left empty rather
    // than fabricated; unused by the renderer today regardless.
    breakpoints: [],
    navigation: {
      model: "sticky",
      items: [
        { id: "home", label: "Home", template: "bp:tpl_home" },
        { id: "commentary", label: "Commentary", template: "bp:tpl_prose" },
        { id: "financials", label: "Financials", template: "bp:tpl_statement_page" },
        { id: "administration", label: "Administration", template: "bp:tpl_prose" },
        { id: "downloads", label: "Downloads", template: "bp:tpl_prose" },
      ],
    },
    page_templates: [
      {
        id: "bp:tpl_home",
        name: "Home",
        shell_html: `<main data-dna-component="page-shell" class="page-home"><header class="home-hero"><p class="home-kicker">Interactive results</p><h1>Results centre</h1></header><div class="home-body">{{region:main}}</div></main>`,
        regions: [
          { id: "main", accepts: ["bp:cmp_statement_table", "bp:cmp_prose"], min: 0, max: null },
        ],
      },
      {
        id: "bp:tpl_prose",
        name: "Prose page",
        shell_html: `<main data-dna-component="page-shell" class="page-prose"><div class="prose-body">{{region:main}}</div></main>`,
        regions: [{ id: "main", accepts: ["bp:cmp_prose", "bp:cmp_statement_table"], min: 0, max: null }],
      },
      {
        id: "bp:tpl_statement_page",
        name: "Statement page",
        shell_html: `<main data-dna-component="page-shell" class="page-statement">{{region:main}}</main>`,
        regions: [{ id: "main", accepts: ["bp:cmp_statement_table"], min: 0, max: null }],
      },
      {
        id: "bp:tpl_statement",
        name: "Statement aggregate",
        shell_html: `<main data-dna-component="page-shell">{{region:main}}</main>`,
        regions: [{ id: "main", accepts: ["bp:cmp_statement_table"], min: 0, max: null }],
      },
    ],
    components: [
      {
        id: "bp:cmp_statement_table",
        name: "Statement table",
        html: `<section data-dna-component="statement-table" class="statement-table">{{slot:table}}</section>`,
        css: "",
        slots: { table: { type: "ref", accepts: "table", required: true } },
        variants: [],
      },
      {
        id: "bp:cmp_prose",
        name: "Prose block",
        html: `<section data-dna-component="prose-block" class="prose"><p>{{slot:body}}</p></section>`,
        css: "",
        slots: { body: { type: "text", no_numerals: true, required: false, max_chars: 500 } },
        variants: [],
      },
    ],
    table_styles: {
      header_bg: headerBg,
      header_fg: headerFg,
      current_period_shade: dna.table_style.period_shading?.target ?? null,
      numeric_alignment: dna.table_style.numeric_alignment,
      zebra: dna.table_style.zebra,
      rule_style: Object.keys(dna.table_style.rules).length > 0 ? "hairline" : "none",
      negative_number_style: NEG_STYLE[dna.table_style.negative_format] ?? "parens",
      number_grouping: dna.table_style.thousands_separator,
    },
    chart_theme: {
      palette: ["var(--dna-brand)", "var(--dna-accent)"],
      grid_color: "var(--dna-ink)",
      font_role: "body",
      number_format: {
        locale: "en-ZA",
        thousands: dna.table_style.thousands_separator === "comma" ? "," : " ",
      },
      allowed_chart_kinds: ["bar", "line"],
    },
    print_stylesheet: null,
    // Real WCAG 2.x contrast, computed from the DNA's own ink/paper and
    // table header colors — not asserted, actually calculated.
    a11y: {
      approved_text_pairs: [
        { fg: ink, bg: paper, ratio: Number(contrastRatio(ink, paper).toFixed(2)) },
        { fg: headerFg, bg: headerBg, ratio: Number(contrastRatio(headerFg, headerBg).toFixed(2)) },
      ],
    },
    assets: [],
    usage_rules: [
      "Numeric slots accept only ext:/doc: references — never a literal value.",
      "Colors must be applied via var(--dna-*) tokens; a literal hex outside the token set fails the conformance linter.",
    ],
  };
}
