import type { FinancialDocModel, SitePlan } from "@rs/contracts";
import { renderBreadcrumb } from "./chrome.js";
import { noteAnchorId, noteNumberFromTitle } from "./notes-linker.js";

/**
 * Fill WW-style prose pages after the deterministic table render.
 * Prose is injected as HTML (with data-src) so SitePlan text slots never
 * carry numerals — Gate B still covers any .num / data-src spans in tables.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NOTE_HEADING = /^(\d{1,2})\.\s+\S/;
function noteNumberOf(title: string): number | null {
  return noteNumberFromTitle(title);
}

function sectionBlocksHtml(
  sections: FinancialDocModel["sections"],
  kinds: string[],
): string {
  const parts: string[] = [];
  for (const sec of sections) {
    if (!kinds.includes(sec.kind)) continue;
    if (sec.title?.text) {
      const src = sec.title.src_ref ? ` data-src="${escapeHtml(sec.title.src_ref)}"` : "";
      parts.push(`<h2 class="prose-h"${src}>${escapeHtml(sec.title.text)}</h2>`);
    }
    for (const b of sec.blocks) {
      if (b.kind === "table") continue;
      const text = b.text?.trim();
      if (!text) continue;
      const src = b.src_ref ? ` data-src="${escapeHtml(b.src_ref)}"` : "";
      if (b.kind === "heading") {
        parts.push(`<h3 class="prose-subh"${src}>${escapeHtml(text)}</h3>`);
      } else if (b.kind === "list") {
        parts.push(`<li class="prose-li"${src}>${escapeHtml(text)}</li>`);
      } else {
        parts.push(`<p class="prose-p"${src}>${escapeHtml(text)}</p>`);
      }
    }
  }
  return parts.join("\n");
}

function wrapLooseListItems(html: string): string {
  if (!html.includes("prose-li")) return html;
  return html.replace(/(?:<li class="prose-li"[^>]*>[\s\S]*?<\/li>\n?)+/g, (block) => {
    return `<ul class="prose-ul">${block}</ul>`;
  });
}

function exploreCards(plan: SitePlan): string {
  const cards = plan.nav
    .filter((n) => n.href !== "index.html")
    .map((n, i) => {
      const n_ = String(i + 1).padStart(2, "0");
      // Decorative card index — not a financial figure (Gate B allow-list).
      return `<a class="explore-card" href="${escapeHtml(n.href)}"><span class="explore-n" data-allow-number>${n_}</span><span class="explore-label">${escapeHtml(n.label)}</span></a>`;
    })
    .join("");
  return `<section class="explore" aria-label="Explore the report"><h2 class="prose-h">Explore the report</h2><div class="explore-grid">${cards}</div></section>`;
}

function highlightsHtml(docModel: FinancialDocModel): string {
  const hi = docModel.sections.find((s) => s.kind === "highlights");
  if (!hi) return "";
  const body = wrapLooseListItems(
    sectionBlocksHtml(
      docModel.sections.filter((s) => s.kind === "highlights"),
      ["highlights"],
    ),
  );
  return `<section class="highlights" aria-label="Highlights">${body || "<p class=\"prose-p\">Highlights from the interim results.</p>"}</section>`;
}

function homeHero(docModel: FinancialDocModel): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  const period = escapeHtml(docModel.meta.period_label || "");
  return `<header class="home-hero" data-dna-component="home-hero">
<p class="home-kicker">Interactive results</p>
<h1>${company}</h1>
${period ? `<p class="home-period" data-allow-number>${period}</p>` : ""}
<p class="home-cta"><a href="commentary.html">Read commentary</a><a href="financials/income-statement.html">View financials</a></p>
</header>`;
}

function downloadsHtml(docModel: FinancialDocModel): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  return `<section class="downloads" data-dna-component="downloads">
<h2 class="prose-h">Downloads</h2>
<p class="prose-p">Source PDF and spreadsheet exports for ${company}.</p>
<ul class="download-list">
<li><span class="dl-label">Full results PDF</span><span class="dl-note">Open the source document from your project upload (not bundled in this static zip).</span></li>
<li><span class="dl-label">Excel workbook</span><span class="dl-note">Coming soon — statement tables are available as HTML on the Financials pages.</span></li>
</ul>
</section>`;
}

function injectInto(html: string, markerClass: string, content: string): string {
  const re = new RegExp(`(<[^>]*class="[^"]*\\b${markerClass}\\b[^"]*"[^>]*>)([\\s\\S]*?)(</(?:div|main|section)>)`, "i");
  if (re.test(html)) {
    // Function replacer — prose may contain `$1` / `$&` (e.g. FX rates).
    return html.replace(re, (_m, open: string, _inner: string, close: string) => `${open}${content}${close}`);
  }
  // Fallback: insert before closing </main>
  if (/<\/main>/i.test(html)) {
    return html.replace(/<\/main>/i, () => `${content}</main>`);
  }
  return html;
}

function replaceHomeHero(html: string, hero: string): string {
  if (/class="[^"]*\bhome-hero\b/.test(html)) {
    return html.replace(/<header class="home-hero"[\s\S]*?<\/header>/i, () => hero);
  }
  return html.replace(
    /(<main[^>]*class="[^"]*\bpage-home\b[^"]*"[^>]*>)/i,
    (_m, open: string) => `${open}${hero}`,
  );
}

function pageHero(opts: {
  path: string;
  title: string;
  company?: string;
  periodLabel?: string;
  eyebrow?: string;
}): string {
  const crumb = renderBreadcrumb(opts.path, opts.title, opts.company);
  const eyebrow = opts.eyebrow ?? "Condensed Consolidated — Unaudited";
  const sub = opts.periodLabel?.trim()
    ? `<p class="page-hero__sub" data-allow-number>${escapeHtml(opts.periodLabel.trim())}</p>`
    : "";
  return `<header class="page-hero" data-dna-component="page-hero">${crumb}<p class="page-hero__eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(opts.title)}</h1>${sub}</header>`;
}

/** Map table src → note number from section metadata + table title cells. */
function noteNumberByTableSrc(docModel: FinancialDocModel): Map<string, number> {
  const bySrc = new Map<string, number>();
  for (const sec of docModel.sections) {
    const n =
      sec.note_number ??
      (sec.title?.text ? noteNumberOf(sec.title.text) : null);
    if (n == null) continue;
    for (const b of sec.blocks) {
      if (b.kind === "table" && b.table_ref) {
        const tbl = docModel.tables.find((t) => t.id === b.table_ref);
        if (tbl?.src_table) bySrc.set(tbl.src_table, n);
      }
    }
  }
  // Also scan table header first cells for "N. Title" when section meta missed it.
  for (const tbl of docModel.tables) {
    if (bySrc.has(tbl.src_table)) continue;
    const tip = tbl.header_matrix[0]?.[0]?.raw ?? "";
    const n = noteNumberOf(tip);
    if (n != null) bySrc.set(tbl.src_table, n);
  }
  return bySrc;
}

