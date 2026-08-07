/**
 * NotesLinker — noteRef cells → anchors; helpers for notes page #note-N.
 */

const NOTE_NUMS = /\d{1,2}/g;
const NOTE_HEADING = /^(\d{1,2})\.\s+\S/;

export function noteNumberFromTitle(title: string): number | null {
  const m = NOTE_HEADING.exec(title.trim());
  return m ? Number(m[1]) : null;
}

/** Relative notes base href for a page path, or null when linking is N/A. */
export function notesBaseHref(pagePath: string): string | null {
  if (pagePath.endsWith("notes.html")) return null;
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
 * Supports "2", "5, 8", "5 / 8".
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
    const n = Number(m[0]);
    parts.push(
      `<a class="note-ref" href="${escapeHtml(noteHref(notesBase, n))}">${escapeHtml(m[0])}</a>`,
    );
    last = idx + m[0].length;
  }
  if (!matched) return escapeHtml(raw);
  if (last < text.length) parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}
