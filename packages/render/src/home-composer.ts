/**
 * HomeComposer — editorial IR home: hero, KPI band, highlights, Explore grid.
 * KPI figures are verbatim substrings of DocModel highlights (via home-kpis).
 */

import type { FinancialDocModel, SitePlan } from "@rs/contracts";
import { renderKpiCardsHtml, segmentHighlightKpis, type HomeKpiCard } from "./home-kpis.js";
import { docKindLabel } from "./seo.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Safe explore blurbs — no financial figures (Gate B / invent-nothing). */
const EXPLORE_DESC: Record<string, string> = {
  "commentary.html":
    "Shareholder letter, review of operations, and dividend declaration from the results announcement.",
  "financials/income-statement.html":
    "Condensed consolidated statement of profit or loss and other comprehensive income.",
  "financials/balance-sheet.html":
    "Condensed consolidated statement of financial position with comparative periods.",
  "financials/changes-in-equity.html":
    "Movements in equity for the reporting period.",
  "financials/cash-flows.html":
    "Condensed consolidated statement of cash flows.",
  "financials/notes.html":
    "Notes to the condensed consolidated financial statements.",
  "administration.html": "Corporate, shareholder, and contact information.",
  "downloads.html": "Source PDF and spreadsheet exports for offline analysis.",
};

const EXPLORE_CTA: Record<string, string> = {
  "commentary.html": "Read commentary",
  "downloads.html": "View downloads",
  "administration.html": "View administration",
};

function exploreCta(href: string, label: string): string {
  if (EXPLORE_CTA[href]) return EXPLORE_CTA[href]!;
  if (href.startsWith("financials/")) return `View ${label.toLowerCase()}`;
  return `Open ${label.toLowerCase()}`;
}

export function highlightsPlain(docModel: FinancialDocModel): { text: string; src?: string } {
  const hi = docModel.sections.find((s) => s.kind === "highlights");
  if (!hi) return { text: "" };
  const parts: string[] = [];
  let src: string | undefined;
  for (const b of hi.blocks) {
    if (b.kind === "table" || b.kind === "heading") continue;
    const t = b.text?.trim();
    if (!t) continue;
    parts.push(t);
    if (!src && b.src_ref) src = b.src_ref;
  }
  return { text: parts.join(" "), src };
}

export function extractHomeKpis(docModel: FinancialDocModel): HomeKpiCard[] {
  const { text, src } = highlightsPlain(docModel);
  return segmentHighlightKpis(text, src);
}

/** Pull listing / ISIN chips — verbatim substrings from any section (cover often holds them). */
function listingMeta(docModel: FinancialDocModel): string {
  const chips: string[] = [];
  const seen = new Set<string>();
  for (const sec of docModel.sections) {
    for (const b of sec.blocks) {
      const text = b.text?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const src = b.src_ref ? ` data-src="${escapeHtml(b.src_ref)}"` : "";
      const jse = text.match(/JSE and A2X share code:\s*[A-Z0-9]+/i)?.[0];
      const nyse = text.match(/NYSE trading symbol:\s*[A-Z0-9]+/i)?.[0];
      const isin = text.match(/ISIN:\s*[A-Z0-9]+/i)?.[0];
      for (const p of [jse, nyse, isin].filter(Boolean) as string[]) {
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        chips.push(
          `<span class="home-meta__chip" data-allow-number${src}>${escapeHtml(p)}</span>`,
        );
      }
    }
  }
  if (!chips.length) return "";
  return `<div class="home-meta" data-dna-component="home-meta">${chips.join("")}</div>`;
}

function homeHero(docModel: FinancialDocModel): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  const period = docModel.meta.period_label?.trim() || "";
  const kind = escapeHtml(docKindLabel(docModel.meta.doc_kind));
  const periodHtml = period
    ? `<p class="home-period" data-allow-number>${escapeHtml(period)}</p>`
    : "";
  const meta = listingMeta(docModel);
  return `<header class="home-hero" data-dna-component="home-hero">
<div class="home-hero__mast"></div>
<div class="home-hero__inner">
<p class="home-kicker">${kind}</p>
<h1 data-allow-number>${company}</h1>
${periodHtml}
<p class="home-lede">Investor results centre — key figures, commentary, condensed consolidated statements, notes, and downloads.</p>
${meta}
<p class="home-cta"><a class="home-cta__primary" href="commentary.html">Read commentary</a><a class="home-cta__secondary" href="financials/income-statement.html">View financials</a><a class="home-cta__secondary" href="downloads.html">Downloads</a></p>
</div>
</header>`;
}