/** Wrap each notes table section with #note-N when a note number is known. */
function anchorNotes(
  html: string,
  docModel: FinancialDocModel,
): string {
  const bySrc = noteNumberByTableSrc(docModel);
  return html.replace(
    /<section([^>]*data-dna-component="statement-table"[^>]*)>([\s\S]*?)<\/section>/gi,
    (full, attrs: string, inner: string) => {
      const m = /data-table-src="([^"]+)"/.exec(inner) || /data-table-src="([^"]+)"/.exec(attrs);
      const src = m?.[1];
      const n = src ? bySrc.get(src) : undefined;
      if (n == null) return full;
      const id = noteAnchorId(n);
      if (/\sid="/.test(attrs)) return full;
      return `<section id="${id}" class="note-block"${attrs}><h2 class="note-title" data-allow-number>Note ${n}</h2>${inner}</section>`;
    },
  );
}

/**
 * Build anchored prose note blocks from the notes section headings (1. … 10. …).
 * Tables already on the page keep their anchors; prose fills gaps so statement
 * note links always resolve.
 */
function notesProseBlocks(docModel: FinancialDocModel): string {
  const notesSec = docModel.sections.find(
    (s) => s.kind === "note" && s.id === "doc:sec_notes",
  );
  if (!notesSec) return "";

  type Bucket = {
    n: number;
    title: string;
    titleSrc?: string;
    paras: Array<{ text: string; src?: string }>;
  };
  const buckets: Bucket[] = [];
  let cur: Bucket | null = null;

  for (const b of notesSec.blocks) {
    if (b.kind === "table") continue;
    const text = b.text?.trim();
    if (!text) continue;
    if (b.kind === "heading" && NOTE_HEADING.test(text)) {
      const n = noteNumberOf(text)!;
      cur = { n, title: text, titleSrc: b.src_ref, paras: [] };
      buckets.push(cur);
      continue;
    }
    if (!cur) continue;
    if (b.kind === "heading" && /notes to the/i.test(text)) continue;
    cur.paras.push({ text, src: b.src_ref });
  }

  // Deduplicate by note number (continued headings); keep first rich bucket.
  const byN = new Map<number, Bucket>();
  for (const b of buckets) {
    const prev = byN.get(b.n);
    if (!prev || b.paras.length > prev.paras.length) byN.set(b.n, b);
  }

  return [...byN.values()]
    .sort((a, b) => a.n - b.n)
    .map((b) => {
      const id = noteAnchorId(b.n);
      const titleSrc = b.titleSrc ? ` data-src="${escapeHtml(b.titleSrc)}"` : "";
      const paras = b.paras
        .slice(0, 12)
        .map((p) => {
          const src = p.src ? ` data-src="${escapeHtml(p.src)}"` : "";
          return `<p class="prose-p"${src}>${escapeHtml(p.text)}</p>`;
        })
        .join("\n");
      return `<section class="note-block" id="${id}" data-dna-component="note-prose"><h2 class="note-title"${titleSrc} data-allow-number>${escapeHtml(b.title)}</h2>${paras}</section>`;
    })
    .join("\n");
}

/**
 * Merge prose note anchors with table sections: if a #note-N table already
 * exists, drop the prose duplicate; otherwise keep prose so links resolve.
 */
function mergeNotesPage(html: string, proseHtml: string): string {
  if (!proseHtml) return html;
  const existing = new Set(
    [...html.matchAll(/\sid="(note-\d+)"/g)].map((m) => m[1]!),
  );
  const keep = proseHtml.replace(
    /<section class="note-block" id="(note-\d+)"[\s\S]*?<\/section>/g,
    (full, id: string) => (existing.has(id) ? "" : full),
  );
  // Insert prose notes after the page hero / before first table section.
  if (/<\/header>/i.test(html) && /page-hero/.test(html)) {
    return html.replace(/<\/header>/i, (m) => `${m}${keep}`);
  }
  return html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${keep}`);
}

export function enrichMultiPageFiles(
  files: Record<string, string>,
  plan: SitePlan,
  docModel: FinancialDocModel,
): Record<string, string> {
  const out = { ...files };
  const company = docModel.meta.company;
  const periodLabel = docModel.meta.period_label;

  if (out["index.html"]) {
    let html = replaceHomeHero(out["index.html"], homeHero(docModel));
    const body = `${highlightsHtml(docModel)}${exploreCards(plan)}`;
    html = injectInto(html, "home-body", body);
    out["index.html"] = html;
  }

  if (out["commentary.html"]) {
    const prose = wrapLooseListItems(
      sectionBlocksHtml(docModel.sections, ["letter", "reviewOfOperations", "dividendDeclaration"]),
    );
    const content =
      pageHero({
        path: "commentary.html",
        title: "Commentary",
        company,
        periodLabel,
        eyebrow: "Shareholder letter & operations",
      }) +
      (prose || `<p class="prose-p">Commentary will appear when the extraction includes a shareholder letter.</p>`);
    out["commentary.html"] = injectInto(out["commentary.html"], "prose-body", content);
  }

  if (out["administration.html"]) {
    const prose = wrapLooseListItems(
      sectionBlocksHtml(docModel.sections, [
        "shareholderInfo",
        "issuedCapital",
        "marketCap",
        "directors",
        "contacts",
        "forwardLooking",
      ]),
    );
    const content =
      pageHero({
        path: "administration.html",
        title: "Administration",
        company,
        periodLabel,
        eyebrow: "Corporate information",
      }) +
      (prose || `<p class="prose-p">Administration details from the results announcement.</p>`);
    out["administration.html"] = injectInto(out["administration.html"], "prose-body", content);
  }

  if (out["downloads.html"]) {
    out["downloads.html"] = injectInto(
      out["downloads.html"],
      "prose-body",
      pageHero({
        path: "downloads.html",
        title: "Downloads",
        company,
        periodLabel,
        eyebrow: "Source documents",
      }) + downloadsHtml(docModel),
    );
  }

  if (out["financials/notes.html"]) {
    let html = out["financials/notes.html"];
    // Strip any prior title banner before injecting hero.
    html = html.replace(/<header class="page-title-banner"[\s\S]*?<\/header>/i, "");
    html = html.replace(/<header class="page-hero"[\s\S]*?<\/header>/i, "");
    const hero = pageHero({
      path: "financials/notes.html",
      title: "Notes to the financial statements",
      company,
      periodLabel,
      eyebrow: "Condensed Consolidated — Unaudited",
    });
    html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
    html = anchorNotes(html, docModel);
    html = mergeNotesPage(html, notesProseBlocks(docModel));
    out["financials/notes.html"] = html;
  }

  // Statement page heroes (eyebrow, H1, period)
  for (const page of plan.pages) {
    if (!page.path.startsWith("financials/") || page.path.endsWith("notes.html")) continue;
    let html = out[page.path];
    if (!html) continue;
    html = html.replace(/<header class="page-title-banner"[\s\S]*?<\/header>/i, "");
    html = html.replace(/<header class="page-hero"[\s\S]*?<\/header>/i, "");
    const hero = pageHero({
      path: page.path,
      title: page.title,
      company,
      periodLabel,
    });
    out[page.path] = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
  }

  return out;
}
