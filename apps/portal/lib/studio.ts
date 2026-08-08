import type { DesignDNA } from "@rs/contracts";
import { IR_NEUTRAL_FALLBACKS } from "@rs/render";
import { MODELS, generateLongText, type Usage } from "./anthropic";
import { buildStudioBrief } from "./build-content";
import { ensureContentCoverage } from "./content-coverage";
import { polishPrototypeHtml } from "./polish-prototype";

/**
 * Step 4 — the AI design studio. Generates ONE self-contained interactive HTML
 * prototype from the approved DesignDNA + document content + the client brief.
 *
 * Speed path: Opus designs a DNA-faithful layout *shell* (nav, hero, KPIs, chart,
 * letter structure, section anchors). Full statement tables and any omitted
 * letter/notes are injected deterministically via ensureContentCoverage.
 * Assets enter as {{ASSET:*}} placeholders and are substituted after generation.
 */

export interface ContentTable {
  id: string;
  caption: string;
  headers: string[];
  rows: string[][];
  table_type?: string;
  must_appear?: boolean;
  page?: number;
}

export interface ContentSection {
  id: string;
  kind: string;
  heading: string;
  paragraphs: string[];
}

export interface ContentSample {
  company: string;
  period: string;
  /** Cover KPI cards: label + verbatim value. */
  kpis: { label: string; value: string }[];
  /** Primary statement (backward compat / chart source). */
  table: { caption: string; headers: string[]; rows: string[][] };
  /** Every mapped financial/ops table, full rows, verbatim. */
  tables?: ContentTable[];
  /** A chart derived from real extracted numbers. */
  chart: { title: string; categories: string[]; series: { label: string; values: string[] }[] };
  /** Full shareholder letter prose, verbatim. */
  letter: { heading: string; paragraphs: string[] };
  /** Additional prose sections (highlights, notes, directors, …). */
  sections?: ContentSection[];
  /** Dividend / salient-dates list, verbatim. */
  dividend?: string[];
}

export interface StudioResult {
  placeholderHtml: string;
  assembledHtml: string;
  tokenBlock: string;
  usage: Usage;
  stopReason: string | null;
}

/** Build the verbatim :root token block from the approved DNA. */
export function buildTokenBlock(dna: DesignDNA): string {
  const r = dna.palette.roles;
  const decl: string[] = [];
  const push = (name: string, hex?: string) => {
    if (hex) decl.push(`--dna-${name}:${hex}`);
  };
  // Always emit load-bearing roles. Missing DNA → neutral IR (not DRDGOLD).
  push("paper", r.paper?.hex ?? IR_NEUTRAL_FALLBACKS.paper);
  push("ink", r.ink?.hex ?? IR_NEUTRAL_FALLBACKS.ink);
  push("brand", r.brand?.hex ?? IR_NEUTRAL_FALLBACKS.brand);
  push("accent", r.accent?.hex ?? r.brand?.hex ?? IR_NEUTRAL_FALLBACKS.accent);
  push("masthead", r["masthead-bg"]?.hex ?? IR_NEUTRAL_FALLBACKS.masthead);
  push("table-header-bg", r["table-header-bg"]?.hex ?? IR_NEUTRAL_FALLBACKS.tableHeaderBg);
  push("table-header-text", r["table-header-text"]?.hex ?? IR_NEUTRAL_FALLBACKS.tableHeaderText);
  push("shading", r["table-shading"]?.hex ?? IR_NEUTRAL_FALLBACKS.shading);
  push(
    "footer-accent",
    r["footer-accent"]?.hex ?? r.brand?.hex ?? IR_NEUTRAL_FALLBACKS.footerAccent,
  );
  const heading = dna.type.stack.heading;
  const body = dna.type.stack.body;
  decl.push(`--dna-font-heading:${heading}`);
  decl.push(`--dna-font-body:${body}`);
  return `:root{${decl.join(";")}}`;
}

/** Output budget for shell generation (tables are injected post-model). */
export const STUDIO_SHELL_MAX_TOKENS = 24_000;