/**
 * Compact highlight list — provenance preserved.
 * Chunks from one extraction block share a parent `[data-src]` so Gate B
 * still sees the full verbatim textContent of that block.
 */
function highlightsBand(docModel: FinancialDocModel): string {
  const hi = docModel.sections.find((s) => s.kind === "highlights");
  if (!hi) return "";
  const groups: string[] = [];
  for (const b of hi.blocks) {
    if (b.kind === "table" || b.kind === "heading") continue;
    const text = b.text?.trim();
    if (!text) continue;
    const src = b.src_ref ? ` data-src="${escapeHtml(b.src_ref)}"` : "";
    const chunks = splitHighlightChunks(text);
    const items = chunks
      .map(
        (chunk) =>
          `<li class="highlight-item"><span class="highlight-item__text">${escapeHtml(chunk)}</span></li>`,
      )
      .join("");
    groups.push(`<ul class="highlight-list"${src}>${items}</ul>`);
  }
  if (!groups.length) return "";
  const titleSrc = hi.title?.src_ref ? ` data-src="${escapeHtml(hi.title.src_ref)}"` : "";
  const title = escapeHtml(hi.title?.text || "Highlights");
  return `<section class="highlights-band reveal" aria-label="Highlights" data-dna-component="highlights">
<div class="section-hdr"><h2 class="section-hdr__title"${titleSrc}>${title}</h2><p class="section-hdr__sub">From the results announcement</p></div>
${groups.join("\n")}
</section>`;
}

/**
 * Split a flattened highlights paragraph into readable bullets without
 * inventing text — only split on known IR phrase boundaries present in source.
 */
function splitHighlightChunks(text: string): string[] {
  const markers =
    /(?=(?:Operating profit|Headline earnings|Interim cash dividend|All-in sustaining|Gold production|R[\d\s\u00a0]+\.?\d*\s*million of capital))/gi;
  const parts = text
    .split(markers)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts.length ? parts : [text.replace(/\s+/g, " ").trim()];
}

function exploreCards(plan: SitePlan): string {
  const cards = plan.nav
    .filter((n) => n.href !== "index.html")
    .map((n, i) => {
      const n_ = String(i + 1).padStart(2, "0");
      const desc =
        EXPLORE_DESC[n.href] ?? `${n.label} from the interactive results site.`;
      const cta = exploreCta(n.href, n.label);
      return `<a class="explore-card reveal" href="${escapeHtml(n.href)}">
<span class="explore-n" data-allow-number>${n_}</span>
<span class="explore-card__body">
<span class="explore-label">${escapeHtml(n.label)}</span>
<span class="explore-desc">${escapeHtml(desc)}</span>
<span class="explore-cta">${escapeHtml(cta)} →</span>
</span>
</a>`;
    })
    .join("");
  return `<section class="explore" aria-label="Explore the report" data-dna-component="explore">
<div class="section-hdr"><h2 class="section-hdr__title">Explore the report</h2><p class="section-hdr__sub">Commentary, statements, notes, and downloads</p></div>
<div class="explore-grid">${cards}</div>
</section>`;
}

function kpiBand(kpis: HomeKpiCard[]): string {
  const grid = renderKpiCardsHtml(kpis);
  if (!grid) return "";
  return `<section class="kpi-band" data-dna-component="kpi-band" aria-label="Key figures">
<div class="section-hdr"><h2 class="section-hdr__title">Financial highlights</h2><p class="section-hdr__sub">Key figures from the results announcement</p></div>
${grid}
</section>`;
}

export interface HomeComposition {
  heroHtml: string;
  bodyHtml: string;
  kpis: HomeKpiCard[];
}

export function composeHome(plan: SitePlan, docModel: FinancialDocModel): HomeComposition {
  const kpis = extractHomeKpis(docModel);
  const bodyHtml = `${kpiBand(kpis)}${highlightsBand(docModel)}${exploreCards(plan)}`;
  return {
    heroHtml: homeHero(docModel),
    bodyHtml,
    kpis,
  };
}
