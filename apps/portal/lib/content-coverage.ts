import type { ContentSample, ContentTable } from "./studio";

/**
 * Deterministic safety net: if the studio HTML omitted a supplied table or
 * letter paragraph, append a polished statements/notes block so export never
 * silently drops extracted financials.
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
  const head = table.headers.length
    ? `<thead><tr>${table.headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead>`
    : "";
  const body = `<tbody>${table.rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) =>
            i === 0
              ? `<th scope="row">${escapeHtml(c)}</th>`
              : `<td>${escapeHtml(c)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("")}</tbody>`;
  return `<section class="rs-injected-table" data-dna-component="statement-table" data-table-id="${escapeHtml(table.id)}" id="${escapeHtml(table.id.replace(/[^a-zA-Z0-9_-]/g, "-"))}">
<h3>${escapeHtml(table.caption)}</h3>
<div class="rs-table-wrap"><table>${head}${body}</table></div>
</section>`;
}

const INJECT_CSS = `
.rs-coverage-appendix{padding:3rem 1.25rem 4rem;max-width:1120px;margin:0 auto}
.rs-coverage-appendix h2{font-family:var(--dna-font-heading,Georgia,serif);font-size:1.75rem;margin:0 0 1rem;color:var(--dna-ink,#231F20)}
.rs-coverage-appendix h3{font-family:var(--dna-font-heading,Georgia,serif);font-size:1.15rem;margin:2rem 0 0.75rem;color:var(--dna-ink,#231F20)}
.rs-coverage-appendix .rs-table-wrap{overflow-x:auto;border:1px solid color-mix(in srgb,var(--dna-ink,#231F20) 12%,transparent);margin-bottom:1.5rem}
.rs-coverage-appendix table{width:100%;border-collapse:collapse;font-family:var(--dna-font-body,Georgia,serif);font-variant-numeric:tabular-nums;font-size:0.875rem}
.rs-coverage-appendix th,.rs-coverage-appendix td{padding:0.45rem 0.65rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#231F20) 10%,transparent);text-align:right;vertical-align:top}
.rs-coverage-appendix th[scope=row],.rs-coverage-appendix td:first-child,.rs-coverage-appendix th:first-child{text-align:left;font-weight:600}
.rs-coverage-appendix thead th{background:var(--dna-table-header-bg,#839097);color:var(--dna-table-header-text,#fff);text-align:right;font-weight:600}
.rs-coverage-appendix thead th:first-child{text-align:left}
.rs-coverage-appendix .rs-letter-miss p{max-width:42rem;line-height:1.55;margin:0 0 0.85rem;color:var(--dna-ink,#231F20)}
`;

function injectBeforeCloseBody(html: string, chunk: string): string {
  const styleTag = `<style data-rs-coverage="1">${INJECT_CSS}</style>`;
  let out = html;
  if (!out.includes('data-rs-coverage="1"')) {
    if (out.includes("</head>")) out = out.replace("</head>", `${styleTag}</head>`);
    else out = styleTag + out;
  }
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${chunk}</body>`);
  return out + chunk;
}

/**
 * Ensure every ContentSample table (and omitted letter paragraphs) appear in
 * the HTML. Appends a DNA-styled appendix only for missing pieces.
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

  const parts: string[] = [
    `<section id="full-statements" class="rs-coverage-appendix" data-dna-component="coverage-appendix" aria-label="Full financial content">`,
    `<h2>Complete financial content</h2>`,
    `<p>The following statements and disclosures are reproduced verbatim from the source results announcement.</p>`,
  ];

  if (missingLetter.length) {
    parts.push(`<div class="rs-letter-miss" data-dna-component="letter-block">`);
    parts.push(`<h3>${escapeHtml(content.letter.heading)}</h3>`);
    for (const p of missingLetter) parts.push(`<p>${escapeHtml(p)}</p>`);
    parts.push(`</div>`);
  }

  for (const t of missingTables) parts.push(renderContentTable(t));
  parts.push(`</section>`);

  // Ensure nav can reach the appendix when a masthead nav exists.
  let out = html;
  if (/<nav[\s\S]*?<\/nav>/i.test(out) && !/href=["']#full-statements["']/.test(out)) {
    out = out.replace(
      /<\/nav>/i,
      `<a href="#full-statements">Statements &amp; notes</a></nav>`,
    );
  }

  console.log(
    `[content-coverage] injected tables=${missingTables.length} letter_paras=${missingLetter.length}`,
  );
  return injectBeforeCloseBody(out, parts.join("\n"));
}
