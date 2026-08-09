/**
 * NotesLinker — noteRef cells → anchors; helpers for notes page #note-N.
 * Paginated AFS packs resolve to the group page that owns the anchor
 * (notes-1-10.html#note-3), not the TOC index.
 */

/** Single note token: "2", "2.1" — subsection stays one link to the major note. */
const NOTE_NUMS = /\d{1,2}(?:\.\d{1,2})?/g;
const NOTE_HEADING = /^(\d{1,2})(?:\.\d+)*(?:\.|\s)\s*\S/;

export function noteNumberFromTitle(title: string): number | null {
  const t = title.replace(/\s*\(\s*continued\s*\)\s*$/i, "").trim();
  const m = NOTE_HEADING.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

/** Relative notes base href for a page path, or null when linking is N/A. */
export function notesBaseHref(pagePath: string): string | null {
  if (/notes(?:-\d+(?:-\d+)?|-part-\d+)?\.html$/.test(pagePath)) return null;
  // Same-directory notes.html for flat financials/ and group|company books.
  if (pagePath.startsWith("financials/")) return "notes.html";
  if (pagePath.startsWith("statements/")) return "../financials/notes.html";
  return null;
}

export function noteAnchorId(n: number): string {
  return `note-${n}`;
}

export function noteHref(notesBase: string, n: number): string {
  return `${notesBase}#${noteAnchorId(n)}`;
}

/** Parse notes-1-10.html / notes-3.html / notes-part-2.html into a range. */
export function noteRangeFromPath(path: string): { lo: number; hi: number } | null {
  const ranged =
    /(?:^|\/)notes-(\d+)(?:-(\d+))?\.html$/.exec(path);
  if (ranged) {
    const lo = Number(ranged[1]);
    const hi = ranged[2] != null ? Number(ranged[2]) : lo;
    return { lo, hi };
  }
  const part = /(?:^|\/)notes-part-(\d+)\.html$/.exec(path);
  if (part) {
    const n = Number(part[1]);
    return { lo: n, hi: n };
  }
  return null;
}

/**
 * Map major note number → same-dir page that owns `#note-N`.
 * Built from SitePlan note group pages (e.g. notes-1-10.html).
 * Unmapped numbers fall back to notes.html#note-N.
 */
export function buildNotePageMap(
  notePagePaths: string[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const path of notePagePaths) {
    const file = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    const range = noteRangeFromPath(file);
    if (!range) continue;
    // Sequential part pages don't encode note numbers — skip mapping.
    if (/notes-part-\d+\.html$/i.test(file)) continue;
    for (let n = range.lo; n <= range.hi; n++) {
      if (!map.has(n)) map.set(n, file);
    }
  }
  return map;
}

/** Resolve href for note N given a same-dir base (usually "notes.html"). */
export function resolveNoteHref(
  notesBase: string,
  n: number,
  pageByNote?: Map<number, string> | null,
): string {
  const page = pageByNote?.get(n);
  if (!page) return noteHref(notesBase, n);
  // notesBase may be "notes.html" or "../financials/notes.html"
  const slash = notesBase.lastIndexOf("/");
  const dir = slash >= 0 ? notesBase.slice(0, slash + 1) : "";
  return `${dir}${page}#${noteAnchorId(n)}`;
}

/**
 * Turn a noteRef cell raw string into linked HTML (preserves digits for Gate B).
 * Supports "2", "5, 8", "5 / 8", "2.1", "2.1; 2.2".
 */
export function linkNoteRefHtml(
  raw: string,
  notesBase: string,
  escapeHtml: (s: string) => string,
  pageByNote?: Map<number, string> | null,
): string {
  const text = raw.trim();
  if (!text) return "";
  const parts: string[] = [];
  let last = 0;
  let matched = false;
  for (const m of text.matchAll(NOTE_NUMS)) {
    matched = true;
    const idx = m.index ?? 0;
    if (idx > last) parts.push(escapeHtml(text.slice(last, idx)));
    const major = Number(m[0].split(".")[0]!);
    const href = resolveNoteHref(notesBase, major, pageByNote);
    parts.push(
      `<a class="note-ref" href="${escapeHtml(href)}">${escapeHtml(m[0])}</a>`,
    );
    last = idx + m[0].length;
  }
  if (!matched) return escapeHtml(raw);
  if (last < text.length) parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}
