/**
 * NotesLinker — noteRef cells → anchors; helpers for notes page #note-N.
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

/**
 * Turn a noteRef cell raw string into linked HTML (preserves digits for Gate B).
 * Supports "2", "5, 8", "5 / 8", "2.1", "2.1; 2.2".
 */
export function linkNoteRefHtml(
  raw: string,
  notesBase: string,
  escapeHtml: (s: string) => string,
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
    parts.push(
      `<a class="note-ref" href="${escapeHtml(noteHref(notesBase, major))}">${escapeHtml(m[0])}</a>`,
    );
    last = idx + m[0].length;
  }
  if (!matched) return escapeHtml(raw);
  if (last < text.length) parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}
