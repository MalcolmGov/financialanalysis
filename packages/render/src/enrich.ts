import type { ExtractionResult, FinancialDocModel, SitePlan } from "@rs/contracts";
import { renderBreadcrumb } from "./chrome.js";
import { composeCommentaryBody } from "./commentary-composer.js";
import {
  assetHrefFromPage,
  SOURCE_PDF_HREF,
  statementExcelSlugForPage,
  WORKBOOK_HREF,
  type ExcelExportResult,
} from "./excel-exporter.js";
import { composeHome } from "./home-composer.js";
import { noteAnchorId, noteNumberFromTitle } from "./notes-linker.js";
import type { BrandAssetUris } from "./resolve.js";

/** Optional binary download wiring (Excel always; PDF when bundled). */
export interface DownloadEnrichOptions {
  excel?: Pick<ExcelExportResult, "workbookHref" | "statementFiles" | "workbookSheetNames">;
  /** When true, downloads.html links to assets/source.pdf. */
  pdfBundled?: boolean;
  pdfHref?: string;
}

/** Optional brand / extraction context for home enrichment. */
export interface EnrichContext {
  brandAssets?: BrandAssetUris;
  extraction?: ExtractionResult | null;
  /** IR chrome/layout preset (classic | editorial). */
  themeId?: "classic" | "editorial";
}

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

function downloadsHtml(
  docModel: FinancialDocModel,
  opts: DownloadEnrichOptions = {},
): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  const pdfHref = opts.pdfHref ?? SOURCE_PDF_HREF;
  const workbookHref = opts.excel?.workbookHref ?? WORKBOOK_HREF;
  const sheetNote = opts.excel?.workbookSheetNames?.length
    ? `<span class="dl-note" data-allow-number>${opts.excel.workbookSheetNames.length} sheets — income, financial position, equity, cash flows, and notes when present. Values match the HTML tables.</span>`
    : `<span class="dl-note">Multi-sheet workbook built from the statement tables. Values match the HTML tables.</span>`;

  const pdfItem = opts.pdfBundled
    ? `<li><a class="dl-link" href="${escapeHtml(pdfHref)}"><span class="dl-label">Full results PDF</span><span class="dl-note">Source interim results booklet bundled under assets/ for offline use.</span></a></li>`
    : `<li><span class="dl-label">Full results PDF</span><span class="dl-note">Source PDF was not available at export time (offline JSON fixtures omit binary uploads). Re-export from the portal after upload to bundle assets/source.pdf.</span></li>`;

  const statementItems = (opts.excel?.statementFiles ?? [])
    .map(
      (f) =>
        `<li><a class="dl-link" href="${escapeHtml(f.href)}"><span class="dl-label">${escapeHtml(f.label)} (Excel)</span><span class="dl-note">Single-sheet workbook for this statement.</span></a></li>`,
    )
    .join("\n");

  return `<section class="downloads" data-dna-component="downloads">
<h2 class="prose-h">Downloads</h2>
<p class="prose-p">Source PDF and spreadsheet exports for <span data-allow-number>${company}</span>.</p>
<ul class="download-list">
${pdfItem}
<li><a class="dl-link" href="${escapeHtml(workbookHref)}"><span class="dl-label">Financial statements (Excel)</span>${sheetNote}</a></li>
${statementItems}
</ul>
</section>`;
}

function xlsToolbarHtml(pagePath: string, excel?: DownloadEnrichOptions["excel"]): string {
  const slug = statementExcelSlugForPage(pagePath);
  if (!slug || !excel) return "";
  const file = excel.statementFiles.find((f) => f.slug === slug);
  const href = file
    ? assetHrefFromPage(pagePath, file.href)
    : assetHrefFromPage(pagePath, `assets/excel/${slug}.xlsx`);
  const workbook = assetHrefFromPage(pagePath, excel.workbookHref);
  return `<div class="xls-toolbar" data-dna-component="xls-toolbar"><span class="xls-toolbar__label">Excel</span><a class="xls-download" href="${escapeHtml(href)}">Download this statement</a><a class="xls-download xls-download--secondary" href="${escapeHtml(workbook)}">Full workbook</a></div>`;
}

