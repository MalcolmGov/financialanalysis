/**
 * Shared microsite chrome for multi-page SitePlan export:
 * sticky nav (Financials dropdown + mobile toggle), breadcrumb, prev/next,
 * selection mark/share tooltip host, SEO head.
 * Uses DNA CSS variables — no Inter / Google Fonts CDN.
 * Interaction behaviour lives in site-runtime.ts (assets/site.js).
 */

import type { ExtractionResult, FinancialDocModel } from "@rs/contracts";
import { SITE_RUNTIME_JS } from "./site-runtime.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Inline onerror for brand logos — fires even when assets/site.js is blocked
 * (preview CSP / sandbox). Hides the broken img and restores the text mark.
 */
export const BRAND_IMG_ONERROR =
  "this.hidden=true;this.removeAttribute('src');var w=this.closest('.nav-brand__logo-wrap,.home-hero__lockup,.site-footer__lockup');if(w)w.classList.add('is-broken');var b=this.closest('.nav-brand');if(b){b.classList.remove('nav-brand--logo');if(!b.querySelector('.nav-brand__mark')){var m=document.createElement('span');m.className='nav-brand__mark';m.setAttribute('aria-hidden','true');b.insertBefore(m,b.firstChild);}}";

/** Inline onerror for hero banner — drop photo plane, keep atmosphere. */
export const BANNER_IMG_ONERROR =
  "this.hidden=true;this.removeAttribute('src');var h=this.closest('.home-hero');if(h){h.classList.remove('home-hero--photo','home-hero--strip','home-hero--page');h.classList.add('home-hero--atmosphere');}";

export interface NavItem {
  label: string;
  href: string;
  children?: Array<{ label: string; href: string }>;
}

export interface PageChrome {
  path: string;
  title: string;
  company?: string;
  periodLabel?: string;
  description?: string;
  /** Optional precomposed head meta (from SeoComposer). */
  seoHeadHtml?: string;
}

const FINANCIALS_PREFIX = "financials/";

/** Group flat nav into sticky bar with a Financials dropdown when applicable. */
export function groupNav(nav: Array<{ label: string; href: string }>): NavItem[] {
  const financials: Array<{ label: string; href: string }> = [];
  const top: NavItem[] = [];
  for (const item of nav) {
    if (item.href.startsWith(FINANCIALS_PREFIX) || /statement|balance|equity|cash|notes/i.test(item.label)) {
      financials.push(item);
    } else {
      top.push(item);
    }
  }
  if (financials.length) {
    // Insert Financials after Home / Commentary when present
    const insertAt = Math.min(
      2,
      top.findIndex((t) => /admin|download/i.test(t.label)) >= 0
        ? top.findIndex((t) => /admin|download/i.test(t.label))
        : top.length,
    );
    top.splice(insertAt, 0, { label: "Financials", href: financials[0]!.href, children: financials });
  }
  return top;
}

function hrefFrom(fromPath: string, toPath: string): string {
  if (toPath.startsWith("http") || toPath.startsWith("#")) return toPath;
  const fromDir = fromPath.includes("/") ? fromPath.replace(/\/[^/]+$/, "/") : "";
  if (!fromDir) return toPath;
  // Simple relative: count depth
  const depth = fromDir.split("/").filter(Boolean).length;
  const prefix = depth > 0 ? "../".repeat(depth) : "";
  return prefix + toPath;
}

export function renderSeoHead(page: PageChrome, css: string): string {
  if (page.seoHeadHtml) {
    return `${page.seoHeadHtml}\n<style>${css}</style>`;
  }
  const company = page.company?.trim() || "";
  const title = company ? `${escapeHtml(page.title)} · ${escapeHtml(company)}` : escapeHtml(page.title);
  const desc =
    page.description?.trim() ||
    [company, page.periodLabel, page.title].filter(Boolean).join(" — ") ||
    page.title;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta name="robots" content="index,follow">
<style>${css}</style>`;
}

export function renderStickyNav(
  nav: Array<{ label: string; href: string }>,
  currentPath: string,
  company?: string,
  /** Real brand logo URI (data: or relative). Absent → DNA mark fallback. */
  logoHref?: string,
): string {
  const grouped = groupNav(nav);
  const items = grouped
    .map((item) => {
      const active =
        item.href === currentPath ||
        item.children?.some((c) => c.href === currentPath);
      if (item.children?.length) {
        const kids = item.children
          .map((c) => {
            const href = hrefFrom(currentPath, c.href);
            const isCur = c.href === currentPath ? ' aria-current="page"' : "";
            return `<li><a href="${escapeHtml(href)}"${isCur}>${escapeHtml(c.label)}</a></li>`;
          })
          .join("");
        return `<li class="nav-dd${active ? " is-active" : ""}"><button type="button" class="nav-dd-btn" aria-expanded="false" aria-haspopup="true">${escapeHtml(item.label)}</button><ul class="nav-dd-menu" role="list">${kids}</ul></li>`;
      }
      const href = hrefFrom(currentPath, item.href);
      const isCur = item.href === currentPath ? ' aria-current="page"' : "";
      return `<li${active ? ' class="is-active"' : ""}><a href="${escapeHtml(href)}"${isCur}>${escapeHtml(item.label)}</a></li>`;
    })
    .join("");

  const mobileLinks = grouped
    .map((item) => {
      if (item.children?.length) {
        const kids = item.children
          .map((c) => {
            const href = hrefFrom(currentPath, c.href);
            const isCur = c.href === currentPath ? ' aria-current="page"' : "";
            const active = c.href === currentPath ? " is-active" : "";
            return `<a class="nav-mobile__link nav-mobile__sub${active}" href="${escapeHtml(href)}"${isCur}>${escapeHtml(c.label)}</a>`;
          })
          .join("");
        return `<div class="nav-mobile__group"><div class="nav-mobile__heading">${escapeHtml(item.label)}</div>${kids}</div>`;
      }
      const href = hrefFrom(currentPath, item.href);
      const isCur = item.href === currentPath ? ' aria-current="page"' : "";
      const active =
        item.href === currentPath ||
        (item.href === "index.html" && currentPath === "index.html")
          ? " is-active"
          : "";
      return `<a class="nav-mobile__link${active}" href="${escapeHtml(href)}"${isCur}>${escapeHtml(item.label)}</a>`;
    })
    .join("");

  const homeHref = hrefFrom(currentPath, "index.html");
  const brandLabel = (company?.trim() || "Results").toUpperCase();
  const logoKind =
    logoHref && /\.svg($|\?)/i.test(logoHref) ? "svg" : logoHref ? "raster" : "";
  const mark = logoHref
    ? `<span class="nav-brand__logo-wrap"><img class="nav-brand__logo nav-brand__logo--${logoKind}" src="${escapeHtml(logoHref)}" alt="" width="148" height="38" decoding="async" data-brand-img onerror="${BRAND_IMG_ONERROR}"></span>`
    : `<span class="nav-brand__mark" aria-hidden="true"></span>`;
  // Keep text mark visible to assistive tech; CSS hides it while the logo
  // loads. Inline onerror + site.js restore the name if the image fails.
  const brand = `<a class="nav-brand${logoHref ? " nav-brand--logo" : ""}" href="${escapeHtml(homeHref)}" data-allow-number>${mark}<span class="nav-brand__name">${escapeHtml(brandLabel)}</span></a>`;

  return `<nav class="site-nav" data-dna-component="sticky-nav" aria-label="Primary"><div class="nav-inner">${brand}<ul class="nav-row">${items}</ul><button type="button" class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="nav-mobile" aria-label="Open menu"><span></span><span></span><span></span></button></div><div class="nav-mobile" id="nav-mobile">${mobileLinks}</div></nav>`;
}

export function renderBreadcrumb(
  path: string,
  title: string,
  company?: string,
): string {
  if (path === "index.html") return "";
  const homeHref = hrefFrom(path, "index.html");
  // Company names may contain digits (e.g. "3M", test labels) — identity chrome, not figures.
  const crumbs = [
    `<a href="${escapeHtml(homeHref)}" data-allow-number>${escapeHtml(company || "Home")}</a>`,
  ];
  if (path.startsWith(FINANCIALS_PREFIX)) {
    crumbs.push(`<span>Financials</span>`);
  }
  crumbs.push(`<span aria-current="page">${escapeHtml(title)}</span>`);
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${crumbs.join('<span class="bc-sep" aria-hidden="true">/</span>')}</nav>`;
}

