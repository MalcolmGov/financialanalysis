/**
 * HomeComposer — editorial IR home: hero, KPI band, highlights, Explore grid.
 * KPI figures are verbatim substrings of DocModel highlights (via home-kpis).
 */

import type { ExtractionResult, FinancialDocModel, SitePlan } from "@rs/contracts";
import type { BrandAssetUris } from "./resolve.js";
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

type ListingHit = { text: string; src?: string };

/** Walk extraction body/furniture for cover listing furniture (ISIN / JSE / NYSE). */
function walkExtractionTexts(
  nodes: ExtractionResult["body"],
  out: ListingHit[],
): void {
  for (const n of nodes) {
    const text = n.text?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (text && /JSE|ISIN|NYSE|A2X|share code|trading symbol/i.test(text)) {
      out.push({ text, src: n.id ? `ext:${n.id}` : undefined });
    }
    if (n.children?.length) walkExtractionTexts(n.children, out);
  }
}

/**
 * Pull listing / ISIN chips — verbatim substrings from DocModel sections
 * and extraction cover blocks (often not mapped into a section).
 */
export function listingMeta(
  docModel: FinancialDocModel,
  extraction?: ExtractionResult | null,
): string {
  const sources: ListingHit[] = [];
  for (const sec of docModel.sections) {
    for (const b of sec.blocks) {
      const text = b.text?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      sources.push({ text, src: b.src_ref });
    }
  }
  if (extraction) {
    walkExtractionTexts(extraction.body ?? [], sources);
    walkExtractionTexts(extraction.furniture ?? [], sources);
  }

  const chips: string[] = [];
  const seen = new Set<string>();
  // Prefer specific IR listing phrases — never invent tickers.
  // data-allow-number (not data-src): chips are substrings of a cover block;
  // Gate B requires data-src textContent === full source verbatim.
  const patterns = [
    /JSE and A2X share code:\s*[A-Z0-9]+/i,
    /JSE\s*(?:&|and)\s*A2X(?:\s*share code)?:\s*[A-Z0-9]+/i,
    /NYSE trading symbol:\s*[A-Z0-9]+/i,
    /NYSE:\s*[A-Z0-9]+/i,
    /ISIN:\s*[A-Z0-9]+/i,
  ];

  for (const { text } of sources) {
    for (const re of patterns) {
      const m = text.match(re)?.[0];
      if (!m) continue;
      const key = m.toLowerCase();
      if (seen.has(key)) continue;
      // Skip shorter duplicates already covered (e.g. NYSE: DRD vs trading symbol).
      let covered = false;
      for (const s of seen) {
        if (s.includes(key) || key.includes(s)) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
      seen.add(key);
      chips.push(
        `<span class="home-meta__chip" data-allow-number>${escapeHtml(m)}</span>`,
      );
    }
  }
  if (!chips.length) return "";
  return `<div class="home-meta" data-dna-component="home-meta">${chips.join("")}</div>`;
}

export interface HomeComposeOptions {
  brandAssets?: BrandAssetUris;
  extraction?: ExtractionResult | null;
}

function homeHero(docModel: FinancialDocModel, opts: HomeComposeOptions = {}): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  const period = docModel.meta.period_label?.trim() || "";
  const kind = escapeHtml(docKindLabel(docModel.meta.doc_kind));
  const periodHtml = period
    ? `<p class="home-period" data-allow-number>${escapeHtml(period)}</p>`
    : "";
  const meta = listingMeta(docModel, opts.extraction);
  const banner = opts.brandAssets?.banner;
  const logo = opts.brandAssets?.logo;
  const bannerKind = opts.brandAssets?.bannerKind ?? (banner ? "photo" : undefined);
  const photoClass = banner
    ? ` home-hero--photo home-hero--${bannerKind ?? "photo"}`
    : "";
  const photo = banner
    ? `<img class="home-hero__photo" src="${escapeHtml(banner)}" alt="" decoding="async" data-banner-kind="${escapeHtml(bannerKind ?? "photo")}">`
    : "";
  const lockup = logo
    ? `<div class="home-hero__lockup"><img class="home-hero__logo" src="${escapeHtml(logo)}" alt="" width="220" height="52" decoding="async"></div>`
    : "";
  return `<header class="home-hero${photoClass}" data-dna-component="home-hero">
${photo}<div class="home-hero__mast"></div>
<div class="home-hero__inner">
${lockup}<p class="home-kicker">${kind}</p>
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

export function composeHome(
  plan: SitePlan,
  docModel: FinancialDocModel,
  opts: HomeComposeOptions = {},
): HomeComposition {
  const kpis = extractHomeKpis(docModel);
  const bodyHtml = `${kpiBand(kpis)}${highlightsBand(docModel)}${exploreCards(plan)}`;
  return {
    heroHtml: homeHero(docModel, opts),
    bodyHtml,
    kpis,
  };
}
