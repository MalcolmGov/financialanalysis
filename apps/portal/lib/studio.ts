import type { DesignDNA } from "@rs/contracts";
import { MODELS, generateLongText, type Usage } from "./anthropic";

/**
 * Step 4 — the AI design studio. Generates ONE self-contained interactive HTML
 * prototype from the approved DesignDNA + a content sample + the client brief.
 * The no-generic-templates rule is enforced downstream by the shared
 * conformance linter (@rs/render), which every version must pass before it is
 * reviewable; this module also runs it as a post-generation gate.
 *
 * Assets enter as {{ASSET:*}} placeholders and are substituted after
 * generation — keeping megabytes of base64 out of the token budget and letting
 * the placeholder form round-trip through refinement.
 */

export interface ContentSample {
  company: string;
  period: string;
  /** Cover KPI cards: label + verbatim value. */
  kpis: { label: string; value: string }[];
  /** A representative statement table, verbatim. */
  table: { caption: string; headers: string[]; rows: string[][] };
  /** A chart derived from real extracted numbers. */
  chart: { title: string; categories: string[]; series: { label: string; values: string[] }[] };
  /** Opening paragraphs of the shareholder letter + subheads, verbatim. */
  letter: { heading: string; paragraphs: string[] };
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
  push("paper", r.paper?.hex);
  push("ink", r.ink?.hex);
  push("brand", r.brand?.hex);
  push("accent", r.accent?.hex);
  push("masthead", r["masthead-bg"]?.hex);
  push("table-header-bg", r["table-header-bg"]?.hex);
  push("table-header-text", r["table-header-text"]?.hex ?? "#FFFFFF");
  push("shading", r["table-shading"]?.hex);
  push("footer-accent", r["footer-accent"]?.hex ?? r.brand?.hex);
  const heading = dna.type.stack.heading;
  const body = dna.type.stack.body;
  decl.push(`--dna-font-heading:${heading}`);
  decl.push(`--dna-font-body:${body}`);
  return `:root{${decl.join(";")}}`;
}

const SYSTEM = (company: string) => `You are the design engineer for ${company}'s online financial results. You produce ONE self-contained, interactive HTML file that presents audited results as a beautiful, professional microsite — the calibre a specialist investor-relations agency hand-builds.

HARD CONSTRAINTS (a violation makes the file unusable):
- Output ONLY a complete HTML document: <!doctype html> … </html>. No markdown, no code fences, no commentary before or after.
- Copy the provided :root token block into a <style> block VERBATIM, byte-for-byte. Use ONLY var(--dna-*) tokens for color; any other color must be a neutral derived from --dna-ink and --dna-paper. NEVER introduce a color outside the tokens.
- Use ONLY the fonts named in the tokens (with a generic fallback). Do NOT use Inter, Roboto, Arial, or system-ui as a primary face.
- Zero external requests: no CDN scripts, no external stylesheets, no remote fonts or images. Reference brand imagery ONLY via the placeholders {{ASSET:banner}} and {{ASSET:logo}} exactly as written — do not invent asset URLs.
- Real content ONLY, exactly as supplied. NEVER use lorem ipsum. NEVER invent, round, or alter a number — reproduce every figure character-for-character as given (including thin-space thousands like "5 053.2" and parenthesised negatives like "(490.5)").
- Annotate each major block with data-dna-component="<kebab-name>" (e.g. kpi-card, statement-table, chart-block, hero-banner, footer-strip) and each content section with data-dna-source-page.

NEVER use generic AI aesthetics: purple-on-white gradients, Bootstrap/shadcn defaults, cookie-cutter card grids, emoji bullets. Every visual decision must be traceable to the source document's design DNA described below — its palette, its table treatment, its masthead and motifs.

REQUIRED INTERACTIVITY & STRUCTURE:
- Sticky masthead nav with scrollspy across the sections.
- A hero band using {{ASSET:banner}} and the KPI highlight cards.
- At least one real financial table with the DNA's dark header + current-period shading, right-aligned tabular-nums, sticky first column, and an overflow-x wrapper.
- One inline-SVG chart built from the supplied chart numbers, with visible value labels (each label the verbatim figure).
- The shareholder-letter prose in a comfortable reading column.
- A footer strip in the DNA's style.
- A print stylesheet; responsive to 390px with no horizontal body scroll; WCAG AA text contrast; semantic landmarks + a skip link.`;

function userPrompt(dna: DesignDNA, content: ContentSample, brief: string, tokenBlock: string): string {
  return `DESIGN DNA (the source document's measured visual identity):
${JSON.stringify(dna, null, 2)}

TOKEN BLOCK — copy this into your <style> VERBATIM:
${tokenBlock}

CLIENT BRIEF:
${brief}

CONTENT (reproduce every value verbatim):
${JSON.stringify(content, null, 2)}

Produce the complete single-file HTML now.`;
}

const ASSET_PLACEHOLDERS: Record<string, string> = {
  // 1x1 transparent PNG stand-ins; the real assembler substitutes extracted
  // brand assets. Kept tiny so the assembled form stays well under budget here.
  "{{ASSET:banner}}":
    "data:image/svg+xml;base64," +
    Buffer.from(
      `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='240'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#0E0B08'/><stop offset='0.55' stop-color='#6B4A1E'/><stop offset='1' stop-color='#C9972F'/></linearGradient></defs><rect width='1200' height='240' fill='url(%23g)'/></svg>`,
    ).toString("base64"),
  "{{ASSET:logo}}":
    "data:image/svg+xml;base64," +
    Buffer.from(
      `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='48'><text x='0' y='34' font-family='sans-serif' font-weight='700' font-size='28' fill='%23B8912A'>LOGO</text></svg>`,
    ).toString("base64"),
};

/** Substitute {{ASSET:*}} placeholders with data URIs → the browser-facing form. */
export function assembleAssets(placeholderHtml: string): string {
  let out = placeholderHtml;
  for (const [ph, uri] of Object.entries(ASSET_PLACEHOLDERS)) {
    out = out.split(ph).join(uri);
  }
  return out;
}

export async function runStudio(opts: {
  dna: DesignDNA;
  content: ContentSample;
  brief: string;
  onDelta?: (t: string) => void;
}): Promise<StudioResult> {
  const tokenBlock = buildTokenBlock(opts.dna);
  const gen = await generateLongText({
    model: MODELS.generate,
    system: SYSTEM(opts.content.company),
    messages: [{ role: "user", content: userPrompt(opts.dna, opts.content, opts.brief, tokenBlock) }],
    maxTokens: 64000,
    effort: "high",
    onDelta: opts.onDelta,
  });
  // The model must return just the HTML; strip any stray fencing defensively.
  let html = gen.text.trim();
  const fence = html.match(/```html\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();
  const docStart = html.indexOf("<!doctype");
  if (docStart > 0) html = html.slice(docStart);

  return {
    placeholderHtml: html,
    assembledHtml: assembleAssets(html),
    tokenBlock,
    usage: gen.usage,
    stopReason: gen.stopReason,
  };
}