const SYSTEM = (company: string) => `You are the design engineer for ${company}'s online financial results. You produce ONE self-contained, interactive HTML *layout shell* — the calibre a specialist investor-relations agency hand-builds. A deterministic post-processor will inject every full financial table and any omitted letter/notes into your anchors; your job is DNA-faithful structure, styling, and navigation — not row-by-row statement markup.

HARD CONSTRAINTS (a violation makes the file unusable):
- Output ONLY a complete HTML document: <!doctype html> … </html>. No markdown, no code fences, no commentary before or after.
- Copy the provided :root token block into a <style> block VERBATIM, byte-for-byte. Use ONLY var(--dna-*) tokens for color; any other color must be a neutral derived from --dna-ink and --dna-paper. NEVER introduce a color outside the tokens.
- Use ONLY the fonts named in the tokens (with a generic fallback). Do NOT use Inter, Roboto, Arial, or system-ui as a primary face.
- Zero external requests: no CDN scripts, no external stylesheets, no remote fonts or images. Reference brand imagery ONLY via the placeholders {{ASSET:banner}} and {{ASSET:logo}} exactly as written — do not invent asset URLs.
- Real content ONLY for KPIs, chart figures, and any letter/section prose you choose to render. NEVER use lorem ipsum. NEVER invent, round, or alter a number — reproduce every figure character-for-character as given (including thin-space thousands like "5 053.2" and parenthesised negatives like "(490.5)").
- DO NOT render full statement tables row-by-row. content.tables entries list ids/captions/headers only (rows are empty on purpose). Put empty section anchors the injector will fill:
  - id="financial-statements" (primary statements region)
  - id="notes" (note tables / note prose)
  Optionally leave a short caption list or one empty <div data-dna-component="statement-table"> placeholder per table id — but NO <table> bodies with invented or partial rows.
- You MAY include the shareholder letter as full paragraphs if the brief supplies them, OR leave id="shareholder-letter" (or id="letter") as a styled empty reading column — omitted letter paragraphs are injected later. Prefer a beautiful letter column structure either way.
- Annotate each major block with data-dna-component="<kebab-name>" (e.g. kpi-card, statement-table, chart-block, hero-banner, footer-strip, note-block) and each content section with data-dna-source-page when known.

NEVER use generic AI aesthetics: purple-on-white gradients, Bootstrap/shadcn defaults, cookie-cutter card grids, emoji bullets. Every visual decision must be traceable to the source document's design DNA — its palette, table treatment, masthead and motifs.

REQUIRED INTERACTIVITY & STRUCTURE:
- Sticky masthead nav with scrollspy. Nav MUST include at least: Highlights, Review of operations (if present), Shareholder letter, Financial statements, Notes, Dividend (if present), plus any other major sections you render. Link to #financial-statements and #notes.
- Nav layout: flex-wrap (or multi-row) so EVERY label is fully visible in the viewport — NEVER overflow-x scroll on nav or body. Prefer slightly compact labels / wrapping over a horizontal scrollbar that cuts items off.
- A hero band using {{ASSET:banner}} and the KPI highlight cards (verbatim labels/values from content.kpis).
- A Financial statements region (id="financial-statements") styled for DNA dark header + current-period shading, right-aligned tabular-nums, sticky first column, overflow-x wrappers — leave the interior ready for injected tables (empty or caption stubs only).
- A Notes region (id="notes") for note tables and note prose (empty or heading stubs OK).
- One inline-SVG chart built from the supplied chart numbers, with visible value labels (each label the verbatim figure). Do not invent series beyond content.chart.
- Shareholder-letter structure in a comfortable reading column (id="shareholder-letter" or similar).
- A footer strip in the DNA's style.
- A print stylesheet; responsive to 390px with no horizontal body scroll; WCAG AA text contrast; semantic landmarks + a skip link.
- Prefer editorial, premium IR layout: clear hierarchy, generous measure for prose, disciplined table typography — not a sparse marketing landing page.
- Center the main content column in the viewport: use a sensible max-width (~1040–1200px for statements/KPIs; ~68ch for letter/prose) with margin-inline:auto and responsive horizontal padding. Do not leave letter/pages stuck to the left with empty right space. Overflow-x belongs only on table wrappers, never on html/body/nav.

READABILITY & CONTRAST (web, not print-cramped):
- Prose / letter / note body copy: comfortable measure ~60–75ch (prefer ~68ch), line-height 1.55–1.7 (prefer ~1.65), paragraph margin-bottom ~1.1–1.35em. Center that column (margin-inline:auto). Do not pack dense paragraphs edge-to-edge across a wide wrap.
- Section title rows and page meta labels (e.g. "PAGES 2 – 4", section numbers, continuation marks, footnotes): use --dna-ink or a dark ink-derived neutral (≥ ~88% --dna-ink mixed into --dna-paper). NEVER pale grey, washed #999, or low-opacity ink for meta labels or rules that frame headings.
- Horizontal rules under section heads / kickers: at least ~28–35% --dna-ink mixed into paper so they remain visible.
- Statement tables: thead/th text MUST meet WCAG AA against the header background. If --dna-table-header-bg is mid-grey, darken it toward --dna-ink for the header fill (keep --dna-table-header-text). First-column labels (th[scope=row] / td:first-child) must stay readable in --dna-ink. Never paint light --dna-shading onto thead cells in a way that leaves light-on-light or white-on-pale text.
- Include CSS rules for .rs-injected-table / .rs-table-wrap / .rs-coverage-appendix so injected tables inherit the DNA table treatment (dark header, tabular-nums, overflow-x).`

