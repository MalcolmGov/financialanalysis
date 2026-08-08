/**
 * HomeComposer — one-composition IR home: brand, results headline, lede,
 * listing chips, KPI stage. KPI figures are verbatim DocModel highlights
 * (via home-kpis). No invented marketing copy.
 */

import type { ExtractionResult, FinancialDocModel, SitePlan } from "@rs/contracts";
import { BANNER_IMG_ONERROR, BRAND_IMG_ONERROR } from "./chrome.js";
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

/** Truncate source prose at a sentence boundary — never invents words. */
function truncateAtSentence(text: string, max = 220): string {
  const t = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const stop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf("? "));
  if (stop >= Math.floor(max * 0.45)) return slice.slice(0, stop + 1).trim();
  const sp = slice.lastIndexOf(" ");
  return (sp > 40 ? slice.slice(0, sp) : slice).trim();
}

/**
 * Supporting lede — DocModel only: letter lead, else dividend/highlight phrase.
 * Returns empty string when no source prose is available (no invented filler).
 */
/**
 * Emit a home lede from source text. Full-block copy may keep data-src;
 * truncated / substring copy uses data-allow-number (Gate B verbatim rule).
 */
function ledeParagraph(text: string, srcRef?: string, fullBlock = false): string {
  const body = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const attr =
    fullBlock && srcRef
      ? ` data-src="${escapeHtml(srcRef)}"`
      : /\d/.test(body)
        ? " data-allow-number"
        : "";
  return `<p class="home-lede"${attr}>${escapeHtml(body)}</p>`;
}

export function supportingLede(docModel: FinancialDocModel): string {
  const letter = docModel.sections.find((s) => s.kind === "letter");
  if (letter) {
    for (const b of letter.blocks) {
      if (b.kind === "table" || b.kind === "heading" || b.kind === "list") continue;
      const text = b.text?.trim();
      if (!text || /^dear shareholder/i.test(text)) continue;
      const clipped = truncateAtSentence(text, 240);
      if (!clipped) continue;
      const full = clipped === text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      return ledeParagraph(clipped, b.src_ref, full);
    }
  }

  const { text: hiText } = highlightsPlain(docModel);
  if (hiText) {
    const divMatch = hiText.match(/Interim cash dividend of\s+[\d\s\u00a0]+\.?\d*\s*SA\s*cps/i)?.[0];
    if (divMatch) {
      return ledeParagraph(divMatch, undefined, false);
    }
  }

  const divSec = docModel.sections.find((s) => s.kind === "dividendDeclaration");
  if (divSec) {
    for (const b of divSec.blocks) {
      if (b.kind === "table" || b.kind === "heading") continue;
      const text = b.text?.trim();
      if (!text) continue;
      const clipped = truncateAtSentence(text, 200);
      const full = clipped === text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      return ledeParagraph(clipped, b.src_ref, full);
    }
  }

  return "";
}

function kpiStage(kpis: HomeKpiCard[]): string {
  const grid = renderKpiCardsHtml(kpis);
  if (!grid) return "";
  return `<div class="home-hero__stage" data-dna-component="home-kpi-stage">
<section class="kpi-band" data-dna-component="kpi-band" aria-label="Key figures">
<div class="section-hdr"><h2 class="section-hdr__title">Financial highlights</h2><p class="section-hdr__sub">Key figures from the results announcement</p></div>
${grid}
</section>
</div>`;
}

/** Verbatim cover period phrases (e.g. "six months ended 31 December 2025"). */
function coverPeriodPhrase(
  docModel: FinancialDocModel,
  extraction?: ExtractionResult | null,
): string {
  const re =
    /(?:for the\s+)?(?:six months|year)\s+ended\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}/i;
  const sources: string[] = [];
  for (const sec of docModel.sections) {
    for (const b of sec.blocks) {
      if (b.text?.trim()) sources.push(b.text);
    }
  }
  if (extraction) {
    const collect = (nodes: ExtractionResult["body"] | undefined) => {
      for (const n of nodes ?? []) {
        if (n.text?.trim()) sources.push(n.text);
        if (n.children?.length) collect(n.children);
      }
    };
    collect(extraction.body);
    collect(extraction.furniture);
  }
  let best = "";
  for (const raw of sources) {
    const m = raw.replace(/\u00a0/g, " ").match(re)?.[0];
    if (!m) continue;
    const phrase = m.replace(/\s+/g, " ").trim();
    if (phrase.length > best.length) best = phrase;
  }
  return best;
}

/**
 * Best period label for SEO / chrome / delivery meta.
 * Prefers rich cover phrases over thin project labels like "FY2025".
 * When meta is a short HY/FY token, combine with the cover end-date phrase.
 */
