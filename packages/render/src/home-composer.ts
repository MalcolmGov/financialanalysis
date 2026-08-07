/**
 * HomeComposer — editorial IR home: hero, KPI band, highlights, Explore grid.
 * KPI figures are verbatim substrings of DocModel highlights (via home-kpis).
 */

import type { FinancialDocModel, SitePlan } from "@rs/contracts";
import { renderKpiCardsHtml, segmentHighlightKpis, type HomeKpiCard } from "./home-kpis.js";

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

function homeHero(docModel: FinancialDocModel): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  const period = escapeHtml(docModel.meta.period_label || "");
  const kind =
    docModel.meta.doc_kind === "annual_audited"
      ? "Annual results"
      : "Interim results";
  return `<header class="home-hero" data-dna-component="home-hero">
<div class="home-hero__inner">
<p class="home-kicker">${escapeHtml(kind)}</p>
<h1>${company}</h1>
${period ? `<p class="home-period" data-allow-number>${period}</p>` : ""}
<p class="home-lede">Interactive investor results centre — key figures, commentary, and condensed consolidated statements.</p>
<p class="home-cta"><a class="home-cta__primary" href="commentary.html">Read commentary</a><a class="home-cta__secondary" href="financials/income-statement.html">View financials</a></p>
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
<div class="section-hdr"><h2 class="section-hdr__title">Key figures</h2><p class="section-hdr__sub">Highlights at a glance</p></div>
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
