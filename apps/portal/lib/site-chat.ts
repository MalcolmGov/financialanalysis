/**
 * Multipage site-draft chat: Claude proposes search/replace patches against
 * a selected page (or shared chrome file). Reuses refine patch apply +
 * numeral guard so Gate A/B figures stay intact unless the operator opts in.
 */

import type { RefinePatch } from "./refine";

export const SITE_CHAT_MODEL = "claude-sonnet-5" as const;

export interface SiteChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SiteChatModelReply {
  message: string;
  patches: RefinePatch[];
  target_path: string;
  number_change_requested: boolean;
  number_change_summary: string;
}

export const SITE_CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "message",
    "patches",
    "target_path",
    "number_change_requested",
    "number_change_summary",
  ],
  properties: {
    message: {
      type: "string",
      description:
        "Short operator-facing reply: what you changed, or clarifying questions. Plain text, no markdown fences.",
    },
    patches: {
      type: "array",
      description:
        "Anchored search/replace patches. Empty when answering without editing HTML.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["search", "replace"],
        properties: {
          search: {
            type: "string",
            description:
              "Exact substring copied from the current file. Prefer unique anchors (≥40 chars of surrounding markup).",
          },
          replace: {
            type: "string",
            description: "Replacement text. Surgical HTML/CSS/JS only.",
          },
          occurrence: {
            type: "integer",
            description: "1-based match index when search is ambiguous.",
          },
        },
      },
    },
    target_path: {
      type: "string",
      description:
        "Which draft file to patch. Usually the selected page path. May be a shared asset (e.g. assets/site.css) when editing site-wide chrome.",
    },
    number_change_requested: {
      type: "boolean",
      description:
        "True only when the operator explicitly asked to change a financial figure, date numeral, or percentage.",
    },
    number_change_summary: {
      type: "string",
      description:
        "If number_change_requested, briefly name the figures involved; otherwise empty string.",
    },
  },
} as const;

export const SITE_CHAT_SYSTEM = `You are Results Studio's multipage site editor for investor-results HTML microsites.

You help the operator surgically tweak and fix the current site draft AFTER the multipage HTML has been generated. You receive:
1) SOURCE EXTRACTION CONTEXT — verbatim PDF extraction / DocModel slices (tables, prose, notes, KPIs, page text) relevant to the selected page and request
2) Brand / DNA summary and site structure
3) The current target HTML (and optional shared chrome CSS)

HARD RULES:
- Return ONLY JSON matching the schema. No markdown fences.
- Prefer the smallest patch set that satisfies the request (typically 0–8 patches).
- search must be copied EXACTLY from the provided file (including whitespace) and be unique, or set occurrence. If the HTML was truncated, copy only from the visible slices — never invent omitted markup. Prefer unique landmarks of ≥40 characters. If apply fails because the search matches more than once, lengthen the anchor or set occurrence; if it was not found, copy a shorter unique substring from CURRENT FILE — do not paraphrase.
- Apply surgical HTML/CSS/JS fixes only. Preserve structure, navigation, and accessibility unless asked otherwise.
- NEVER invent financial numbers, KPIs, percentages, or dates. Ground wording and figures in SOURCE EXTRACTION CONTEXT and/or the current HTML only. Do not invent external CDNs, fonts, or asset URLs.
- When fixing labels, note titles, commentary, or table presentation, prefer strings from the extraction evidence over guessing.
- Preserve Gate A/B number integrity: do not alter digit-bearing figures unless the operator EXPLICITLY asked to change that figure. If they did, set number_change_requested=true and summarize which figures.
- If the request is ambiguous or unsafe, return patches=[] and ask a short clarifying question in message.
- target_path must be one of the allowed paths provided by the user message (selected page or listed chrome files).
- Keep relative links and asset paths working.
- Speak briefly and concretely about what changed.
- Always refer to the issuer by the ISSUER / legal company name from the PROJECT line (e.g. DRDGOLD). Never use portal project slugs or internal titles like "DRD Gold 1".`;

/** Cap page HTML sent to the model (chars). Prefer head+tail if over. */
export const SITE_CHAT_HTML_CHAR_BUDGET = 140_000;

export function truncateForModel(html: string, budget = SITE_CHAT_HTML_CHAR_BUDGET): {
  text: string;
  truncated: boolean;
} {
  if (html.length <= budget) return { text: html, truncated: false };
  const head = Math.floor(budget * 0.7);
  const tail = budget - head - 80;
  return {
    text: `${html.slice(0, head)}\n\n<!-- … truncated for model context … -->\n\n${html.slice(-tail)}`,
    truncated: true,
  };
}

