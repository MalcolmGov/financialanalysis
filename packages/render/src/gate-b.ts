import { parseHTML } from "linkedom";
import { NUMERIC_TOKEN, numericEquivalent } from "./normalize.js";
import { resolveCell, type ResolveContext } from "./resolve.js";

/**
 * Gate B — the rendered-DOM number audit. Parse every emitted HTML file and
 * assert that every digit-bearing token is traceable to a source cell whose
 * verbatim string matches (after grouping-whitespace tolerance). This is what
 * makes a transposed digit impossible to ship:
 *
 *   1. A `[data-src]` element's text must equal its source cell verbatim.
 *   2. A digit-bearing text node NOT inside a `[data-src]` (or an explicitly
 *      `[data-allow-number]`) ancestor is an untraceable number — a failure.
 *
 * Any failure blocks export. There is no override in v1.
 */

export type DomAuditReason =
  | "verbatim-mismatch"
  | "no-data-src"
  | "dangling-src";

export interface DomAuditFailure {
  page: string;
  token: string;
  data_src: string | null;
  source_raw: string | null;
  reason: DomAuditReason;
}

export interface GateBResult {
  status: "pass" | "fail";
  pages_scanned: number;
  numeric_tokens_found: number;
  matched: number;
  failures: DomAuditFailure[];
}

/** Split a text node into whitespace-separated tokens that carry a digit. */
function numericTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && NUMERIC_TOKEN.test(t));
}

export function gateB(
  files: Record<string, string>,
  ctx: ResolveContext,
): GateBResult {
  const failures: DomAuditFailure[] = [];
  let tokensFound = 0;
  let matched = 0;

  for (const [page, html] of Object.entries(files)) {
    const { document } = parseHTML(html);

    // 1. Every data-src element must equal its source verbatim.
    const tagged = document.querySelectorAll("[data-src]");
    for (const el of Array.from(tagged) as Element[]) {
      const ref = el.getAttribute("data-src");
      const rendered = (el.textContent ?? "").trim();
      if (!ref) continue;
      const source = resolveCell(ref, ctx);
      if (source === null) {
        failures.push({ page, token: rendered, data_src: ref, source_raw: null, reason: "dangling-src" });
        continue;
      }
      tokensFound++;
      if (numericEquivalent(rendered, source)) {
        matched++;
      } else {
        failures.push({ page, token: rendered, data_src: ref, source_raw: source, reason: "verbatim-mismatch" });
      }
    }

    // 2. Any digit-bearing text node outside a traceable ancestor is untraceable.
    const walker = document.createTreeWalker(document.body ?? document, 0x4 /* SHOW_TEXT */);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      if (NUMERIC_TOKEN.test(text) && !hasTraceableAncestor(node as unknown as { parentElement: Element | null })) {
        for (const tok of numericTokens(text)) {
          tokensFound++;
          failures.push({ page, token: tok, data_src: null, source_raw: null, reason: "no-data-src" });
        }
      }
      node = walker.nextNode();
    }
  }

  return {
    status: failures.length === 0 ? "pass" : "fail",
    pages_scanned: Object.keys(files).length,
    numeric_tokens_found: tokensFound,
    matched,
    failures,
  };
}

function hasTraceableAncestor(node: { parentElement: Element | null }): boolean {
  let el: Element | null = node.parentElement;
  while (el) {
    if (el.hasAttribute("data-src") || el.hasAttribute("data-allow-number")) return true;
    // <script> config blocks and <style> are not visible copy.
    const tag = el.tagName?.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "th") return true;
    el = el.parentElement;
  }
  return false;
}
