import type { ContentSample, ContentTable } from "./studio";
import { findCurrentPeriodColIndex } from "./current-period";

/**
 * Deterministic safety net: if the studio HTML omitted a supplied table or
 * letter paragraph, inject into shell section anchors (#financial-statements,
 * #notes, #shareholder-letter) when present, otherwise append a polished
 * appendix so export never silently drops extracted financials.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function htmlHasNeedle(html: string, needle: string): boolean {
  const n = normalize(needle);
  if (n.length < 6) return false;
  return normalize(html).includes(n);
}

function tablePresent(html: string, table: ContentTable): boolean {
  if (table.caption && htmlHasNeedle(html, table.caption) && table.rows.length > 0) {
    // Caption alone can false-positive ("Condensed Consolidated"); require a data cell too.
    const probe = table.rows.find((r) => r.some((c) => /\d/.test(c) && c.trim().length >= 3));
    if (probe) {
      const cell = probe.find((c) => /\d/.test(c) && c.trim().length >= 3)!;
      if (htmlHasNeedle(html, cell)) return true;
    }
  }
  // Distinctive numeric cell from mid-table
  for (const row of table.rows.slice(0, 12)) {
    for (const cell of row) {
      if (/\d/.test(cell) && cell.trim().length >= 4 && htmlHasNeedle(html, cell)) {
        // Also require a label from same row when possible
        const label = row[0];
        if (!label || label.length < 3 || htmlHasNeedle(html, label)) return true;
      }
    }
  }
  return false;
}

export function renderContentTable(table: ContentTable): string {
  const cur0 = table.headers.length ? findCurrentPeriodColIndex(table.headers) : null;
  const curAttr = cur0 != null ? ` data-cur-col="${cur0 + 1}"` : "";
  const curClass = (i: number) => (cur0 != null && i === cur0 ? ' class="cur"' : "");
  const head = table.headers.length
    ? `<thead><tr>${table.headers
        .map((h, i) => `<th scope="col"${curClass(i)}>${escapeHtml(h)}</th>`)
        .join("")}</tr></thead>`
    : "";
  const body = `<tbody>${table.rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) =>
            i === 0
              ? `<th scope="row"${curClass(i)}>${escapeHtml(c)}</th>`
              : `<td${curClass(i)}>${escapeHtml(c)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("")}</tbody>`;
  return `<section class="rs-injected-table" data-dna-component="statement-table" data-table-id="${escapeHtml(table.id)}" id="${escapeHtml(table.id.replace(/[^a-zA-Z0-9_-]/g, "-"))}">
<h3>${escapeHtml(table.caption)}</h3>
<div class="rs-table-wrap"><table${curAttr}>${head}${body}</table></div>
</section>`;
}

const INJECT_CSS = `
.rs-coverage-appendix{padding:3rem 1.25rem 4rem;max-width:var(--rs-content-max,1120px);margin:0 auto}
.rs-coverage-appendix h2{font-family:var(--dna-font-heading,Georgia,serif);font-size:1.75rem;margin:0 0 1rem;color:var(--dna-ink,#231F20)}
.rs-coverage-appendix h3{font-family:var(--dna-font-heading,Georgia,serif);font-size:1.15rem;margin:2rem 0 0.75rem;color:var(--dna-ink,#231F20)}
.rs-coverage-appendix .rs-table-wrap,.rs-injected-table .rs-table-wrap{overflow-x:auto;border:1px solid color-mix(in srgb,var(--dna-ink,#231F20) 28%,var(--dna-paper,#fff));margin-bottom:1.5rem}
.rs-coverage-appendix table,.rs-injected-table table{width:100%;border-collapse:collapse;font-family:var(--dna-font-body,Georgia,serif);font-variant-numeric:tabular-nums;font-size:0.875rem}
.rs-coverage-appendix th,.rs-coverage-appendix td,.rs-injected-table th,.rs-injected-table td{padding:0.45rem 0.65rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#231F20) 18%,var(--dna-paper,#fff));text-align:right;vertical-align:top}
.rs-coverage-appendix th[scope=row],.rs-coverage-appendix td:first-child,.rs-coverage-appendix th:first-child,.rs-injected-table th[scope=row],.rs-injected-table td:first-child,.rs-injected-table th:first-child{text-align:left;font-weight:600;color:var(--dna-ink,#231F20)}
.rs-coverage-appendix thead th,.rs-injected-table thead th{background:color-mix(in srgb,var(--dna-table-header-bg,#839097) 68%,var(--dna-ink,#231F20));color:var(--dna-table-header-text,#fff);text-align:right;font-weight:600}
.rs-coverage-appendix thead th:first-child,.rs-injected-table thead th:first-child{text-align:left}
.rs-coverage-appendix .rs-letter-miss,.rs-letter-miss{max-width:var(--rs-content-max,1120px);width:100%;line-height:1.7}
.rs-coverage-appendix .rs-letter-miss p,.rs-letter-miss p{max-width:none;width:100%;line-height:1.7;margin:0 0 1.35em;color:var(--dna-ink,#231F20);overflow:visible;text-overflow:unset;white-space:normal}
#financial-statements .rs-injected-table,#notes .rs-injected-table{margin:1.5rem 0}
`;

function ensureInjectCss(html: string): string {
  if (html.includes('data-rs-coverage="1"')) return html;
  const styleTag = `<style data-rs-coverage="1">${INJECT_CSS}</style>`;
  if (html.includes("</head>")) return html.replace("</head>", `${styleTag}</head>`);
  return styleTag + html;
}

function injectBeforeCloseBody(html: string, chunk: string): string {
  const out = ensureInjectCss(html);
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${chunk}</body>`);
  return out + chunk;
}

/**
 * Insert `chunk` just before the closing tag of the first element with id=`id`.
 * Returns null if the anchor is missing.
 */
