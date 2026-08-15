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
 * Decode the handful of HTML entities models mix into copy-paste anchors.
 * Named entities last so `&amp;nbsp;` still resolves.
 */
export function decodeHtmlFlex(s: string): string {
  return s
    .replace(/&nbsp;|&#160;|&#x0*A0;/gi, " ")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/&amp;/gi, "&");
}

function searchVariants(search: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  add(search);
  add(decodeHtmlFlex(search));
  if (search.includes("\\n") || search.includes("\\t")) {
    add(search.replace(/\\n/g, "\n").replace(/\\t/g, "\t"));
  }
  const decoded = decodeHtmlFlex(search);
  if (/"/.test(decoded) && !/'/.test(decoded)) add(decoded.replace(/"/g, "'"));
  if (/'/.test(decoded) && !/"/.test(decoded)) add(decoded.replace(/'/g, '"'));
  return out;
}

/**
 * Apply anchored search/replace patches. Exact match first, then
 * whitespace-normalized (entity/quote flex). Fails if any block matches 0
 * or >1 times (unless occurrence is set). All-or-nothing.
 */
export function applyPatches(html: string, patches: RefinePatch[]): string {
  if (!patches.length) throw new PatchApplyError("empty patch list");
  let out = html;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    if (!p.search) throw new PatchApplyError(`patch[${i}]: empty search`);
    const applied = applyOne(out, p, i);
    if (applied === out) {
      throw new PatchApplyError(`patch[${i}]: search/replace produced no change`);
    }
    out = applied;
  }
  return out;
}

function applyOne(html: string, p: RefinePatch, index: number): string {
  let lastAmbiguous: string | null = null;
  for (const search of searchVariants(p.search)) {
    const exactIdxs = allIndexes(html, search);
    if (exactIdxs.length === 1 || (p.occurrence != null && exactIdxs.length > 0)) {
      const which = p.occurrence ?? 1;
      if (which < 1 || which > exactIdxs.length) {
        lastAmbiguous = `patch[${index}]: occurrence ${which} out of range (${exactIdxs.length} exact matches)`;
        continue;
      }
      const at = exactIdxs[which - 1]!;
      return html.slice(0, at) + p.replace + html.slice(at + search.length);
    }
    if (exactIdxs.length > 1) {
      lastAmbiguous = `patch[${index}]: search matched ${exactIdxs.length} times exactly — set occurrence or tighten the anchor`;
      continue;
    }

    const needle = normalizeWs(decodeHtmlFlex(search));
    if (!needle) continue;
    const matches = fuzzyMatches(html, needle);
    if (matches.length === 0) continue;
    if (matches.length > 1 && p.occurrence == null) {
      lastAmbiguous = `patch[${index}]: search matched ${matches.length} times (fuzzy) — set occurrence or tighten the anchor`;
      continue;
    }
    const which = p.occurrence ?? 1;
    if (which < 1 || which > matches.length) {
      lastAmbiguous = `patch[${index}]: occurrence ${which} out of range (${matches.length} fuzzy matches)`;
      continue;
    }
    const m = matches[which - 1]!;
    return html.slice(0, m.start) + p.replace + html.slice(m.end);
  }
  throw new PatchApplyError(
    lastAmbiguous ?? `patch[${index}]: search not found (exact, entity, or whitespace-fuzzy)`,
  );
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

const FLEX_NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

function readHtmlEntity(html: string, i: number): { value: string; end: number } | null {
  if (html[i] !== "&") return null;
  const semi = html.indexOf(";", i + 1);
  if (semi < 0 || semi - i > 12) return null;
  const body = html.slice(i + 1, semi);
  if (/^#x[0-9a-f]+$/i.test(body)) {
    const n = parseInt(body.slice(2), 16);
    if (!Number.isFinite(n)) return null;
    return { value: String.fromCharCode(n), end: semi + 1 };
  }
  if (/^#\d+$/.test(body)) {
    const n = parseInt(body.slice(1), 10);
    if (!Number.isFinite(n)) return null;
    return { value: String.fromCharCode(n), end: semi + 1 };
  }
  const named = FLEX_NAMED[body.toLowerCase()];
  if (!named) return null;
  return { value: named, end: semi + 1 };
}

function fuzzyMatches(html: string, normalizedNeedle: string): { start: number; end: number }[] {
  const matches: { start: number; end: number }[] = [];
  const startMap: number[] = [];
  const endMap: number[] = [];
  let norm = "";
  let i = 0;
  while (i < html.length) {
    const entity = readHtmlEntity(html, i);
    const raw = entity?.value ?? html[i]!;
    const next = entity?.end ?? i + 1;
    if (/[\s\u00a0\u202f\u2009]/.test(raw)) {
      if (norm.length === 0 || norm[norm.length - 1] !== " ") {
        startMap.push(i);
        endMap.push(next);
        norm += " ";
      } else {
        endMap[endMap.length - 1] = next;
      }
      i = next;
      continue;
    }
    startMap.push(i);
    endMap.push(next);
    norm += raw;
    i = next;
  }
  const trimmed = norm.trim();
  const trimOffset = norm.length - norm.trimStart().length;
  let from = 0;
  while (from <= trimmed.length) {
    const at = trimmed.indexOf(normalizedNeedle, from);
    if (at < 0) break;
    const absStart = at + trimOffset;
    const absEnd = absStart + normalizedNeedle.length - 1;
    const start = startMap[absStart] ?? 0;
    const end = endMap[absEnd] ?? html.length;
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