export function renderPrevNext(
  pages: Array<{ path: string; title: string }>,
  currentPath: string,
): string {
  const idx = pages.findIndex((p) => p.path === currentPath);
  if (idx < 0 || pages.length < 2) return "";
  const prev = idx > 0 ? pages[idx - 1] : null;
  const next = idx < pages.length - 1 ? pages[idx + 1] : null;
  const parts: string[] = ['<nav class="page-pager" data-dna-component="page-pager" aria-label="Page">'];
  if (prev) {
    parts.push(
      `<a class="pager-prev" href="${escapeHtml(hrefFrom(currentPath, prev.path))}"><span class="pager-lbl">Previous</span><span class="pager-title">${escapeHtml(prev.title)}</span></a>`,
    );
  } else {
    parts.push(`<span class="pager-prev is-empty"></span>`);
  }
  if (next) {
    parts.push(
      `<a class="pager-next" href="${escapeHtml(hrefFrom(currentPath, next.path))}"><span class="pager-lbl">Next</span><span class="pager-title">${escapeHtml(next.title)}</span></a>`,
    );
  } else {
    parts.push(`<span class="pager-next is-empty"></span>`);
  }
  parts.push("</nav>");
  return parts.join("");
}

export interface SiteFooterOptions {
  company?: string;
  periodLabel?: string;
  logoHref?: string;
  /** Flat site nav — split into Results / Financials columns. */
  nav?: Array<{ label: string; href: string }>;
  currentPath?: string;
  /** Verbatim exchange codes, e.g. "JSE: DRD", "NYSE: DRD". */
  listingCodes?: string[];
  /** Host or URL from source (never invented). */
  website?: string;
  /** Phone from contacts/extraction (omit when absent). */
  phone?: string;
  /** Investor Relations link (defaults to administration.html when present in nav). */
  irHref?: string;
  irLabel?: string;
  /** Short company blurb from source text only. */
  blurb?: string;
  /** e.g. "Published 18 February 2026" — verbatim when found. */
  publishedLine?: string;
  /** e.g. "Results for six months ended 31 December 2025". */
  resultsLine?: string;
}

export interface FooterExtras {
  listingCodes: string[];
  website?: string;
  phone?: string;
  blurb?: string;
  publishedLine?: string;
  resultsLine?: string;
}

function walkTextNodes(
  nodes: ExtractionResult["body"] | undefined,
  out: string[],
): void {
  for (const n of nodes ?? []) {
    const t = n.text?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
    if (n.children?.length) walkTextNodes(n.children, out);
  }
}

/** Gather source texts for footer contact / listing / period furniture. */
function footerSourceTexts(
  docModel: FinancialDocModel,
  extraction?: ExtractionResult | null,
): string[] {
  const out: string[] = [];
  for (const sec of docModel.sections) {
    for (const b of sec.blocks) {
      const t = b.text?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  if (extraction) {
    walkTextNodes(extraction.body, out);
    walkTextNodes(extraction.furniture, out);
  }
  return out;
}

/**
 * Pull footer extras from DocModel / extraction — listing codes, contact,
 * published date, blurb. Never invents phone, tickers, or business description.
 */
export function collectFooterExtras(
  docModel: FinancialDocModel,
  extraction?: ExtractionResult | null,
): FooterExtras {
  const sources = footerSourceTexts(docModel, extraction);
  const blob = sources.join("\n");

  const listingCodes: string[] = [];
  const seen = new Set<string>();
  const listingPatterns = [
    /JSE\s*(?:and|&)?\s*A2X\s*share code:\s*([A-Z0-9]+)/i,
    /JSE(?:\s*share code)?:\s*([A-Z0-9]+)/i,
    /NYSE\s*trading symbol:\s*([A-Z0-9]+)/i,
    /NYSE:\s*([A-Z0-9]+)/i,
  ];
  for (const text of sources) {
    for (const re of listingPatterns) {
      const m = text.match(re);
      if (!m?.[1]) continue;
      const exchange = /NYSE/i.test(m[0]) ? "NYSE" : "JSE";
      const code = `${exchange}: ${m[1].toUpperCase()}`;
      const key = code.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      listingCodes.push(code);
    }
  }

  let website: string | undefined;
  const webRe =
    /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.(?:com|co\.za|net|org))\b/gi;
  let wm: RegExpExecArray | null;
  while ((wm = webRe.exec(blob))) {
    const host = (wm[1] || "").toLowerCase();
    if (!host || /^(example|google|microsoft|w3|schema)\./i.test(host)) continue;
    // Prefer issuer-looking domains (contains company token) over generic.
    const companyTok = (docModel.meta.company || "")
      .replace(/\b(limited|ltd\.?|plc|inc\.?)\b/gi, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
    if (companyTok && host.replace(/\./g, "").includes(companyTok.slice(0, 6))) {
      website = host;
      break;
    }
    if (!website) website = host;
  }

  let phone: string | undefined;
  const phonePatterns = [
    /(?:Tel(?:ephone)?|Phone|Call)\s*[:.]?\s*(\+?\d[\d\s()./-]{8,}\d)/i,
    /(\+27\s*(?:\(\s*0\s*\)\s*)?[\d\s()./-]{7,}\d)/,
  ];
  for (const re of phonePatterns) {
    const m = blob.match(re);
    if (m?.[1]) {
      phone = m[1].replace(/\s+/g, " ").trim();
      break;
    }
  }

  let publishedLine: string | undefined;
  const pub = blob.match(/Published\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}/i)?.[0];
  if (pub) publishedLine = pub.replace(/\s+/g, " ").trim();

  let resultsLine: string | undefined;
  const periodRe =
    /(?:Condensed\s+Consolidated\s+(?:Unaudited\s+)?(?:Interim\s+)?Results\s+for\s+the\s+)?(?:six months|year)\s+ended\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}/i;
  let bestPeriod = "";
  for (const text of sources) {
    const m = text.match(periodRe)?.[0];
    if (!m) continue;
    const phrase = m.replace(/\s+/g, " ").trim();
    if (phrase.length > bestPeriod.length) bestPeriod = phrase;
  }
  if (bestPeriod) {
    resultsLine = /^results\b/i.test(bestPeriod)
      ? bestPeriod
      : /^condensed\b/i.test(bestPeriod)
        ? bestPeriod
        : `Results for ${bestPeriod.replace(/^for the\s+/i, "")}`;
  }

  let blurb: string | undefined;
  const blurbRe =
    /([^.!?\n]{12,160}?(?:surface gold|retreatment|listed on the (?:JSE|NYSE)|listed on both the JSE)[^.!?\n]{0,80}[.!?]?)/i;
  const blurbHit = blob.match(blurbRe)?.[1]?.replace(/\s+/g, " ").trim();
  if (blurbHit && blurbHit.length >= 20 && blurbHit.length <= 180) {
    blurb = blurbHit;
  } else if (listingCodes.some((c) => c.startsWith("JSE")) && listingCodes.some((c) => c.startsWith("NYSE"))) {
    blurb = "Listed on the JSE and NYSE.";
  } else if (listingCodes.some((c) => c.startsWith("JSE"))) {
    blurb = "Listed on the JSE.";
  } else if (listingCodes.some((c) => c.startsWith("NYSE"))) {
    blurb = "Listed on the NYSE.";
  }

  return { listingCodes, website, phone, blurb, publishedLine, resultsLine };
}

function footerColLinks(
  items: Array<{ label: string; href: string }>,
  currentPath: string,
): string {
  if (!items.length) return "";
  const lis = items
    .map((item) => {
      const href = hrefFrom(currentPath, item.href);
      const isCur = item.href === currentPath ? ' aria-current="page"' : "";
      return `<li><a href="${escapeHtml(href)}"${isCur}>${escapeHtml(item.label)}</a></li>`;
    })
    .join("");
  return `<ul class="site-footer__links">${lis}</ul>`;
}