export function summarizeDnaForChat(dna: Record<string, unknown> | null): string {
  if (!dna) return "(no design DNA on this run)";
  const palette = (dna.palette ?? {}) as {
    roles?: Record<string, { hex?: string; name?: string }>;
  };
  const type = (dna.type ?? {}) as {
    stack?: { heading?: string; body?: string };
    heading_treatment?: { color?: string; case?: string; weight?: number };
    scale?: { web_base_px?: number; ratio?: number };
  };
  const theme = (dna.theme ?? {}) as { mode?: string; rationale?: string };
  const table = (dna.table_style ?? {}) as {
    header_bg?: string;
    header_text?: string;
    zebra?: boolean;
  };
  const toneWords = Array.isArray(dna.tone_words) ? (dna.tone_words as string[]) : [];
  const roles = Object.entries(palette.roles ?? {}).map(
    ([role, entry]) => `${role}: ${entry?.hex ?? "?"}${entry?.name ? ` (${entry.name})` : ""}`,
  );
  return [
    `theme: ${theme.mode ?? "—"} — ${theme.rationale ?? ""}`,
    `tone: ${toneWords.slice(0, 8).join(", ") || "—"}`,
    `type: heading=${type.stack?.heading ?? "—"} body=${type.stack?.body ?? "—"} base=${type.scale?.web_base_px ?? "—"}px ratio=${type.scale?.ratio ?? "—"}`,
    `heading treatment: ${JSON.stringify(type.heading_treatment ?? {})}`,
    `palette: ${roles.join("; ") || "—"}`,
    `table: header_bg=${table.header_bg ?? "—"} header_text=${table.header_text ?? "—"} zebra=${table.zebra ?? "—"}`,
  ].join("\n");
}

export function buildSiteChatUserPayload(opts: {
  company: string;
  periodLabel: string;
  selectedPagePath: string;
  allowedPaths: string[];
  dnaSummary: string;
  gateA: string | null;
  gateB: string | null;
  fileHtml: string;
  htmlTruncated: boolean;
  history: SiteChatTurn[];
  message: string;
  allowNumberOverride: boolean;
  /** Verbatim PDF extraction / DocModel evidence for grounded edits. */
  extractionContext?: string;
  extractionTruncated?: boolean;
  siteStructure?: string;
}): string {
  const historyBlock =
    opts.history.length === 0
      ? "(none)"
      : opts.history
          .slice(-8)
          .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
          .join("\n\n");

  return [
    `ISSUER (legal / trading name — use this in replies; never portal project slugs): ${opts.company}`,
    `PROJECT: ${opts.company}${opts.periodLabel ? ` · ${opts.periodLabel}` : ""}`,
    `GATES: A=${opts.gateA ?? "unknown"} B=${opts.gateB ?? "unknown"}`,
    `SELECTED PAGE: ${opts.selectedPagePath}`,
    `ALLOWED TARGET PATHS:\n${opts.allowedPaths.map((p) => `- ${p}`).join("\n")}`,
    `NUMBER OVERRIDE AUTHORIZED: ${opts.allowNumberOverride ? "yes — operator confirmed" : "no — refuse numeral edits"}`,
    opts.siteStructure
      ? `\nSITE STRUCTURE:\n${opts.siteStructure}`
      : "",
    `\nBRAND / DNA SUMMARY:\n${opts.dnaSummary}`,
    opts.extractionContext
      ? `\n${opts.extractionContext}`
      : "\nSOURCE EXTRACTION CONTEXT: (unavailable — edit HTML carefully; do not invent figures)",
    opts.extractionTruncated
      ? "\nNOTE: Extraction evidence was truncated to fit context; switch page or narrow the request if you need another section."
      : "",
    `\nRECENT CHAT:\n${historyBlock}`,
    `\nOPERATOR REQUEST:\n${opts.message}`,
    opts.htmlTruncated
      ? "\nNOTE: Target file was truncated for context; prefer patches in the visible regions or ask to narrow scope."
      : "",
    `\nCURRENT FILE (${opts.selectedPagePath} — patch target_path may differ if editing listed chrome):\n${opts.fileHtml}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** First attempt + two retries with a tighter unique-search echo. */
export const SITE_CHAT_APPLY_ATTEMPTS = 3;

/** Operator-retry hint when search/replace failed — unique-search coaching, not more HTML. */
export function patchApplyRetryHint(error: string, patches: RefinePatch[]): string {
  const sample = patches
    .slice(0, 3)
    .map((p, i) => {
      const snip = (p.search ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      return `patch[${i}] search: ${snip || "(empty)"}`;
    })
    .join("\n");
  const ambiguous = /matched \d+ times/i.test(error);
  const missing = /not found/i.test(error);
  const lines = [
    `PREVIOUS APPLY FAILURE (fix and retry): ${error}`,
    sample ? `Failing anchors:\n${sample}` : "",
    ambiguous
      ? "That search matched more than once. Lengthen the copy-pasted HTML so it is unique, or set occurrence (1-based). Do not paraphrase."
      : missing
        ? "That search was not in CURRENT FILE. Copy a unique substring EXACTLY from CURRENT FILE (quotes and whitespace included). Do not invent truncated markup."
        : "Copy search EXACTLY from CURRENT FILE. Prefer a unique ≥40 character landmark.",
    "Return a new patches array that will apply. Keep replace surgical. Empty patches means you cannot edit.",
  ];
  return lines.filter(Boolean).join("\n");
}
