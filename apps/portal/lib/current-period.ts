/**
 * Deterministic current-period column shading for statement tables.
 * Identifies the latest-year period column *group* (including colspan spans)
 * and marks those leaf columns with data-cur-col + .cur.
 * Numbers are never invented — only markup classes/attrs are added.
 */

export type PeriodSpan = { start: number; end: number; year: number };

/** Extract the highest 4-digit year (1900–2099) from a header cell. */
export function extractYear(text: string): number | null {
  const years = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
  if (!years.length) return null;
  return Math.max(...years);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function intAttr(attrs: string, name: string, fallback: number): number {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i");
  const m = attrs.match(re);
  return m ? Math.max(1, Number(m[1])) : fallback;
}

function colspanOf(attrs: string): number {
  return intAttr(attrs, "colspan", 1);
}

function rowspanOf(attrs: string): number {
  return intAttr(attrs, "rowspan", 1);
}

type CellHit = {
  start: number;
  end: number;
  rowStart: number;
  rowEnd: number;
  attrs: string;
  tag: string;
  inner: string;
  year: number | null;
};

/**
 * Walk table rows and resolve each cell onto a column grid (colspan + rowspan).
 */
function collectCells(tableInner: string): { cells: CellHit[]; rowCount: number } {
  const thead = tableInner.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1];
  const tbody = tableInner.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  // Prefer scanning whole table for marking; year detection uses thead-first rows.
  const scope = tableInner;
  const rows = [...scope.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const occupancy: boolean[][] = [];
  const cells: CellHit[] = [];

  const ensureRow = (r: number) => {
    while (occupancy.length <= r) occupancy.push([]);
  };

  const nextFreeCol = (r: number): number => {
    ensureRow(r);
    let c = 0;
    while (occupancy[r]![c]) c++;
    return c;
  };

  const occupy = (r0: number, c0: number, rs: number, cs: number) => {
    for (let r = r0; r < r0 + rs; r++) {
      ensureRow(r);
      for (let c = c0; c < c0 + cs; c++) occupancy[r]![c] = true;
    }
  };

  rows.forEach((rowMatch, rowIndex) => {
    ensureRow(rowIndex);
    for (const m of rowMatch[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const tag = m[1].toLowerCase();
      const attrs = m[2];
      const inner = m[3];
      const cs = colspanOf(attrs);
      const rs = rowspanOf(attrs);
      const start = nextFreeCol(rowIndex);
      const end = start + cs;
      occupy(rowIndex, start, rs, cs);
      cells.push({
        start,
        end,
        rowStart: rowIndex,
        rowEnd: rowIndex + rs,
        attrs,
        tag,
        inner,
        year: extractYear(stripTags(inner)),
      });
    }
  });

  return { cells, rowCount: occupancy.length };
}

/** Period spans from a header row string (respects colspan; no rowspan). */
export function periodSpansFromRow(rowInner: string): PeriodSpan[] {
  const spans: PeriodSpan[] = [];
  let col = 0;
  for (const m of rowInner.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(m[3]);
    const span = colspanOf(m[2]);
    const year = extractYear(text);
    if (year != null) {
      spans.push({ start: col, end: col + span, year });
    }
    col += span;
  }
  return spans;
}

/**
 * 0-based column index of the latest-year period column, or null if none.
 * Prefer the leftmost column of the max-year group (current usually listed first).
 */
export function findCurrentPeriodColIndex(headers: string[]): number | null {
  const span = findCurrentPeriodSpanFromHeaders(headers);
  return span ? span.start : null;
}

/** Build a single-column span list from flat header strings (injected tables). */
export function findCurrentPeriodSpanFromHeaders(headers: string[]): PeriodSpan | null {
  let best: PeriodSpan | null = null;
  for (let i = 0; i < headers.length; i++) {
    const y = extractYear(headers[i] ?? "");
    if (y == null) continue;
    if (!best || y > best.year || (y === best.year && i < best.start)) {
      best = { start: i, end: i + 1, year: y };
    }
  }
  return best;
}

/**
 * Best period span from a table: max year from year-bearing header cells;
 * on ties prefer leftmost (current-first). Uses colspan width of that cell.
 */
export function findCurrentPeriodSpan(tableInner: string): PeriodSpan | null {
  // Prefer thead-only when present so body years (e.g. "restated 2024") don't win.
  const thead = tableInner.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? tableInner;
  const { cells: hits } = collectCells(thead);
  let best: PeriodSpan | null = null;
  for (const cell of hits) {
    if (cell.year == null) continue;
    const span: PeriodSpan = { start: cell.start, end: cell.end, year: cell.year };
    if (
      !best ||
      span.year > best.year ||
      (span.year === best.year && span.start < best.start)
    ) {
      best = span;
    }
  }
  return best;
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

function addCurClass(attrs: string): string {
  if (/\bclass\s*=\s*["'][^"']*\bcur\b/i.test(attrs)) return attrs;
  if (/\bclass\s*=\s*["']([^"']*)["']/i.test(attrs)) {
    return attrs.replace(/\bclass\s*=\s*["']([^"']*)["']/i, (_m, c: string) => `class="${c} cur"`);
  }
  return `${attrs} class="cur"`;
}

function colsOverlap(start: number, end: number, span: PeriodSpan): boolean {
  return start < span.end && end > span.start;
}

function dataCurColAttr(span: PeriodSpan): string {
  const cols: number[] = [];
  for (let i = span.start; i < span.end; i++) cols.push(i + 1);
  return cols.join(" ");
}

function stripCurClasses(inner: string): string {
  return inner.replace(/\sclass="([^"]*)"/gi, (_m, c: string) => {
    const next = c
      .split(/\s+/)
      .filter((x: string) => x && x !== "cur")
      .join(" ");
    return next ? ` class="${next}"` : "";
  });
}

/**
 * Re-emit table rows with .cur on cells overlapping the period span.
 * Tracks rowspan so multi-level headers keep correct leaf columns.
 */
function markTableWithSpan(tableInner: string, span: PeriodSpan): string {
  const rows = [...tableInner.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  if (!rows.length) return tableInner;

  const occupancy: boolean[][] = [];
  const ensureRow = (r: number) => {
    while (occupancy.length <= r) occupancy.push([]);
  };
  const nextFreeCol = (r: number): number => {
    ensureRow(r);
    let c = 0;
    while (occupancy[r]![c]) c++;
    return c;
  };
  const occupy = (r0: number, c0: number, rs: number, cs: number) => {
    for (let r = r0; r < r0 + rs; r++) {
      ensureRow(r);
      for (let c = c0; c < c0 + cs; c++) occupancy[r]![c] = true;
    }
  };

  // Rebuild by replacing each tr in order (left-to-right stable).
  let cursor = 0;
  const parts: string[] = [];
  rows.forEach((rowMatch, rowIndex) => {
    const absIndex = tableInner.indexOf(rowMatch[0], cursor);
    parts.push(tableInner.slice(cursor, absIndex));
    cursor = absIndex + rowMatch[0].length;

    const trAttrs = rowMatch[1];
    let rowHtml = "";
    for (const m of rowMatch[2].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const tag = m[1];
      let attrs = m[2];
      const inner = m[3];
      const cs = colspanOf(attrs);
      const rs = rowspanOf(attrs);
      const start = nextFreeCol(rowIndex);
      const end = start + cs;
      occupy(rowIndex, start, rs, cs);
      if (colsOverlap(start, end, span)) attrs = addCurClass(attrs);
      rowHtml += `<${tag}${attrs}>${inner}</${tag}>`;
    }
    parts.push(`<tr${trAttrs}>${rowHtml}</tr>`);
  });
  parts.push(tableInner.slice(cursor));
  return parts.join("");
}

/**
 * Walk every `<table>` in HTML and mark the latest-year column group.
 * Idempotent: re-marks cleanly if data-cur-col already present.
 */
export function markCurrentPeriodColumns(html: string): string {
  if (!html || !html.includes("<table")) return html;
  return html.replace(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, (full, attrs: string, inner: string) => {
    const span = findCurrentPeriodSpan(inner);
    if (!span || span.end <= span.start) return full;

    let newAttrs = attrs.replace(/\s*data-cur-col\s*=\s*["'][^"']*["']/gi, "");
    newAttrs = `${newAttrs} data-cur-col="${dataCurColAttr(span)}"`;

    const cleaned = markTableWithSpan(stripCurClasses(inner), span);
    return `<table${newAttrs}>${cleaned}</table>`;
  });
}