function shortBrandHeading(company: string): string {
  const trimmed = company.trim();
  if (!trimmed) return "Company";
  // DRDGOLD Limited → DRDGOLD; keep multi-word brands otherwise.
  const tok = trimmed.match(/^([A-Z][A-Z0-9]{1,24})\b/);
  if (tok?.[1] && tok[1].length >= 3) return tok[1];
  return trimmed.replace(/\b(Limited|Ltd\.?|plc|Inc\.?)\b/gi, "").trim() || trimmed;
}

function copyrightYear(
  publishedLine?: string,
  periodLabel?: string,
  resultsLine?: string,
): string {
  for (const s of [publishedLine, resultsLine, periodLabel]) {
    if (!s) continue;
    const years = [...s.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]!);
    if (years.length) return years[years.length - 1]!;
  }
  return "";
}

/**
 * Site-wide identity footer — multi-column Results / Financials / contact
 * plus copyright bar. Contact phone / website only when found in source.
 */
export function renderSiteFooter(
  companyOrOpts?: string | SiteFooterOptions,
  periodLabelArg?: string,
  logoHrefArg?: string,
): string {
  const opts: SiteFooterOptions =
    typeof companyOrOpts === "object" && companyOrOpts !== null
      ? companyOrOpts
      : {
          company: companyOrOpts,
          periodLabel: periodLabelArg,
          logoHref: logoHrefArg,
        };

  const brand = opts.company?.trim() || "Investor results";
  const period = opts.periodLabel?.trim();
  const logoHref = opts.logoHref;
  const currentPath = opts.currentPath || "index.html";
  const logoKind =
    logoHref && /\.svg($|\?)/i.test(logoHref) ? "svg" : logoHref ? "raster" : "";
  const logo = logoHref
    ? `<div class="site-footer__lockup"><img class="site-footer__logo site-footer__logo--${logoKind}" src="${escapeHtml(logoHref)}" alt="${escapeHtml(brand)}" width="148" height="40" decoding="async" data-brand-img onerror="${BRAND_IMG_ONERROR}"></div>`
    : `<p class="site-footer__brand site-footer__brand--text" data-allow-number>${escapeHtml(brand)}</p>`;

  const nav = opts.nav ?? [];
  const financials = nav.filter(
    (item) =>
      item.href.startsWith(FINANCIALS_PREFIX) ||
      /statement|balance|equity|cash|notes/i.test(item.label),
  );
  const results = nav.filter((item) => !financials.includes(item));

  const blurb =
    opts.blurb?.trim() ||
    (period ? "" : "Condensed consolidated results — interactive microsite");
  const periodLine = opts.resultsLine?.trim() || period || "";

  const brandCol = `<div class="site-footer__col site-footer__col--brand">${logo}${
    blurb
      ? `<p class="site-footer__blurb" data-allow-number>${escapeHtml(blurb)}</p>`
      : ""
  }${
    periodLine
      ? `<p class="site-footer__period" data-allow-number>${escapeHtml(periodLine)}</p>`
      : ""
  }</div>`;

  const resultsCol = results.length
    ? `<div class="site-footer__col"><p class="site-footer__heading">Results</p>${footerColLinks(results, currentPath)}</div>`
    : "";
  const finCol = financials.length
    ? `<div class="site-footer__col"><p class="site-footer__heading">Financials</p>${footerColLinks(financials, currentPath)}</div>`
    : "";

  const companyHeading = shortBrandHeading(brand);
  const companyLinks: string[] = [];
  if (opts.website) {
    const host = opts.website.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    const href = /^https?:\/\//i.test(opts.website)
      ? opts.website
      : `https://${host}`;
    companyLinks.push(
      `<li><a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${escapeHtml(host)}</a></li>`,
    );
  }
  const irHref =
    opts.irHref ||
    (nav.some((n) => n.href === "administration.html")
      ? hrefFrom(currentPath, "administration.html")
      : undefined);
  if (irHref) {
    companyLinks.push(
      `<li><a href="${escapeHtml(irHref)}">${escapeHtml(opts.irLabel || "Investor Relations")}</a></li>`,
    );
  }
  if (opts.phone) {
    const tel = opts.phone.replace(/[^\d+]/g, "");
    companyLinks.push(
      `<li><a href="tel:${escapeHtml(tel)}" data-allow-number>${escapeHtml(opts.phone)}</a></li>`,
    );
  }
  const companyCol = companyLinks.length
    ? `<div class="site-footer__col"><p class="site-footer__heading" data-allow-number>${escapeHtml(companyHeading)}</p><ul class="site-footer__links">${companyLinks.join("")}</ul></div>`
    : "";

  const year = copyrightYear(opts.publishedLine, opts.resultsLine, period);
  const listingBit = (opts.listingCodes ?? []).length
    ? ` ${(opts.listingCodes ?? []).map((c) => escapeHtml(c)).join(" | ")}`
    : "";
  // Entire copy line is identity chrome (year + tickers) — allow-number for Gate B.
  const copyLeft = `<p class="site-footer__copy" data-allow-number>© ${
    year ? `${escapeHtml(year)} ` : ""
  }<span class="site-footer__brand">${escapeHtml(brand)}</span>. All rights reserved.${
    listingBit ? ` ${listingBit}` : ""
  }</p>`;

  const rightBits = [opts.publishedLine, opts.resultsLine || period]
    .filter(Boolean)
    .map((s) => escapeHtml(s!));
  // Prefer "Results for …" over raw HY token on the right when both differ.
  const rightUnique = [...new Set(rightBits)];
  const copyRight = rightUnique.length
    ? `<p class="site-footer__meta" data-allow-number>${rightUnique.join(" | ")}</p>`
    : "";

  return `<footer class="site-footer" data-dna-component="site-footer"><div class="site-footer__accent" aria-hidden="true"></div><div class="site-footer__inner"><div class="site-footer__grid">${brandCol}${resultsCol}${finCol}${companyCol}</div></div><div class="site-footer__bar"><div class="site-footer__bar-inner">${copyLeft}${copyRight}</div></div></footer>`;
}

export function renderShareBar(): string {
  return `<div class="share-bar" data-dna-component="share" role="region" aria-label="Share this page"><span class="share-bar__label">Share</span><div class="share-bar__actions"><button type="button" class="share-bar__btn" data-share="copy" aria-label="Copy page link"><span class="share-bar__ico share-bar__ico--link" aria-hidden="true"></span><span class="share-bar__txt">Copy link</span></button><button type="button" class="share-bar__btn" data-share="linkedin" aria-label="Share on LinkedIn"><span class="share-bar__ico share-bar__ico--li" aria-hidden="true"></span><span class="share-bar__txt">LinkedIn</span></button><button type="button" class="share-bar__btn" data-share="email" aria-label="Share by email"><span class="share-bar__ico share-bar__ico--mail" aria-hidden="true"></span><span class="share-bar__txt">Email</span></button></div></div><div id="share-toast" class="share-toast" role="status" aria-live="polite" hidden></div>`;
}

/** Selection tooltip host for Copy / Highlight / LinkedIn / Email (wired by SiteRuntime). */
export function renderSelectionTooltip(): string {
  return `<div id="share-tooltip" class="share-tip" role="dialog" aria-label="Selection actions" hidden><div class="share-tip__label" id="share-tip-label">Selection</div><div class="share-tip__actions" role="group" aria-labelledby="share-tip-label"><button type="button" class="share-tip-btn" id="sel-share-copy" aria-label="Copy selection">Copy</button><button type="button" class="share-tip-btn" id="sel-share-mark" aria-label="Highlight selection">Highlight</button><button type="button" class="share-tip-btn" id="sel-share-linkedin" aria-label="Share selection on LinkedIn">LinkedIn</button><button type="button" class="share-tip-btn" id="sel-share-email" aria-label="Email selection">Email</button></div></div>`;
}

/**
 * @deprecated Prefer assets/site.js via SITE_RUNTIME_JS. Kept as an alias so
 * older callers that inlined CHROME_SCRIPT still get the full runtime.
 */
export const CHROME_SCRIPT = SITE_RUNTIME_JS;