function userPrompt(dna: DesignDNA, briefContent: ContentSample, brief: string, tokenBlock: string): string {
  const tableCount = briefContent.tables?.length ?? 1;
  const letterParas = briefContent.letter.paragraphs.length;
  return `DESIGN DNA (the source document's measured visual identity):
${JSON.stringify(dna, null, 2)}

TOKEN BLOCK — copy this into your <style> VERBATIM:
${tokenBlock}

CLIENT BRIEF:
${brief}

SHELL CONTRACT — you design structure + DNA styling; a post-processor injects full tables:
- tables that WILL be injected (ids/captions only below; row data omitted on purpose): ${tableCount}
- shareholder letter sample paragraphs in brief: ${letterParas} (full letter may be injected if you leave the anchor empty)
- additional prose section stubs: ${briefContent.sections?.length ?? 0}
- MUST include empty (or caption-only) anchors: #financial-statements and #notes
- MUST NOT emit full <table> bodies for statement/note tables
- DO include KPIs verbatim and ONE chart from content.chart

STUDIO BRIEF (layout context — not the full document dump):
${JSON.stringify(briefContent, null, 2)}

Produce the complete single-file HTML shell now.`;
}

const ASSET_STUBS: Record<"logo" | "banner", string> = {
  banner:
    "data:image/svg+xml;base64," +
    Buffer.from(
      `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='240'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#0E0B08'/><stop offset='0.55' stop-color='#6B4A1E'/><stop offset='1' stop-color='#C9972F'/></linearGradient></defs><rect width='1200' height='240' fill='url(%23g)'/></svg>`,
    ).toString("base64"),
  logo:
    "data:image/svg+xml;base64," +
    Buffer.from(
      `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='48'><text x='0' y='34' font-family='sans-serif' font-weight='700' font-size='28' fill='%23B8912A'>LOGO</text></svg>`,
    ).toString("base64"),
};

export type AssembleAssetUris = {
  logo?: string;
  banner?: string;
};

/** Substitute {{ASSET:*}} placeholders with data URIs → the browser-facing form. */
export function assembleAssets(
  placeholderHtml: string,
  uris?: AssembleAssetUris,
): string {
  let out = placeholderHtml;
  const logo = uris?.logo || ASSET_STUBS.logo;
  const banner = uris?.banner || ASSET_STUBS.banner;
  out = out.split("{{ASSET:logo}}").join(logo);
  out = out.split("{{ASSET:banner}}").join(banner);
  return out;
}

export async function runStudio(opts: {
  dna: DesignDNA;
  /** Full document content — used for post-generation coverage injection. */
  content: ContentSample;
  brief: string;
  onDelta?: (t: string) => void;
}): Promise<StudioResult> {
  const tokenBlock = buildTokenBlock(opts.dna);
  const llmContent = buildStudioBrief(opts.content);
  const gen = await generateLongText({
    model: MODELS.generate,
    system: SYSTEM(opts.content.company),
    messages: [{ role: "user", content: userPrompt(opts.dna, llmContent, opts.brief, tokenBlock) }],
    maxTokens: STUDIO_SHELL_MAX_TOKENS,
    effort: "high",
    onDelta: opts.onDelta,
  });
  // The model must return just the HTML; strip any stray fencing defensively.
  let html = gen.text.trim();
  const fence = html.match(/```html\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();
  const docStart = html.indexOf("<!doctype");
  if (docStart > 0) html = html.slice(docStart);

  // Inject full tables + omitted letter from FULL content (not the slim brief).
  html = ensureContentCoverage(html, opts.content);
  // Deterministic readability / AA contrast overrides (measure, leading, headers).
  html = polishPrototypeHtml(html);

  return {
    placeholderHtml: html,
    assembledHtml: assembleAssets(html),
    tokenBlock,
    usage: gen.usage,
    stopReason: gen.stopReason,
  };
}