export function resolveDisplayPeriodLabel(
  docModel: FinancialDocModel,
  extraction?: ExtractionResult | null,
): string {
  const metaPeriod = docModel.meta.period_label?.trim() || "";
  const cover = coverPeriodPhrase(docModel, extraction);
  const thinMeta =
    !metaPeriod ||
    metaPeriod.length < 24 ||
    /^FY\d{4}$/i.test(metaPeriod) ||
    /^HY\d\s+FY\d{4}$/i.test(metaPeriod);
  if (cover && thinMeta) {
    if (metaPeriod && /^HY\d\s+FY\d{4}$/i.test(metaPeriod)) {
      const bare = cover.replace(/^for the\s+/i, "");
      return `${metaPeriod} — ${bare}`;
    }
    return cover;
  }
  return metaPeriod || cover || "";
}

/** Prefer rich cover period over thin project labels like "FY2025". */
export function resultsHeadline(
  docModel: FinancialDocModel,
  extraction?: ExtractionResult | null,
): string {
  const metaPeriod = docModel.meta.period_label?.trim() || "";
  const cover = coverPeriodPhrase(docModel, extraction);
  const thinMeta =
    !metaPeriod ||
    metaPeriod.length < 24 ||
    /^FY\d{4}$/i.test(metaPeriod) ||
    /^HY\d\s+FY\d{4}$/i.test(metaPeriod);
  // H1 keeps cover-only for thin labels (editorial); SEO uses resolveDisplayPeriodLabel.
  if (cover && thinMeta) return cover;
  if (metaPeriod) return metaPeriod;
  if (cover) return cover;
  return docKindLabel(docModel.meta.doc_kind);
}

function homeHero(
  docModel: FinancialDocModel,
  kpis: HomeKpiCard[],
  opts: HomeComposeOptions = {},
): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  const kind = escapeHtml(docKindLabel(docModel.meta.doc_kind));
  const meta = listingMeta(docModel, opts.extraction);
  const lede = supportingLede(docModel);
  const banner = opts.brandAssets?.banner;
  const logo = opts.brandAssets?.logo;
  const logoKind = opts.brandAssets?.logoKind ?? (logo?.endsWith(".svg") ? "svg" : "raster");
  const bannerKind = opts.brandAssets?.bannerKind ?? (banner ? "photo" : undefined);
  const modeClass = banner
    ? ` home-hero--photo home-hero--${bannerKind ?? "photo"}`
    : " home-hero--atmosphere";
  const photo = banner
    ? `<img class="home-hero__photo" src="${escapeHtml(banner)}" alt="" decoding="async" fetchpriority="high" data-banner-kind="${escapeHtml(bannerKind ?? "photo")}" data-banner-img onerror="${BANNER_IMG_ONERROR}">`
    : "";
  // DNA-token designed plane when banner missing; subtle underlay when photo exists.
  const atmosphere = `<div class="home-hero__atmosphere" aria-hidden="true"><div class="home-hero__mesh"></div><div class="home-hero__beam"></div><div class="home-hero__orb home-hero__orb--a"></div><div class="home-hero__orb home-hero__orb--b"></div><div class="home-hero__grain"></div></div>`;
  const lockup = logo
    ? `<div class="home-hero__lockup"><img class="home-hero__logo home-hero__logo--${logoKind}" src="${escapeHtml(logo)}" alt="" width="240" height="56" decoding="async" fetchpriority="high" data-brand-img onerror="${BRAND_IMG_ONERROR}"></div>`
    : "";
  // Results headline from period / cover phrase; brand is company wordmark.
  const headline = resultsHeadline(docModel, opts.extraction);
  const headlineAttr = /\d/.test(headline) ? " data-allow-number" : "";

  return `<header class="home-hero home-hero--composition${modeClass}" data-dna-component="home-hero">
${atmosphere}${photo}<div class="home-hero__mast"></div>
<div class="home-hero__inner">
<div class="home-hero__brand">
${lockup}<p class="home-hero__company" data-allow-number>${company}</p>
</div>
<p class="home-kicker">${kind}</p>
<h1${headlineAttr}>${escapeHtml(headline)}</h1>
<span class="home-hero__rule" aria-hidden="true"></span>
${lede}
${meta}
<p class="home-cta"><a class="home-cta__primary" href="commentary.html">Read commentary</a><a class="home-cta__secondary" href="financials/income-statement.html">View financials</a><a class="home-cta__secondary" href="downloads.html">Downloads</a></p>
</div>
${kpiStage(kpis)}
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
  return {
    heroHtml: homeHero(docModel, kpis, opts),
    bodyHtml: `${highlightsBand(docModel)}${exploreCards(plan)}`,
    kpis,
  };
}
