/**
 * Static HTML bundle smoke (no Chromium). Catches dangling relative links and
 * external http(s) requests. Layout/axe still need Playwright.
 */

export type HtmlSmoke = {
  pages: number;
  dangling: string[];
  external: string[];
  status: "pass" | "fail";
  note: string;
};

const HREF = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
const ABSOLUTE = /^(?:https?:|mailto:|tel:|data:|javascript:)/i;

function dirOf(pagePath: string): string {
  const i = pagePath.lastIndexOf("/");
  return i < 0 ? "" : pagePath.slice(0, i);
}

function resolveRelative(fromPage: string, href: string): string {
  const hash = href.indexOf("#");
  const filePart = hash >= 0 ? href.slice(0, hash) : href;
  const anchor = hash >= 0 ? href.slice(hash + 1) : "";
  if (!filePart || filePart === "./") {
    return anchor ? `${fromPage}#${anchor}` : fromPage;
  }
  const base = dirOf(fromPage);
  const joined = (base ? `${base}/${filePart}` : filePart).replace(/\\/g, "/");
  const parts: string[] = [];
  for (const p of joined.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  const path = parts.join("/");
  return anchor ? `${path}#${anchor}` : path;
}

function pathKnown(files: Record<string, string>, known: Set<string>, path: string): boolean {
  const [file, anchor] = path.split("#");
  if (!file) return false;
  if (!known.has(file)) return false;
  if (!anchor) return true;
  const html = files[file];
  if (html == null) return true;
  return new RegExp(`\\bid=["']${anchor.replace(/[^\w:-]/g, "\\$&")}["']`, "i").test(html);
}

export function htmlBundleSmoke(
  files: Record<string, string>,
  extraPaths: string[] = [],
): HtmlSmoke {
  const known = new Set([...Object.keys(files), ...extraPaths]);
  const htmlPages = Object.keys(files).filter((p) => p.endsWith(".html") && !p.startsWith("prototype/"));
  const dangling: string[] = [];
  const external: string[] = [];
  for (const page of htmlPages) {
    const html = files[page] ?? "";
    HREF.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HREF.exec(html))) {
      const href = m[1]!.trim();
      if (!href || href === "#") continue;
      if (/^https?:\/\//i.test(href)) {
        if (!external.includes(href)) external.push(href);
        continue;
      }
      if (ABSOLUTE.test(href)) continue;
      const resolved = resolveRelative(page, href);
      const fileOnly = resolved.split("#")[0] ?? resolved;
      if (!fileOnly.endsWith(".html") && !fileOnly.includes(".")) continue;
      if (!pathKnown(files, known, resolved) && !dangling.includes(`${page} → ${href}`)) {
        dangling.push(`${page} → ${href}`);
      }
    }
  }
  const status = dangling.length || external.length ? "fail" : "pass";
  return {
    pages: htmlPages.length,
    dangling: dangling.slice(0, 30),
    external: external.slice(0, 20),
    status,
    note:
      status === "pass"
        ? "Relative links resolve; no http(s) requests in HTML (Playwright/axe layout not run)."
        : `${dangling.length} dangling relative link(s), ${external.length} external URL(s). Not a Gate A/B fail.`,
  };
}