export function injectAtSectionId(html: string, id: string, chunk: string): string | null {
  const openRe = new RegExp(`(<([a-zA-Z][\\w:-]*)\\b[^>]*\\bid=["']${id}["'][^>]*>)`, "i");
  const m = openRe.exec(html);
  if (!m || m.index === undefined) return null;
  const tag = m[2];
  const afterOpen = m.index + m[0].length;
  const closeRe = new RegExp(`</${tag}\\s*>`, "i");
  const rest = html.slice(afterOpen);
  const closeM = closeRe.exec(rest);
  if (!closeM || closeM.index === undefined) return null;
  const closeAbs = afterOpen + closeM.index;
  return html.slice(0, closeAbs) + `\n${chunk}\n` + html.slice(closeAbs);
}

function isNoteTable(t: ContentTable): boolean {
  const type = (t.table_type ?? "").toLowerCase();
  const cap = t.caption.toLowerCase();
  const id = t.id.toLowerCase();
  return type.includes("note") || cap.includes("note") || id.includes("note");
}

/**
 * Ensure every ContentSample table (and omitted letter paragraphs) appear in
 * the HTML. Prefers shell anchors (#financial-statements, #notes,
 * #shareholder-letter / #letter); falls back to a DNA-styled appendix.
 */
export function ensureContentCoverage(html: string, content: ContentSample): string {
  const tables = content.tables?.length
    ? content.tables
    : content.table.headers.length || content.table.rows.length
      ? [{ id: "primary", ...content.table, must_appear: true }]
      : [];

  const missingTables = tables.filter((t) => t.rows.length > 0 && !tablePresent(html, t));

  const missingLetter: string[] = [];
  for (const p of content.letter.paragraphs) {
    if (p.trim().length >= 40 && !htmlHasNeedle(html, p.slice(0, 80))) missingLetter.push(p);
  }

  if (!missingTables.length && !missingLetter.length) return html;

  let out = ensureInjectCss(html);
  const statementTables = missingTables.filter((t) => !isNoteTable(t));
  const noteTables = missingTables.filter((t) => isNoteTable(t));

  let statementsPlacedInAnchor = false;
  let notesPlacedInAnchor = false;
  let letterPlacedInAnchor = false;

  if (statementTables.length) {
    const chunk = statementTables.map(renderContentTable).join("\n");
    const next = injectAtSectionId(out, "financial-statements", chunk);
    if (next) {
      out = next;
      statementsPlacedInAnchor = true;
    }
  }

  if (noteTables.length) {
    const chunk = noteTables.map(renderContentTable).join("\n");
    const next = injectAtSectionId(out, "notes", chunk);
    if (next) {
      out = next;
      notesPlacedInAnchor = true;
    }
  }

  const leftoverTables = [
    ...(statementsPlacedInAnchor ? [] : statementTables),
    ...(notesPlacedInAnchor ? [] : noteTables),
  ];

  let leftoverLetter = missingLetter;
  if (missingLetter.length) {
    const letterHtml = [
      `<div class="rs-letter-miss" data-dna-component="letter-block">`,
      `<h3>${escapeHtml(content.letter.heading)}</h3>`,
      ...missingLetter.map((p) => `<p>${escapeHtml(p)}</p>`),
      `</div>`,
    ].join("\n");
    const intoLetter =
      injectAtSectionId(out, "shareholder-letter", letterHtml) ??
      injectAtSectionId(out, "letter", letterHtml);
    if (intoLetter) {
      out = intoLetter;
      letterPlacedInAnchor = true;
      leftoverLetter = [];
    }
  }

  if (!leftoverTables.length && !leftoverLetter.length) {
    console.log(
      `[content-coverage] injected into shell anchors tables=${missingTables.length} letter_anchor=${letterPlacedInAnchor}`,
    );
    return out;
  }

  const parts: string[] = [
    `<section id="full-statements" class="rs-coverage-appendix" data-dna-component="coverage-appendix" aria-label="Full financial content">`,
    `<h2>Complete financial content</h2>`,
    `<p>The following statements and disclosures are reproduced verbatim from the source results announcement.</p>`,
  ];

  if (leftoverLetter.length) {
    parts.push(`<div class="rs-letter-miss" data-dna-component="letter-block">`);
    parts.push(`<h3>${escapeHtml(content.letter.heading)}</h3>`);
    for (const p of leftoverLetter) parts.push(`<p>${escapeHtml(p)}</p>`);
    parts.push(`</div>`);
  }

  for (const t of leftoverTables) parts.push(renderContentTable(t));
  parts.push(`</section>`);

  if (/<nav[\s\S]*?<\/nav>/i.test(out) && !/href=["']#full-statements["']/.test(out)) {
    out = out.replace(
      /<\/nav>/i,
      `<a href="#full-statements">Statements &amp; notes</a></nav>`,
    );
  }

  console.log(
    `[content-coverage] injected tables=${leftoverTables.length} letter_paras=${leftoverLetter.length} (appendix; shell anchors used where available)`,
  );
  return injectBeforeCloseBody(out, parts.join("\n"));
}