/**
 * Designed IR chrome CSS — DNA tokens only (no Inter CDN / purple themes).
 * Brand accents use --dna-brand / --dna-masthead from locked DesignDNA.
 */
export const CHROME_CSS = `
/* rs-ir-chrome — premium DNA-matched type (Open Sans; no Inter CDN) */
html{scroll-behavior:smooth;font-size:16px}
body{margin:0;color:var(--dna-ink,#231F20);background:var(--dna-paper,#fff);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.9375rem;line-height:1.55;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-optical-sizing:auto}
/* Full-bleed shell: masthead/heroes/share/footer stretch edge-to-edge. Content rails keep 1120. */
main[data-dna-component="page-shell"]{max-width:none!important;width:100%;margin:0!important;padding:0 0 2rem!important;display:block;box-sizing:border-box}
.site-nav{position:sticky;top:0;z-index:40;width:100%;max-width:none;background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 97%,#000);border-bottom:3px solid var(--dna-brand,#FCAF17);box-shadow:0 10px 32px rgba(15,59,46,.28);transition:box-shadow .25s ease,background-color .25s ease}
.site-nav.is-scrolled{box-shadow:0 14px 40px rgba(15,59,46,.38);background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 99%,#000)}
.site-nav .nav-inner{display:flex;align-items:center;gap:1rem;max-width:1120px;margin:0 auto;padding:0 clamp(1rem,3vw,2rem);min-height:4.65rem}
.nav-brand{display:flex;align-items:center;gap:.7rem;text-decoration:none;flex-shrink:0;padding:.4rem 0;margin-right:.4rem}
.nav-brand__mark{width:11px;height:30px;background:linear-gradient(180deg,var(--dna-brand,#FCAF17),color-mix(in srgb,var(--dna-brand,#FCAF17) 35%,#000));border-radius:1px;box-shadow:0 0 0 1px color-mix(in srgb,var(--dna-brand,#FCAF17) 35%,transparent)}
.nav-brand__logo-wrap{display:flex;align-items:center;justify-content:center;padding:0;background:transparent;border:0;min-height:0;min-width:0}
.nav-brand__logo-wrap.is-broken,.nav-brand__logo-wrap:has(img[hidden]){display:none!important}
.nav-brand__logo{display:block;height:38px;width:auto;max-width:176px;object-fit:contain;background:transparent;image-rendering:-webkit-optimize-contrast}
.nav-brand__logo[hidden]{display:none!important}
/* Raster extraction crops are often white-on-dark panels — never invert (invert → white boxes). */
.nav-brand__logo--raster{filter:none;-ms-interpolation-mode:nearest-neighbor}
/* Mono SVG wordmarks on dark masthead: invert to paper. */
.nav-brand__logo--svg{height:36px;filter:none;background:transparent}
.nav-brand--logo .nav-brand__logo--svg{filter:brightness(0) invert(1)}
.nav-brand--logo .nav-brand__name{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* If logo fails (inline onerror / site.js), unclip the text wordmark. */
.nav-brand:has(.nav-brand__logo-wrap.is-broken) .nav-brand__name,.nav-brand:has(.nav-brand__logo-wrap:has(img[hidden])) .nav-brand__name,.nav-brand:not(:has(.nav-brand__logo-wrap)) .nav-brand__name{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip:auto;white-space:normal;border:0}
.nav-brand__name{font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:.7rem;font-weight:800;letter-spacing:.08em;color:var(--dna-paper,#fff);line-height:1.15;max-width:14ch}
.site-nav .nav-row{display:flex;flex-wrap:wrap;align-items:stretch;gap:0;list-style:none;margin:0;padding:0;flex:1;justify-content:flex-end}
.site-nav .nav-row>li{display:flex;align-items:stretch}
.site-nav a,.site-nav .nav-dd-btn{font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.68rem;font-weight:600;letter-spacing:.055em;text-transform:uppercase;color:rgba(255,255,255,.76);text-decoration:none;background:none;border:0;padding:0 .78rem;cursor:pointer;display:inline-flex;align-items:center;min-height:4.65rem}
.site-nav a:hover,.site-nav .nav-dd-btn:hover{color:#fff;background:rgba(255,255,255,.07)}
.site-nav a[aria-current="page"],.site-nav .is-active>a,.site-nav .is-active>.nav-dd-btn{color:#fff;font-weight:800;box-shadow:inset 0 -3px 0 var(--dna-brand,#FCAF17)}
.site-nav a.nav-brand,.site-nav a.nav-brand:hover{background:transparent;box-shadow:none;padding:.4rem 0;min-height:0}
.nav-dd{position:relative}
.nav-dd-menu{display:none;position:absolute;right:0;left:auto;top:calc(100% - 2px);min-width:17.5rem;margin:0;padding:.5rem 0;list-style:none;background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 95%,#000);border:1px solid rgba(255,255,255,.12);border-top:2px solid var(--dna-brand,#FCAF17);box-shadow:0 18px 44px rgba(0,0,0,.32);z-index:50}
.nav-dd:hover .nav-dd-menu,.nav-dd:focus-within .nav-dd-menu,.nav-dd.is-open .nav-dd-menu{display:block}
.nav-dd-menu a{display:block;text-transform:none;letter-spacing:-.005em;font-size:.9rem;font-weight:500;padding:.58rem 1.15rem;border-radius:0;min-height:0;color:rgba(255,255,255,.9)}
.nav-dd-menu a:hover,.nav-dd-menu a[aria-current="page"]{background:rgba(255,255,255,.09);color:#fff;box-shadow:none}
.nav-toggle{display:none;flex-direction:column;justify-content:center;gap:5px;margin-left:auto;padding:.45rem;background:none;border:0;cursor:pointer}
.nav-toggle:focus-visible,.nav-dd-btn:focus-visible,.site-nav a:focus-visible{outline:2px solid var(--dna-brand,#FCAF17);outline-offset:2px}
.nav-toggle span{display:block;width:22px;height:2px;background:var(--dna-paper,#fff);border-radius:1px}
.nav-mobile{display:none;flex-direction:column;gap:0;padding:.35rem clamp(1rem,3vw,2rem) 1rem;border-top:1px solid rgba(255,255,255,.12);background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 96%,#000)}
.nav-mobile.is-open{display:flex}
.nav-mobile__link{display:block;padding:.75rem .35rem;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.95rem;color:rgba(255,255,255,.88);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.1);min-height:0}
.nav-mobile__link.is-active,.nav-mobile__link[aria-current="page"]{color:var(--dna-brand,#FCAF17);font-weight:700}
.nav-mobile__sub{padding-left:1.1rem;font-size:.9rem}
.nav-mobile__heading{padding:.65rem .35rem .2rem;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:700}
html.nav-mobile-open{overflow:hidden}
@media (max-width:820px){
  .site-nav .nav-row{display:none}
  .nav-toggle{display:flex}
  /* No-JS: keep mobile links visible (rs-motion only arms when site.js runs). */
  html:not(.rs-motion) .nav-toggle{display:none}
  html:not(.rs-motion) .nav-mobile{display:flex}
  html.rs-motion .nav-mobile{display:none}
  html.rs-motion .nav-mobile.is-open{display:flex}
  .nav-brand__name{max-width:18ch;font-size:.72rem}
  .home-hero--composition{min-height:0;padding-bottom:1.75rem}
  .home-hero h1{max-width:18ch}
  .home-hero__stage .kpi-grid{grid-template-columns:1fr 1fr}
  .kpi-card{min-height:8.5rem;padding:1.15rem 1.05rem 1rem}
}
/* Footer-region share: full-bleed paper band with brand top rule, above the dark footer. */
.share-bar{display:flex;flex-wrap:wrap;gap:.55rem 1rem;align-items:center;max-width:none;width:100%;margin:0;padding:.75rem clamp(1rem,3vw,2rem) .85rem;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);background:var(--dna-paper,#fff);border-top:3px solid var(--dna-brand,#FCAF17);box-sizing:border-box}
.share-bar__label{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:var(--dna-brand,#FCAF17)}
.share-bar__actions{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;max-width:none}
.share-bar__btn{display:inline-flex;align-items:center;gap:.4rem;font-family:inherit;font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;font-weight:700;color:color-mix(in srgb,var(--dna-ink,#111) 62%,var(--dna-paper,#fff));background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 55%,var(--dna-paper,#fff));border:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);padding:.42rem .7rem;cursor:pointer;text-decoration:none;transition:color .15s ease,border-color .15s ease,background .15s ease}
.share-bar__btn:hover,.share-bar__btn.is-active{color:var(--dna-masthead,#0F3B2E);border-color:color-mix(in srgb,var(--dna-brand,#FCAF17) 55%,transparent);background:color-mix(in srgb,var(--dna-brand,#FCAF17) 12%,var(--dna-paper,#fff))}
/* Avoid a double brand rule when share sits directly above the footer accent. */
.share-bar + .site-footer .site-footer__accent{display:none}
.share-bar__btn:focus-visible,.share-tip-btn:focus-visible{outline:2px solid var(--dna-brand,#FCAF17);outline-offset:2px}
.share-bar__ico{display:inline-block;width:12px;height:12px;flex-shrink:0;opacity:.85;background:currentColor;mask-size:contain;mask-repeat:no-repeat;mask-position:center;-webkit-mask-size:contain;-webkit-mask-repeat:no-repeat;-webkit-mask-position:center}
.share-bar__ico--link{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' d='M6.5 9.5a2.5 2.5 0 0 1 0-3.5l1.8-1.8a2.5 2.5 0 0 1 3.5 3.5L10.5 9a.75.75 0 0 0 1.06 1.06l1.3-1.3a4 4 0 1 0-5.66-5.66L5.4 4.9a4 4 0 0 0 0 5.66.75.75 0 0 0 1.1-1.06zm3 0a2.5 2.5 0 0 1 0 3.5l-1.8 1.8a2.5 2.5 0 0 1-3.5-3.5L5.5 7a.75.75 0 0 0-1.06-1.06l-1.3 1.3a4 4 0 1 0 5.66 5.66l1.8-1.8a4 4 0 0 0 0-5.66.75.75 0 1 0-1.1 1.06z'/%3E%3C/svg%3E");-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' d='M6.5 9.5a2.5 2.5 0 0 1 0-3.5l1.8-1.8a2.5 2.5 0 0 1 3.5 3.5L10.5 9a.75.75 0 0 0 1.06 1.06l1.3-1.3a4 4 0 1 0-5.66-5.66L5.4 4.9a4 4 0 0 0 0 5.66.75.75 0 0 0 1.1-1.06zm3 0a2.5 2.5 0 0 1 0 3.5l-1.8 1.8a2.5 2.5 0 0 1-3.5-3.5L5.5 7a.75.75 0 0 0-1.06-1.06l-1.3 1.3a4 4 0 1 0 5.66 5.66l1.8-1.8a4 4 0 0 0 0-5.66.75.75 0 1 0-1.1 1.06z'/%3E%3C/svg%3E")}
.share-bar__ico--li{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' d='M2.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM1 5.75h3V14H1V5.75zM6 5.75h2.85v1.13h.04c.4-.75 1.37-1.54 2.82-1.54C14.2 5.34 15 7 15 9.3V14h-3v-4.1c0-.98-.02-2.23-1.36-2.23-1.36 0-1.57 1.06-1.57 2.16V14H6V5.75z'/%3E%3C/svg%3E");-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' d='M2.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM1 5.75h3V14H1V5.75zM6 5.75h2.85v1.13h.04c.4-.75 1.37-1.54 2.82-1.54C14.2 5.34 15 7 15 9.3V14h-3v-4.1c0-.98-.02-2.23-1.36-2.23-1.36 0-1.57 1.06-1.57 2.16V14H6V5.75z'/%3E%3C/svg%3E")}
.share-bar__ico--mail{mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' d='M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7A1.5 1.5 0 0 1 14.5 13h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3zm.4 1.5 5.55 3.7a.9.9 0 0 0 1.1 0l5.55-3.7H1.9zm-.4 1.55V11.5h13V6.05L8.7 9.8a2.4 2.4 0 0 1-2.4 0L1.5 6.05z'/%3E%3C/svg%3E");-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23000' d='M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7A1.5 1.5 0 0 1 14.5 13h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3zm.4 1.5 5.55 3.7a.9.9 0 0 0 1.1 0l5.55-3.7H1.9zm-.4 1.55V11.5h13V6.05L8.7 9.8a2.4 2.4 0 0 1-2.4 0L1.5 6.05z'/%3E%3C/svg%3E")}
.share-toast{position:fixed;z-index:220;left:50%;bottom:1.5rem;transform:translateX(-50%) translateY(12px);padding:.65rem 1.1rem;background:var(--dna-masthead,#0F3B2E);color:var(--dna-paper,#fff);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.78rem;font-weight:700;letter-spacing:.04em;border-left:3px solid var(--dna-brand,#FCAF17);box-shadow:0 16px 40px rgba(15,59,46,.28);opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease}
.share-toast.is-visible{opacity:1;transform:translateX(-50%) translateY(0)}
.share-tip{position:absolute;z-index:200;display:none;flex-direction:column;gap:.35rem;min-width:11.5rem;background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 97%,#000);color:var(--dna-paper,#fff);border-radius:3px;padding:.55rem .55rem .5rem;box-shadow:0 14px 36px rgba(15,59,46,.32);border:1px solid rgba(255,255,255,.1);border-top:2px solid var(--dna-brand,#FCAF17);transform:translateX(-50%);pointer-events:none}
.share-tip.is-visible{display:flex;pointer-events:auto}
.share-tip__label{font-size:.62rem;letter-spacing:.11em;text-transform:uppercase;font-weight:800;color:var(--dna-brand,#FCAF17);padding:0 .35rem .1rem}
.share-tip__actions{display:flex;flex-wrap:wrap;gap:.2rem}
.share-tip-btn{font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:var(--dna-paper,#fff);background:rgba(255,255,255,.06);border:0;padding:.42rem .55rem;cursor:pointer}
.share-tip-btn:hover,.share-tip-btn:focus-visible{color:var(--dna-brand,#FCAF17);background:rgba(255,255,255,.1)}
mark.user-mark{background:color-mix(in srgb,var(--dna-brand,#FCAF17) 34%,transparent);color:inherit;border-radius:2px;padding:0 2px;box-shadow:0 0 0 1px color-mix(in srgb,var(--dna-brand,#FCAF17) 48%,transparent)}
/* Progressive enhancement: content visible by default. Motion only arms after
   runtime sets html.rs-motion — never blank if site.js/CSP/auth fails. */
.reveal,.kpi-card{opacity:1;transform:none;transition:opacity .65s cubic-bezier(.22,1,.36,1),transform .65s cubic-bezier(.22,1,.36,1)}
html.rs-motion .reveal:not(.is-visible):not(.revealed),
html.rs-motion .kpi-card:not(.is-visible):not(.revealed){opacity:0;transform:translateY(18px)}
.reveal.is-visible,.reveal.revealed,.kpi-card.is-visible,.kpi-card.revealed{opacity:1;transform:none}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(15.75rem,1fr));gap:1.05rem;margin:0}
.kpi-card{display:flex;flex-direction:column;gap:.55rem;padding:1.35rem 1.3rem 1.15rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 11%,transparent);background:linear-gradient(180deg,var(--dna-paper,#fff),color-mix(in srgb,var(--dna-shading,#F2F2F2) 28%,var(--dna-paper,#fff)));border-left:4px solid var(--dna-brand,#FCAF17);min-height:9.75rem;box-shadow:0 1px 0 color-mix(in srgb,var(--dna-ink,#111) 5%,transparent)}
.kpi-card:nth-child(even){border-left-color:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 55%,var(--dna-brand,#FCAF17))}
.kpi-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:.65rem}
.kpi-title{margin:0;font-size:.76rem;letter-spacing:.07em;text-transform:uppercase;font-weight:800;color:var(--dna-masthead,#0F3B2E);line-height:1.3}
.kpi-delta{margin:0;flex-shrink:0;font-size:.7rem;font-weight:800;letter-spacing:.03em;color:var(--dna-masthead,#0F3B2E);background:color-mix(in srgb,var(--dna-brand,#FCAF17) 24%,var(--dna-paper,#fff));padding:.22rem .48rem;border-radius:2px;white-space:nowrap}
.kpi-value{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.55rem,2.7vw,1.95rem);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em;color:var(--dna-ink,#231F20);line-height:1.05}
.kpi-label{margin:0;font-size:.78rem;line-height:1.42;letter-spacing:-.005em;color:color-mix(in srgb,var(--dna-ink,#111) 62%,var(--dna-paper,#fff))}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.3rem .45rem;align-items:center;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.78rem;letter-spacing:-.005em;color:color-mix(in srgb,var(--dna-ink,#111) 58%,var(--dna-paper,#fff));margin:0 0 .85rem}
.breadcrumb a{color:var(--dna-masthead,#0F3B2E);text-decoration:none;font-weight:700}
.bc-sep{opacity:.4}
.page-pager{display:flex;justify-content:space-between;gap:1rem;max-width:1120px;margin:2.5rem auto 0;padding:1.5rem clamp(1rem,3vw,2rem);border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 14%,transparent);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif)}
.page-pager a{color:var(--dna-ink,#231F20);text-decoration:none;max-width:45%;padding:.35rem 0}
.page-pager a:hover .pager-title{color:var(--dna-masthead,#0F3B2E)}
.page-pager .pager-lbl{display:block;font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 50%,var(--dna-paper,#fff));margin-bottom:.3rem;font-weight:800}
.page-pager .pager-title{font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.05rem;font-weight:800;letter-spacing:-.015em}
.page-pager .pager-next{text-align:right;margin-left:auto}
.page-pager .is-empty{flex:1}
.site-footer{margin-top:0;background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 94%,#000);color:rgba(255,255,255,.78)}
.site-footer__accent{height:3px;background:var(--dna-footer-accent,var(--dna-brand,#FCAF17))}
.site-footer__inner{max-width:1120px;margin:0 auto;padding:2.6rem clamp(1rem,3vw,2rem) 1.5rem}
.site-footer__grid{display:grid;grid-template-columns:1.4fr repeat(3,minmax(0,1fr));gap:2rem 1.75rem;align-items:start}
.site-footer__col{min-width:0}
.site-footer__heading{margin:0 0 .9rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:rgba(255,255,255,.92)}
.site-footer__links{list-style:none;margin:0;padding:0;display:grid;gap:.48rem}
.site-footer__links a{color:rgba(255,255,255,.7);text-decoration:none;font-size:.88rem;letter-spacing:-.01em;line-height:1.35}
.site-footer__links a:hover,.site-footer__links a:focus-visible{color:var(--dna-brand,#FCAF17)}
.site-footer__lockup{display:inline-flex;align-items:center;padding:0;margin:0 0 .35rem;width:fit-content;background:transparent;border:0}
.site-footer__lockup.is-broken,.site-footer__lockup:has(img[hidden]){display:none!important}
.site-footer__logo[hidden]{display:none!important}
.site-footer__logo{display:block;height:40px;width:auto;max-width:168px;object-fit:contain;opacity:.96;image-rendering:-webkit-optimize-contrast;background:transparent}
.site-footer__logo--raster{filter:none}
.site-footer__logo--svg{filter:brightness(0) invert(1)}
.site-footer__brand{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-weight:800;letter-spacing:.04em}
.site-footer__brand--text{font-size:1.05rem;text-transform:uppercase;color:var(--dna-brand,#FCAF17);margin-bottom:.35rem}
.site-footer__copy .site-footer__brand{font-size:inherit;font-weight:700;letter-spacing:inherit;text-transform:none;color:inherit}
.site-footer__blurb{margin:.55rem 0 0;font-size:.82rem;line-height:1.45;color:rgba(255,255,255,.62);max-width:28ch}
.site-footer__period{margin:.55rem 0 0;font-size:.8rem;line-height:1.45;font-weight:600;color:rgba(255,255,255,.78);max-width:30ch}
.site-footer__note{margin:.55rem 0 0;font-size:.76rem;letter-spacing:.05em;color:rgba(255,255,255,.48);line-height:1.45}
.site-footer__bar{border-top:1px solid rgba(255,255,255,.12);padding:0}
.site-footer__bar-inner{max-width:1120px;margin:0 auto;padding:1.05rem clamp(1rem,3vw,2rem) 1.35rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.65rem 1.5rem;align-items:baseline}
.site-footer__copy,.site-footer__meta{margin:0;font-size:.72rem;letter-spacing:.01em;color:rgba(255,255,255,.48);line-height:1.45}
.site-footer__meta{text-align:right}
@media (max-width:900px){
  .site-footer__grid{grid-template-columns:1fr 1fr;gap:1.75rem 1.25rem}
  .site-footer__col--brand{grid-column:1/-1}
}
@media (max-width:560px){
  .site-footer__grid{grid-template-columns:1fr}
  .site-footer__meta{text-align:left}
}
.page-hero{position:relative;max-width:none;width:100%;margin:0;padding:0;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 11%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 9%,var(--dna-paper,#fff)),var(--dna-paper,#fff) 78%);box-sizing:border-box}
.page-hero__rail{position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--dna-brand,#FCAF17),color-mix(in srgb,var(--dna-masthead,#0F3B2E) 70%,var(--dna-brand,#FCAF17)))}
.page-hero__inner{max-width:1120px;width:100%;margin:0 auto;padding:1.85rem clamp(1rem,3vw,2rem) 1.45rem;box-sizing:border-box}
.page-hero__eyebrow{margin:0 0 .4rem;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--dna-brand,#FCAF17);font-weight:800}
.page-hero h1{margin:0 0 .4rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.6rem,2.9vw,2.2rem);font-weight:800;line-height:1.14;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.025em}
.page-hero__sub{margin:0;font-size:.94rem;letter-spacing:-.008em;color:color-mix(in srgb,var(--dna-ink,#111) 66%,var(--dna-paper,#fff));max-width:42rem}
.page-title-banner{max-width:1120px;margin:0 auto;padding:1.25rem clamp(1rem,3vw,2rem) .5rem}
.page-title-banner h1{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.35rem,2.4vw,1.85rem);font-weight:800;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.02em}
.home-hero{position:relative;max-width:none;width:100%;margin:0;padding:0;background:linear-gradient(145deg,var(--dna-masthead,#0F3B2E) 0%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 82%,#000) 55%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 72%,var(--dna-brand,#FCAF17)) 100%);color:var(--dna-paper,#fff);border-bottom:0;overflow-x:clip;overflow-y:visible;min-height:0;box-sizing:border-box}
.home-hero--composition{display:flex;flex-direction:column;min-height:min(92vh,56rem);padding-bottom:clamp(2.25rem,5vh,3.5rem)}
.home-hero--atmosphere{background:radial-gradient(120% 90% at 8% 10%,color-mix(in srgb,var(--dna-brand,#FCAF17) 22%,transparent) 0%,transparent 48%),linear-gradient(158deg,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 96%,#000) 0%,var(--dna-masthead,#0F3B2E) 38%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 74%,var(--dna-brand,#FCAF17)) 100%)}
.home-hero--photo{background:var(--dna-masthead,#0F3B2E)}
.home-hero__atmosphere{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.home-hero__mesh{position:absolute;inset:0;opacity:.45;background:repeating-linear-gradient(-18deg,transparent 0 14px,rgba(255,255,255,.025) 14px 15px),radial-gradient(ellipse 85% 65% at 82% 18%,color-mix(in srgb,var(--dna-brand,#FCAF17) 16%,transparent),transparent 55%)}
.home-hero__beam{position:absolute;top:-20%;right:-8%;width:55%;height:140%;background:linear-gradient(108deg,transparent 30%,color-mix(in srgb,var(--dna-brand,#FCAF17) 12%,transparent) 48%,transparent 66%);transform:rotate(8deg);opacity:.75}
.home-hero__orb{position:absolute;border-radius:50%;filter:blur(2px)}
.home-hero__orb--a{width:24rem;height:24rem;left:-7rem;bottom:-9rem;background:radial-gradient(circle,color-mix(in srgb,var(--dna-brand,#FCAF17) 24%,transparent),transparent 68%);opacity:.6}
.home-hero__orb--b{width:18rem;height:18rem;right:6%;top:10%;background:radial-gradient(circle,rgba(255,255,255,.1),transparent 70%);opacity:.5}
.home-hero__grain{position:absolute;inset:0;opacity:.055;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");mix-blend-mode:overlay}
.home-hero--photo .home-hero__atmosphere{opacity:.28}
.home-hero__photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 28%;opacity:.58;pointer-events:none;z-index:0}
.home-hero--strip .home-hero__photo{object-fit:cover;object-position:center 42%;opacity:.68;transform:scale(1.05)}
.home-hero--page .home-hero__photo{object-fit:cover;object-position:center 10%;opacity:.46}
.home-hero--photo::after{content:"";position:absolute;inset:0;z-index:0;background:linear-gradient(112deg,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 96%,#000) 0%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 62%,transparent) 48%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 32%,transparent) 100%),linear-gradient(180deg,transparent 42%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 55%,transparent) 100%);pointer-events:none}
.home-hero__mast{height:3px;background:var(--dna-brand,#FCAF17);position:relative;z-index:1;flex-shrink:0}
.home-hero__brand{display:flex;flex-wrap:wrap;align-items:center;gap:.85rem 1.15rem;margin:0 0 1.35rem}
.home-hero__lockup{display:inline-flex;align-items:center;gap:.85rem;margin:0;padding:0;background:transparent;border:0}
.home-hero__lockup.is-broken,.home-hero__lockup:has(img[hidden]){display:none!important}
.home-hero__logo{display:block;height:56px;width:auto;max-width:240px;object-fit:contain;background:transparent;image-rendering:-webkit-optimize-contrast}
.home-hero__logo[hidden]{display:none!important}
.home-hero__logo--svg{height:52px;filter:brightness(0) invert(1)}
.home-hero__logo--raster{filter:none;-ms-interpolation-mode:nearest-neighbor}
.home-hero__company{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.05rem,1.8vw,1.35rem);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;line-height:1.15;text-shadow:0 1px 16px rgba(0,0,0,.2)}
.home-hero__inner{position:relative;z-index:1;max-width:1120px;width:100%;margin:0 auto;padding:clamp(2.75rem,7vh,4.25rem) clamp(1rem,3vw,2rem) clamp(1.75rem,4vh,2.75rem);flex:1 1 auto;display:flex;flex-direction:column;justify-content:center}
.home-kicker{margin:0 0 .75rem;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--dna-brand,#FCAF17);font-weight:800;max-width:46rem}
.home-hero h1{margin:0 0 .7rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(2.15rem,4.6vw,3.35rem);line-height:1.05;letter-spacing:-.035em;color:#fff;font-weight:800;max-width:22ch;text-shadow:0 2px 24px rgba(0,0,0,.2)}
.home-period{margin:0 0 .85rem;font-size:clamp(1.05rem,1.9vw,1.28rem);color:rgba(255,255,255,.88);max-width:38rem;font-weight:600;letter-spacing:-.012em}
.home-hero__rule{display:block;width:5rem;height:3px;margin:0 0 1.25rem;background:var(--dna-brand,#FCAF17)}
.home-lede{margin:0 0 1.45rem;max-width:38rem;font-size:clamp(1.02rem,1.55vw,1.14rem);line-height:1.62;color:rgba(255,255,255,.84);letter-spacing:-.008em}
.home-meta{display:flex;flex-wrap:wrap;gap:.55rem .7rem;margin:0 0 1.55rem;padding-bottom:.15rem}
.home-meta__chip{display:inline-flex;align-items:center;padding:.52rem .9rem;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;font-weight:800;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);line-height:1.25;box-sizing:border-box}
.home-cta{display:flex;flex-wrap:wrap;gap:.95rem 1.35rem;align-items:center;padding-bottom:.15rem}
.home-cta__primary{display:inline-block;padding:.95rem 1.65rem;background:var(--dna-brand,#FCAF17);color:var(--dna-ink,#231F20)!important;text-decoration:none;font-size:.94rem;font-weight:800;letter-spacing:.025em;border:1px solid transparent;box-shadow:0 10px 28px rgba(0,0,0,.22)}
.home-cta__primary:hover{filter:brightness(1.04);transform:translateY(-1px)}
.home-cta__secondary{color:#fff;font-size:.94rem;font-weight:700;text-decoration:none;border-bottom:2px solid color-mix(in srgb,var(--dna-brand,#FCAF17) 85%,transparent);padding-bottom:2px;letter-spacing:-.005em}
.home-hero__stage{position:relative;z-index:2;width:100%;max-width:1120px;margin:0 auto;padding:0 clamp(1rem,3vw,2rem);flex-shrink:0}
.home-hero__stage .kpi-band{margin:0;box-shadow:0 26px 56px rgba(15,59,46,.2)}
.home-body,.prose-body{max-width:1120px;width:100%;margin:0 auto;padding:2.15rem clamp(1rem,3vw,2rem) 1.85rem;display:grid;gap:2.85rem;box-sizing:border-box}
.page-statement{max-width:none;width:100%;margin:0;padding:0 0 2rem;display:block;box-sizing:border-box}
.page-statement > .statement-table,.page-statement > .note-block,.page-statement > .fin-wrapper{max-width:1120px;width:100%;margin:1rem auto;padding:0 clamp(1rem,3vw,2rem);box-sizing:border-box}
.prose-body{gap:1.15rem;padding-top:1.35rem}
.home-body{margin-top:0;position:relative;z-index:1;padding-top:2.35rem}
.home-body:has(.explore){padding-bottom:0;gap:2.35rem}
.kpi-band{background:var(--dna-paper,#fff);border:1px solid color-mix(in srgb,var(--dna-ink,#111) 11%,transparent);padding:1.75rem 1.55rem 1.55rem;box-shadow:0 22px 48px rgba(15,59,46,.12);position:relative}
.kpi-band::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--dna-brand,#FCAF17) 0%,var(--dna-brand,#FCAF17) 40%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 55%,var(--dna-brand,#FCAF17)) 100%)}
.section-hdr{margin:0 0 1.25rem;padding-bottom:.75rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.5rem 1.25rem}
.section-hdr__title{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.5rem,2.5vw,1.95rem);font-weight:800;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.025em}
.section-hdr__sub{margin:0;font-size:.86rem;letter-spacing:-.005em;color:color-mix(in srgb,var(--dna-ink,#111) 55%,var(--dna-paper,#fff))}
.kpi-band .section-hdr{border-bottom-color:color-mix(in srgb,var(--dna-brand,#FCAF17) 40%,transparent)}
.highlights .prose-p,.prose-p{margin:.55rem 0;line-height:1.7}
.prose-lead{font-size:1.18rem;line-height:1.75;letter-spacing:-.01em;color:color-mix(in srgb,var(--dna-ink,#111) 90%,var(--dna-paper,#fff));font-weight:500;margin:0 0 1.15rem}
.highlights-band .highlight-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(22rem,1fr));gap:.95rem}
.highlight-item{padding:1.15rem 1.25rem;border-left:3px solid var(--dna-brand,#FCAF17);background:linear-gradient(90deg,color-mix(in srgb,var(--dna-shading,#F2F2F2) 55%,var(--dna-paper,#fff)),var(--dna-paper,#fff));font-size:.95rem;line-height:1.55;letter-spacing:-.005em}
/* Explore: full-bleed paper band + airy 3-col IR cards (desktop). */
.explore{width:100vw;max-width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);padding:clamp(2.5rem,5vw,3.5rem) 0 clamp(2.75rem,5.5vw,3.75rem);background:linear-gradient(180deg,color-mix(in srgb,var(--dna-shading,#F2F2F2) 62%,var(--dna-paper,#fff)) 0%,color-mix(in srgb,var(--dna-shading,#F2F2F2) 38%,var(--dna-paper,#fff)) 55%,var(--dna-paper,#fff) 100%);border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 8%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 8%,transparent);box-sizing:border-box}
.explore__rail{max-width:1120px;width:100%;margin:0 auto;padding:0 clamp(1rem,3vw,2rem);box-sizing:border-box}
.section-hdr--explore{margin:0 0 1.65rem;padding-bottom:.95rem;align-items:flex-end}
.section-hdr--explore .section-hdr__title{font-size:clamp(1.65rem,2.8vw,2.1rem)}
.section-hdr--explore .section-hdr__sub{font-size:.9rem;max-width:28rem}
.explore-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.35rem 1.5rem}
.explore-card{display:flex;flex-direction:column;align-items:stretch;gap:0;padding:1.75rem 1.65rem 1.45rem;min-height:0;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);border-top:3px solid color-mix(in srgb,var(--dna-ink,#111) 8%,transparent);background:var(--dna-paper,#fff);color:inherit;text-decoration:none;box-shadow:0 1px 0 color-mix(in srgb,var(--dna-ink,#111) 4%,transparent);transition:border-color .2s ease,border-top-color .2s ease,transform .22s ease,box-shadow .22s ease}
.explore-card:hover,.explore-card:focus-visible{border-color:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 18%,transparent);border-top-color:var(--dna-brand,#FCAF17);transform:translateY(-3px);box-shadow:0 18px 40px rgba(15,59,46,.1);outline:none}
.explore-n{display:block;margin:0 0 .85rem;font-size:.72rem;letter-spacing:.16em;color:var(--dna-brand,#FCAF17);font-weight:800;line-height:1}
.explore-label{display:block;margin:0 0 .65rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.18rem,1.55vw,1.32rem);font-weight:800;line-height:1.2;letter-spacing:-.02em;color:var(--dna-masthead,#0F3B2E)}
.explore-desc{display:block;margin:0;flex:1 1 auto;font-size:.9rem;line-height:1.58;letter-spacing:-.005em;color:color-mix(in srgb,var(--dna-ink,#111) 66%,var(--dna-paper,#fff))}
.explore-cta{display:inline-flex;align-items:center;gap:.4rem;margin-top:1.35rem;padding-top:.15rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--dna-masthead,#0F3B2E);font-weight:800;border-bottom:2px solid transparent;align-self:flex-start;transition:border-color .2s ease,color .2s ease}
.explore-cta__arrow{display:inline-block;transition:transform .2s ease}
.explore-card:hover .explore-cta,.explore-card:focus-visible .explore-cta{border-bottom-color:var(--dna-brand,#FCAF17);color:var(--dna-masthead,#0F3B2E)}
.explore-card:hover .explore-cta__arrow,.explore-card:focus-visible .explore-cta__arrow{transform:translateX(3px)}
@media (max-width:960px){
  .explore-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2rem}
}
@media (max-width:560px){
  .explore{padding:2.1rem 0 2.35rem}
  .explore-grid{grid-template-columns:1fr;gap:1rem}
  .explore-card{padding:1.45rem 1.3rem 1.25rem}
  .section-hdr--explore{margin-bottom:1.25rem}
}
.commentary-toc{display:flex;flex-wrap:wrap;align-items:baseline;gap:.85rem 1.5rem;padding:1.05rem 1.25rem 1.1rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);border-left:4px solid var(--dna-brand,#FCAF17);margin:0 0 .65rem;background:linear-gradient(180deg,color-mix(in srgb,var(--dna-shading,#F2F2F2) 48%,var(--dna-paper,#fff)),var(--dna-paper,#fff))}
.commentary-toc__label{margin:0;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 52%,var(--dna-paper,#fff));font-weight:800}
.commentary-toc__links{display:flex;flex-wrap:wrap;gap:.65rem 1.35rem}
.commentary-toc__link{display:inline-flex;align-items:baseline;gap:.45rem;color:var(--dna-masthead,#0F3B2E);text-decoration:none;font-size:.98rem;font-weight:700;border-bottom:1px solid transparent}
.commentary-toc__n{font-size:.68rem;letter-spacing:.08em;color:var(--dna-brand,#FCAF17);font-weight:800}
.commentary-toc__link:hover{color:var(--dna-masthead,#0F3B2E);border-bottom-color:var(--dna-brand,#FCAF17)}
.commentary-section{scroll-margin-top:5.5rem;padding:1.65rem 0 2rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent)}
.commentary-toc + .commentary-section,.commentary-section:first-of-type{padding-top:1rem}
.commentary-section:last-of-type{border-bottom:0}
.commentary-section__hdr{margin:0 0 1.1rem;max-width:44rem;padding-left:1.1rem;border-left:4px solid var(--dna-brand,#FCAF17)}
.commentary-section__eyebrow{margin:0 0 .35rem;font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--dna-brand,#FCAF17);font-weight:800}
.commentary-section__title{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.55rem,2.6vw,2.05rem);font-weight:800;line-height:1.16;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.022em}
.commentary-section__doc-title{margin:0 0 .85rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.14rem;font-weight:700}
.commentary-dek{margin:0 0 1.25rem;font-size:1.16rem;line-height:1.62;color:color-mix(in srgb,var(--dna-ink,#111) 78%,var(--dna-paper,#fff));font-weight:600}
.prose-rail{max-width:44rem}
.prose-rail .prose-p,.prose-rail .prose-subh,.prose-rail .prose-signoff{max-width:44rem}
.commentary-section__body > .prose-subh:first-child{margin-top:.35rem}
.commentary-ops-tables{margin:1.75rem 0 0;max-width:min(100%,52rem);width:100%}
.commentary-ops-tables .statement-table{margin:.35rem 0 0}
.prose-subh{margin:2rem 0 .7rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.22rem;font-weight:800;line-height:1.28;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.015em}
.prose-ul{margin:.65rem 0 1.25rem;padding-left:1.3rem}
.prose-li{margin:.5rem 0;line-height:1.68}
.prose-signoff{margin:2rem 0 .45rem;font-weight:700}
.download-list{list-style:none;margin:0;padding:0;display:grid;gap:.85rem}
.download-list li{padding:1.05rem 0;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent)}
.dl-link{display:block;color:inherit;text-decoration:none}
.dl-link:hover .dl-label{color:var(--dna-masthead,#0F3B2E)}
.dl-label{display:block;font-weight:700;font-size:1.02rem}
.dl-note{display:block;margin-top:.3rem;font-size:.9rem;color:color-mix(in srgb,var(--dna-ink,#111) 60%,var(--dna-paper,#fff))}
.xls-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.7rem 1.1rem;max-width:none;width:100%;margin:0;padding:.9rem clamp(1rem,3vw,2rem) .2rem;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 40%,var(--dna-paper,#fff));border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);box-sizing:border-box}
.xls-toolbar__label{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--dna-brand,#FCAF17)}
.xls-download{font-size:.86rem;color:var(--dna-masthead,#0F3B2E);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--dna-brand,#FCAF17) 60%,transparent);font-weight:600}
.xls-download:hover{color:var(--dna-ink,#231F20)}
.xls-download--secondary{border-bottom-color:color-mix(in srgb,var(--dna-ink,#111) 22%,transparent);color:color-mix(in srgb,var(--dna-ink,#111) 70%,var(--dna-paper,#fff));font-weight:500}
.note-block{margin:1.75rem 0 1.15rem;padding-top:.65rem;scroll-margin-top:5.5rem;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 8%,transparent)}
.note-title{font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.15rem;margin:0 0 .7rem;color:var(--dna-masthead,#0F3B2E);font-weight:700}
.note-block .prose-p{margin:.4rem 0;line-height:1.55}
.statement-unit{display:inline-flex;align-items:center;gap:.45rem;margin:0 0 .7rem;padding:.28rem .55rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);border-left:3px solid var(--dna-brand,#FCAF17);background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 42%,var(--dna-paper,#fff));font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:color-mix(in srgb,var(--dna-ink,#111) 55%,var(--dna-paper,#fff))}
.statement-unit__value{color:var(--dna-masthead,#0F3B2E);font-weight:800;letter-spacing:.06em}
.page-statement .statement-table,.page-statement .fin-wrapper{border-top:2px solid var(--dna-brand,#FCAF17);border-left:0;border-right:0;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);box-shadow:none}
`.trim();

