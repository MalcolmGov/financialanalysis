/**
 * Deterministic current-period column shading for statement tables.
 * Picks the latest year column from headers and marks it with data-cur-col + .cur.
 * Numbers are never invented — only markup classes/attrs are added.
 */

/** Extract the highest 4-digit year (1900–2099) from a header cell. */
export function extractYear(text: string): number | null {
  const years = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
  if (!years.length) return null;
  return Math.max(...years);
}

/**
 * 0-based column index of the latest-year period column, or null if none.
 * Skips columns with no year; when ties, prefers the rightmost.
 */
export function findCurrentPeriodColIndex(headers: string[]): number | null {
  let bestCol: number | null = null;
  let bestYear = -1;
  for (let i = 0; i < headers.length; i++) {
    const y = extractYear(headers[i] ?? "");
    if (y != null && y >= bestYear) {
      bestYear = y;
      bestCol = i;
    }
  }
  return bestCol;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function colspanOf(attrs: string): number {
  const m = attrs.match(/\bcolspan\s*=\s*["']?(\d+)/i);
  return m ? Math.max(1, Number(m[1])) : 1;
}

/** Parse header cells into a flat column→text map (respects colspan). */
export function headerTextsFromRow(rowInner: string): string[] {
  const headers: string[] = [];
  for (const m of rowInner.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(m[3]);
    const span = colspanOf(m[2]);
    for (let c = 0; c < span; c++) headers.push(c === 0 ? text : "");
  }
  return headers;
}

/** Best header row for year detection: the one with the most year-bearing cells. */
function pickHeaderRow(tableInner: string): string[] | null {
  const thead = tableInner.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? tableInner;
  const rows = [...thead.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  let best: string[] | null = null;
  let bestScore = -1;
  for (const r of rows) {
    const headers = headerTextsFromRow(r[1]);
    const score = headers.filter((h) => extractYear(h) != null).length;
    if (score > bestScore) {
      bestScore = score;
      best = headers;
    }
  }
  return bestScore > 0 ? best : null;
}

function addCurClass(attrs: string): string {
  if (/\bclass\s*=\s*["'][^"']*\bcur\b/i.test(attrs)) return attrs;
  if (/\bclass\s*=\s*["']([^"']*)["']/i.test(attrs)) {
    return attrs.replace(/\bclass\s*=\s*["']([^"']*)["']/i, (_m, c: string) => `class="${c} cur"`);
  }
  return `${attrs} class="cur"`;
}

/** Mark cells in a row whose grid columns intersect `curCol` (0-based). */
function markRowCells(rowInner: string, curCol: number): string {
  let col = 0;
  return rowInner.replace(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (full, tag: string, attrs: string, inner: string) => {
    const span = colspanOf(attrs);
    const start = col;
    const end = col + span;
    col = end;
    if (curCol < start || curCol >= end) return full;
    return `<${tag}${addCurClass(attrs)}>${inner}</${tag}>`;
  });
}

function markTableInner(inner: string, curCol: number): string {
  return inner.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi, (_full, trAttrs: string, rowInner: string) => {
    return `<tr${trAttrs}>${markRowCells(rowInner, curCol)}</tr>`;
  });
}

/**
 * Walk every `<table>` in HTML and mark the latest-year column.
 * Idempotent: re-marks cleanly if data-cur-col already present.
 */
export function markCurrentPeriodColumns(html: string): string {
  if (!html || !html.includes("<table")) return html;
  return html.replace(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, (full, attrs: string, inner: string) => {
    const headers = pickHeaderRow(inner);
    if (!headers) return full;
    const cur0 = findCurrentPeriodColIndex(headers);
    if (cur0 == null || cur0 < 0) return full;
    const cur1 = cur0 + 1; // 1-based for data-cur-col / nth-child

    let newAttrs = attrs.replace(/\s*data-cur-col\s*=\s*["'][^"']*["']/gi, "");
    newAttrs = `${newAttrs} data-cur-col="${cur1}"`;

    // Strip prior .cur then re-apply so re-polish stays correct
    let cleaned = inner.replace(/\sclass="([^"]*)"/gi, (_m, c: string) => {
      const next = c
        .split(/\s+/)
        .filter((x: string) => x && x !== "cur")
        .join(" ");
      return next ? ` class="${next}"` : "";
    });
    cleaned = markTableInner(cleaned, cur0);
    return `<table${newAttrs}>${cleaned}</table>`;
  });
}