/**
 * Replace the inner HTML of the first element whose class list includes
 * `markerClass`. Uses tag-depth matching so nested <section>/<div> (e.g. ops
 * tables already rendered into .prose-body) are not truncated at the first
 * closing tag.
 */
function injectInto(html: string, markerClass: string, content: string): string {
  const openRe = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\bclass="[^"]*\\b${markerClass}\\b[^"]*"[^>]*)>`,
    "i",
  );
  const m = openRe.exec(html);
  if (m) {
    const tag = m[1]!;
    const openEnd = m.index + m[0].length;
    const openTagRe = new RegExp(`<${tag}\\b`, "gi");
    const closeTagRe = new RegExp(`</${tag}\\s*>`, "gi");
    let depth = 1;
    let i = openEnd;
    while (i < html.length && depth > 0) {
      openTagRe.lastIndex = i;
      closeTagRe.lastIndex = i;
      const nextOpen = openTagRe.exec(html);
      const nextClose = closeTagRe.exec(html);
      if (!nextClose) break;
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        i = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        if (depth === 0) {
          return `${html.slice(0, openEnd)}${content}${html.slice(nextClose.index)}`;
        }
        i = nextClose.index + nextClose[0].length;
      }
    }
  }
  // Fallback: insert before closing </main>
  if (/<\/main>/i.test(html)) {
    return html.replace(/<\/main>/i, () => `${content}</main>`);
  }
  return html;
}

function replaceHomeHero(html: string, hero: string): string {
  if (/class="[^"]*\bhome-hero\b/.test(html)) {
    return html.replace(
      /<header class="[^"]*\bhome-hero\b[^"]*"[\s\S]*?<\/header>/i,
      () => hero,
    );
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
  return `<header class="page-hero" data-dna-component="page-hero"><div class="page-hero__rail" aria-hidden="true"></div><div class="page-hero__inner">${crumb}<p class="page-hero__eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(opts.title)}</h1>${sub}</div></header>`;
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
  downloadOpts: DownloadEnrichOptions = {},
  enrichCtx: EnrichContext = {},
): Record<string, string> {
  const out = { ...files };
  const company = docModel.meta.company;
  const periodLabel = docModel.meta.period_label;

  if (out["index.html"]) {
    const home = composeHome(plan, docModel, {
      brandAssets: enrichCtx.brandAssets,
      extraction: enrichCtx.extraction,
      themeId: enrichCtx.themeId,
    });
    let html = replaceHomeHero(out["index.html"], home.heroHtml);
    html = injectInto(html, "home-body", home.bodyHtml);
    out["index.html"] = html;
  }

  if (out["commentary.html"]) {
    // SitePlan places ops/facts tables in the commentary region; extract them
    // before prose inject (which replaces .prose-body) and remount under
    // Review of operations so Gate A coverage + editorial hierarchy both hold.
    const opsTablesHtml = [
      ...out["commentary.html"].matchAll(
        /<section[^>]*data-dna-component="statement-table"[^>]*>[\s\S]*?<\/section>/gi,
      ),
    ].map((m) => m[0]);
    const compactAfsBands = Boolean(
      out["directors-report.html"] || out["financials/accounting-policies.html"],
    );
    const prose = composeCommentaryBody(docModel, { opsTablesHtml, compactAfsBands });
    const hasLetter = docModel.sections.some((s) => s.kind === "letter");
    const hasDirectors = docModel.sections.some((s) => s.kind === "directorsReport");
    const eyebrow = hasLetter
      ? "Shareholder letter & operations"
      : hasDirectors
        ? "Directors' report & narrative"
        : "Narrative from the source report";
    const hero = pageHero({
      path: "commentary.html",
      title: "Commentary",
      company,
      periodLabel,
      eyebrow,
    });
    // Hero sits outside .prose-body so the band can full-bleed; body keeps the rail.
    let html = out["commentary.html"].replace(
      /<header class="page-hero"[\s\S]*?<\/header>/i,
      "",
    );
    html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
    out["commentary.html"] = injectInto(html, "prose-body", prose);
  }

  if (out["directors-report.html"]) {
    const prose = wrapLooseListItems(
      sectionBlocksHtml(docModel.sections, ["directorsReport"]),
    );
    const hero = pageHero({
      path: "directors-report.html",
      title: "Directors' report",
      company,
      periodLabel,
      eyebrow: "Annual financial statements",
    });
    const body =
      prose ||
      `<p class="prose-p">Directors' report prose was not present in the source extraction.</p>`;
    let html = out["directors-report.html"].replace(
      /<header class="page-hero"[\s\S]*?<\/header>/i,
      "",
    );
    html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
    out["directors-report.html"] = injectInto(html, "prose-body", body);
  }

  if (out["financials/accounting-policies.html"]) {
    const prose = wrapLooseListItems(
      sectionBlocksHtml(docModel.sections, ["accountingPolicies"]),
    );
    const hero = pageHero({
      path: "financials/accounting-policies.html",
      title: "Accounting policies",
      company,
      periodLabel,
      eyebrow: "Notes to the financial statements",
    });
    const body =
      prose ||
      `<p class="prose-p">Accounting policies prose was not present in the source extraction.</p>`;
    let html = out["financials/accounting-policies.html"].replace(
      /<header class="page-hero"[\s\S]*?<\/header>/i,
      "",
    );
    html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
    out["financials/accounting-policies.html"] = injectInto(html, "prose-body", body);
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
    const hero = pageHero({
      path: "administration.html",
      title: "Administration",
      company,
      periodLabel,
      eyebrow: "Corporate information",
    });
    const body =
      prose || `<p class="prose-p">Administration details from the results announcement.</p>`;
    let html = out["administration.html"].replace(
      /<header class="page-hero"[\s\S]*?<\/header>/i,
      "",
    );
    html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
    out["administration.html"] = injectInto(html, "prose-body", body);
  }

  if (out["downloads.html"]) {
    const hero = pageHero({
      path: "downloads.html",
      title: "Downloads",
      company,
      periodLabel,
      eyebrow: "Source documents",
    });
    let html = out["downloads.html"].replace(
      /<header class="page-hero"[\s\S]*?<\/header>/i,
      "",
    );
    html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
    out["downloads.html"] = injectInto(html, "prose-body", downloadsHtml(docModel, downloadOpts));
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

  // Legacy aggregate → secondary "All tables" surface (kept for tools/compat).
  if (out["statements/index.html"]) {
    let html = out["statements/index.html"];
    html = html.replace(/<header class="page-title-banner"[\s\S]*?<\/header>/i, "");
    html = html.replace(/<header class="page-hero"[\s\S]*?<\/header>/i, "");
    html = html.replace(
      /<nav class="breadcrumb"[\s\S]*?<\/nav>/i,
      "",
    );
    if (/<meta\s+name=["']robots["'][^>]*>/i.test(html)) {
      html = html.replace(
        /<meta\s+name=["']robots["'][^>]*>/i,
        `<meta name="robots" content="noindex,follow">`,
      );
    } else {
      html = html.replace(
        /<head([^>]*)>/i,
        `<head$1><meta name="robots" content="noindex,follow">`,
      );
    }
    const hero = pageHero({
      path: "statements/index.html",
      title: "All tables",
      company,
      periodLabel,
      eyebrow: "Secondary · aggregate view",
    });
    const finPages = plan.pages.filter(
      (p) => p.path.startsWith("financials/") && p.path.endsWith(".html"),
    );
    const jumpLinks = finPages
      .map((p) => {
        const href = `../${p.path}`;
        return `<a href="${escapeHtml(href)}">${escapeHtml(p.title)}</a>`;
      })
      .join("");
    const jump = `<nav class="statements-aggregate__jump" data-dna-component="statements-aggregate" aria-label="Primary statement pages"><p class="statements-aggregate__label">Prefer individual statements</p>${jumpLinks}<p class="statements-aggregate__note">This page concatenates every table for tooling and offline checks. Use the Financials menu for the designed IR pages.</p></nav>`;
    html = html.replace(
      /(<main[^>]*>)/i,
      (_m, open: string) => `${open}${hero}${jump}`,
    );
    // Demote shell class so it is not mistaken for a designed statement page.
    html = html.replace(
      /class="([^"]*\bpage-statement\b[^"]*)"/i,
      (_m, cls: string) =>
        `class="${cls.replace(/\bpage-statement\b/, "page-statement page-statement--aggregate")}"`,
    );
    out["statements/index.html"] = html;
  }

  // Statement page heroes (eyebrow, H1, period) + Excel toolbar
  for (const page of plan.pages) {
    if (!page.path.startsWith("financials/")) continue;
    let html = out[page.path];
    if (!html) continue;
    // Prose-only AFS pages under financials/ already have heroes above.
    if (page.path.endsWith("accounting-policies.html")) continue;
    if (page.path.endsWith("notes.html")) {
      // Notes hero already injected above; add toolbar after hero when excel present.
      if (
        downloadOpts.excel &&
        /page-hero/.test(html) &&
        !/data-dna-component="xls-toolbar"/.test(html)
      ) {
        const bar = xlsToolbarHtml(page.path, downloadOpts.excel);
        html = html.replace(/<\/header>/i, (m) => `${m}${bar}`);
        out[page.path] = html;
      }
      continue;
    }
    html = html.replace(/<header class="page-title-banner"[\s\S]*?<\/header>/i, "");
    html = html.replace(/<header class="page-hero"[\s\S]*?<\/header>/i, "");
    const hero = pageHero({
      path: page.path,
      title: page.title,
      company,
      periodLabel,
    });
    const bar = xlsToolbarHtml(page.path, downloadOpts.excel);
    out[page.path] = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}${bar}`);
  }

  return out;
}

/**
 * Re-apply downloads page + statement Excel toolbars after binaries are known
 * (PDF bundled flag / excel manifest). Safe to call on already-enriched HTML.
 */
export function applyDownloadArtifacts(
  files: Record<string, string>,
  plan: SitePlan,
  docModel: FinancialDocModel,
  downloadOpts: DownloadEnrichOptions,
): Record<string, string> {
  const out = { ...files };
  if (out["downloads.html"]) {
    // Replace downloads section body if present; else inject via enrich path.
    if (/data-dna-component="downloads"/.test(out["downloads.html"])) {
      out["downloads.html"] = out["downloads.html"].replace(
        /<section class="downloads"[\s\S]*?<\/section>/i,
        () => downloadsHtml(docModel, downloadOpts),
      );
    } else {
      const hero = pageHero({
        path: "downloads.html",
        title: "Downloads",
        company: docModel.meta.company,
        periodLabel: docModel.meta.period_label,
        eyebrow: "Source documents",
      });
      let html = out["downloads.html"].replace(
        /<header class="page-hero"[\s\S]*?<\/header>/i,
        "",
      );
      if (!/page-hero/.test(html)) {
        html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${hero}`);
      }
      out["downloads.html"] = injectInto(
        html,
        "prose-body",
        downloadsHtml(docModel, downloadOpts),
      );
    }
  }

  for (const page of plan.pages) {
    if (!page.path.startsWith("financials/")) continue;
    let html = out[page.path];
    if (!html || !downloadOpts.excel) continue;
    const bar = xlsToolbarHtml(page.path, downloadOpts.excel);
    if (!bar) continue;
    // Match the element (not CHROME_CSS rules that also contain "xls-toolbar").
    if (/data-dna-component="xls-toolbar"/.test(html)) {
      html = html.replace(
        /<div class="xls-toolbar"[^>]*data-dna-component="xls-toolbar"[\s\S]*?<\/div>/i,
        () => bar,
      );
    } else if (/<\/header>/i.test(html) && /page-hero/.test(html)) {
      html = html.replace(/<\/header>/i, (m) => `${m}${bar}`);
    }
    out[page.path] = html;
  }
  return out;
}
