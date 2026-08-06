/**
 * Step-5 refinement helpers: deterministic search/replace patch apply +
 * numeral-invariant guard. The model proposes patches; this module is the
 * only thing that mutates HTML.
 */

export interface RefinePatch {
  search: string;
  replace: string;
  occurrence?: number;
}

export class PatchApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchApplyError";
  }
}

export class NumeralGuardError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
    public readonly added: string[],
  ) {
    super(message);
    this.name = "NumeralGuardError";
  }
}

/** Collapse runs of whitespace (incl. NBSP/thin space) for fuzzy matching. */
export function normalizeWs(s: string): string {
  return s.replace(/[\s\u00a0\u202f\u2009]+/g, " ").trim();
}

/**
 * Apply anchored search/replace patches. Exact match first, then
 * whitespace-normalized. Fails if any block matches 0 or >1 times (unless
 * occurrence is set). All-or-nothing.
 */
export function applyPatches(html: string, patches: RefinePatch[]): string {
  if (!patches.length) throw new PatchApplyError("empty patch list");
  let out = html;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    if (!p.search) throw new PatchApplyError(`patch[${i}]: empty search`);
    const applied = applyOne(out, p, i);
    out = applied;
  }
  return out;
}

function applyOne(html: string, p: RefinePatch, index: number): string {
  const exactIdxs = allIndexes(html, p.search);
  if (exactIdxs.length === 1 || (p.occurrence != null && exactIdxs.length > 0)) {
    const which = p.occurrence ?? 1;
    if (which < 1 || which > exactIdxs.length) {
      throw new PatchApplyError(
        `patch[${index}]: occurrence ${which} out of range (${exactIdxs.length} exact matches)`,
      );
    }
    const at = exactIdxs[which - 1]!;
    return html.slice(0, at) + p.replace + html.slice(at + p.search.length);
  }
  if (exactIdxs.length > 1) {
    throw new PatchApplyError(
      `patch[${index}]: search matched ${exactIdxs.length} times exactly — set occurrence or tighten the anchor`,
    );
  }

  // Fuzzy: whitespace-normalized unique match.
  const needle = normalizeWs(p.search);
  if (!needle) throw new PatchApplyError(`patch[${index}]: empty search after normalize`);
  const matches = fuzzyMatches(html, needle);
  if (matches.length === 0) {
    throw new PatchApplyError(`patch[${index}]: search not found (exact or whitespace-fuzzy)`);
  }
  if (matches.length > 1 && p.occurrence == null) {
    throw new PatchApplyError(
      `patch[${index}]: search matched ${matches.length} times (fuzzy) — set occurrence or tighten the anchor`,
    );
  }
  const which = p.occurrence ?? 1;
  if (which < 1 || which > matches.length) {
    throw new PatchApplyError(
      `patch[${index}]: occurrence ${which} out of range (${matches.length} fuzzy matches)`,
    );
  }
  const m = matches[which - 1]!;
  return html.slice(0, m.start) + p.replace + html.slice(m.end);
}

function allIndexes(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  while (from <= haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + Math.max(needle.length, 1);
  }
  return out;
}

function fuzzyMatches(html: string, normalizedNeedle: string): { start: number; end: number }[] {
  const matches: { start: number; end: number }[] = [];
  // Walk the HTML, building a normalized view with index map back to original.
  const map: number[] = [];
  let norm = "";
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (/[\s\u00a0\u202f\u2009]/.test(ch)) {
      // Collapse whitespace run to a single space in normalized form.
      if (norm.length === 0 || norm[norm.length - 1] !== " ") {
        map.push(i);
        norm += " ";
      }
      while (i < html.length && /[\s\u00a0\u202f\u2009]/.test(html[i]!)) i++;
      continue;
    }
    map.push(i);
    norm += ch;
    i++;
  }
  const trimmed = norm.trim();
  const trimOffset = norm.length - norm.trimStart().length;
  let from = 0;
  while (from <= trimmed.length) {
    const at = trimmed.indexOf(normalizedNeedle, from);
    if (at < 0) break;
    const absStart = at + trimOffset;
    const absEnd = absStart + normalizedNeedle.length - 1;
    const start = map[absStart] ?? 0;
    const endIdx = map[absEnd];
    const end = endIdx != null ? endIdx + 1 : html.length;
    matches.push({ start, end });
    from = at + Math.max(normalizedNeedle.length, 1);
  }
  return matches;
}

/** Digit-bearing tokens used for the refinement numeral invariant. */
const NUM_TOKEN_RE = /\d[\d\s\u00a0\u202f\u2009.,]*/g;

function stripNoise(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function numeralMultiset(html: string): Map<string, number> {
  const text = stripNoise(html);
  const counts = new Map<string, number>();
  for (const raw of text.match(NUM_TOKEN_RE) ?? []) {
    const key = normalizeWs(raw).replace(/\s/g, "");
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Refinement must never alter a number. Compares digit-bearing token multisets
 * (whitespace-insensitive) between parent and child HTML.
 */
export function assertNumeralsUnchanged(parentHtml: string, childHtml: string): void {
  const a = numeralMultiset(parentHtml);
  const b = numeralMultiset(childHtml);
  const missing: string[] = [];
  const added: string[] = [];
  for (const [k, n] of a) {
    const m = b.get(k) ?? 0;
    if (m < n) for (let i = 0; i < n - m; i++) missing.push(k);
  }
  for (const [k, n] of b) {
    const m = a.get(k) ?? 0;
    if (n > m) for (let i = 0; i < n - m; i++) added.push(k);
  }
  if (missing.length || added.length) {
    throw new NumeralGuardError(
      `refinement altered numerals (missing=${missing.slice(0, 5).join(",")}; added=${added.slice(0, 5).join(",")})`,
      missing,
      added,
    );
  }
}

export const PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["patches"],
  properties: {
    patches: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["search", "replace"],
        properties: {
          search: {
            type: "string",
            description:
              "Exact substring of the current placeholder HTML to find. Prefer unique anchors (≥40 chars of surrounding markup).",
          },
          replace: {
            type: "string",
            description:
              "Replacement text. Must not change any digit-bearing figure. May restyle layout/CSS/copy only.",
          },
          occurrence: {
            type: "integer",
            description: "1-based match index when search is ambiguous.",
          },
        },
      },
    },
  },
} as const;

export const REFINE_SYSTEM = `You refine a single-file financial-results HTML prototype via anchored search/replace patches.

HARD RULES:
- Return ONLY a JSON object with a "patches" array. Each patch is {search, replace, occurrence?}.
- search must be copied EXACTLY from the provided HTML (including whitespace) and be unique, or set occurrence.
- NEVER alter any digit, number, currency figure, percentage, or date numeral. Layout, CSS tokens, copy without numerals, and structure are fair game.
- Do not invent external URLs, CDN scripts, or fonts. Keep {{ASSET:banner}} / {{ASSET:logo}} placeholders intact.
- Prefer the smallest patch set that satisfies the operator prompt (typically 1–8 patches).
- Do not wrap the JSON in markdown.`;
