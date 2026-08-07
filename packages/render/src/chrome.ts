/**
 * Shared microsite chrome for multi-page SitePlan export:
 * sticky nav (Financials dropdown + mobile toggle), breadcrumb, prev/next,
 * selection mark/share tooltip host, SEO head.
 * Uses DNA CSS variables — no Inter / Google Fonts CDN.
 * Interaction behaviour lives in site-runtime.ts (assets/site.js).
 */

import { SITE_RUNTIME_JS } from "./site-runtime.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
        return `<li class="nav-dd${active ? " is-active" : ""}"><button type="button" class="nav-dd-btn" aria-expanded="false">${escapeHtml(item.label)}</button><ul class="nav-dd-menu">${kids}</ul></li>`;
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

  return `<nav class="site-nav" data-dna-component="sticky-nav" aria-label="Primary"><div class="nav-inner"><ul class="nav-row">${items}</ul><button type="button" class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="nav-mobile" aria-label="Open menu"><span></span><span></span><span></span></button></div><div class="nav-mobile" id="nav-mobile">${mobileLinks}</div></nav>`;
}

export function renderBreadcrumb(
  path: string,
  title: string,
  company?: string,
): string {
  if (path === "index.html") return "";
  const homeHref = hrefFrom(path, "index.html");
  const crumbs = [`<a href="${escapeHtml(homeHref)}">${escapeHtml(company || "Home")}</a>`];
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
  const parts: string[] = ['<footer class="page-pager" data-dna-component="page-pager">'];
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
  parts.push("</footer>");
  return parts.join("");
}

export function renderShareBar(): string {
  return `<div class="share-bar" data-dna-component="share"><button type="button" data-share="copy">Copy link</button><a data-share="linkedin" href="#" rel="noopener noreferrer" target="_blank">LinkedIn</a></div>`;
}

/** Selection tooltip host for Copy / Highlight / LinkedIn (wired by SiteRuntime). */
export function renderSelectionTooltip(): string {
  return `<div id="share-tooltip" role="tooltip"><button type="button" class="share-tip-btn" id="sel-share-copy">Copy</button><button type="button" class="share-tip-btn" id="sel-share-mark">Highlight</button><button type="button" class="share-tip-btn" id="sel-share-linkedin">LinkedIn</button></div>`;
}

/**
 * @deprecated Prefer assets/site.js via SITE_RUNTIME_JS. Kept as an alias so
 * older callers that inlined CHROME_SCRIPT still get the full runtime.
 */
export const CHROME_SCRIPT = SITE_RUNTIME_JS;

/** Baseline chrome CSS (DNA tokens; no external font CDN). */
export const CHROME_CSS = `
.site-nav{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--dna-paper,#fff) 94%,var(--dna-ink,#111));border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 16%,transparent);backdrop-filter:blur(10px)}
.site-nav .nav-inner{display:flex;align-items:center;gap:.5rem;max-width:1120px;margin:0 auto;padding:.65rem clamp(1rem,3vw,2rem)}
.site-nav .nav-row{display:flex;flex-wrap:wrap;align-items:center;gap:.1rem .35rem;list-style:none;margin:0;padding:0;flex:1}
.site-nav a,.site-nav .nav-dd-btn{font-family:var(--dna-font-body,system-ui,sans-serif);font-size:.76rem;letter-spacing:.05em;text-transform:uppercase;color:var(--dna-ink,#231F20);text-decoration:none;background:none;border:0;padding:.5rem .6rem;cursor:pointer}
.site-nav a[aria-current="page"],.site-nav .is-active>a,.site-nav .is-active>.nav-dd-btn{color:var(--dna-brand,#B8912A);font-weight:700}
.nav-dd{position:relative}
.nav-dd-menu{display:none;position:absolute;left:0;top:calc(100% - 2px);min-width:15rem;margin:0;padding:.4rem 0;list-style:none;background:var(--dna-paper,#fff);border:1px solid color-mix(in srgb,var(--dna-ink,#111) 18%,transparent);box-shadow:0 10px 28px rgba(0,0,0,.1);z-index:50}
.nav-dd:hover .nav-dd-menu,.nav-dd:focus-within .nav-dd-menu,.nav-dd.is-open .nav-dd-menu{display:block}
.nav-dd-menu a{display:block;text-transform:none;letter-spacing:0;font-size:.9rem;padding:.45rem .95rem}
.nav-toggle{display:none;flex-direction:column;justify-content:center;gap:5px;margin-left:auto;padding:.45rem;background:none;border:0;cursor:pointer}
.nav-toggle span{display:block;width:22px;height:2px;background:var(--dna-ink,#231F20);border-radius:1px}
.nav-mobile{display:none;flex-direction:column;gap:0;padding:.35rem clamp(1rem,3vw,2rem) 1rem;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);background:var(--dna-paper,#fff)}
.nav-mobile.is-open{display:flex}
.nav-mobile__link{display:block;padding:.7rem .35rem;font-family:var(--dna-font-body,system-ui,sans-serif);font-size:.95rem;color:var(--dna-ink,#231F20);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent)}
.nav-mobile__link.is-active,.nav-mobile__link[aria-current="page"]{color:var(--dna-brand,#B8912A);font-weight:700}
.nav-mobile__sub{padding-left:1.1rem;font-size:.9rem}
.nav-mobile__heading{padding:.65rem .35rem .2rem;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 50%,var(--dna-paper,#fff))}
@media (max-width:820px){
  .site-nav .nav-row{display:none}
  .nav-toggle{display:flex}
  .nav-mobile.is-open{display:flex}
}
.share-bar{display:flex;gap:.5rem;align-items:center;max-width:1120px;margin:0 auto;padding:.45rem clamp(1rem,3vw,2rem) 0;font-family:var(--dna-font-body,system-ui,sans-serif)}
.share-bar button,.share-bar a{font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 60%,var(--dna-paper,#fff));background:none;border:0;padding:.35rem .45rem;cursor:pointer;text-decoration:none}
#share-tooltip{position:absolute;z-index:200;display:none;gap:.35rem;background:var(--dna-ink,#231F20);color:var(--dna-paper,#fff);border-radius:6px;padding:.35rem .45rem;box-shadow:0 8px 28px rgba(0,0,0,.18);transform:translateX(-50%);pointer-events:none}
#share-tooltip.is-visible{display:flex;pointer-events:auto}
.share-tip-btn{font-family:var(--dna-font-body,system-ui,sans-serif);font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--dna-paper,#fff);background:transparent;border:0;padding:.35rem .55rem;cursor:pointer}
.share-tip-btn:hover{color:var(--dna-brand,#B8912A)}
mark.user-mark{background:color-mix(in srgb,var(--dna-brand,#B8912A) 28%,transparent);color:inherit;border-radius:2px;padding:0 2px;box-shadow:0 0 0 1px color-mix(in srgb,var(--dna-brand,#B8912A) 40%,transparent)}
.reveal,.kpi-card{opacity:0;transform:translateY(14px);transition:opacity .55s ease,transform .55s ease}
.reveal.is-visible,.reveal.revealed,.kpi-card.is-visible,.kpi-card.revealed{opacity:1;transform:none}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(14.5rem,1fr));gap:.85rem;margin:0 0 1.25rem}
.kpi-card{padding:1rem 1.1rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 14%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--dna-shading,#F2F2F2) 40%,var(--dna-paper,#fff)),var(--dna-paper,#fff));border-top:3px solid var(--dna-brand,#B8912A)}
.kpi-label{margin:0 0 .45rem;font-size:.82rem;line-height:1.35;color:color-mix(in srgb,var(--dna-ink,#111) 72%,var(--dna-paper,#fff))}
.kpi-value{margin:0;font-family:var(--dna-font-heading,Georgia,serif);font-size:clamp(1.25rem,2.4vw,1.65rem);font-weight:700;font-variant-numeric:tabular-nums;color:var(--dna-ink,#231F20)}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.35rem .5rem;align-items:center;font-family:var(--dna-font-body,system-ui,sans-serif);font-size:.82rem;color:color-mix(in srgb,var(--dna-ink,#111) 62%,var(--dna-paper,#fff));margin:0 0 .85rem}
.breadcrumb a{color:var(--dna-brand,#B8912A);text-decoration:none}
.bc-sep{opacity:.45}
.page-pager{display:flex;justify-content:space-between;gap:1rem;max-width:1120px;margin:2.75rem auto 0;padding:1.35rem clamp(1rem,3vw,2rem) 2.75rem;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 16%,transparent);font-family:var(--dna-font-body,system-ui,sans-serif)}
.page-pager a{color:var(--dna-ink,#231F20);text-decoration:none;max-width:45%}
.page-pager a:hover .pager-title{color:var(--dna-brand,#B8912A)}
.page-pager .pager-lbl{display:block;font-size:.7rem;letter-spacing:.07em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 52%,var(--dna-paper,#fff));margin-bottom:.25rem}
.page-pager .pager-title{font-family:var(--dna-font-heading,Georgia,serif);font-size:1rem}
.page-pager .pager-next{text-align:right;margin-left:auto}
.page-pager .is-empty{flex:1}
.page-hero{max-width:1120px;margin:0 auto;padding:1.35rem clamp(1rem,3vw,2rem) 1.1rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--dna-shading,#F2F2F2) 55%,var(--dna-paper,#fff)),var(--dna-paper,#fff))}
.page-hero__eyebrow{margin:0 0 .4rem;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--dna-brand,#B8912A);font-weight:700}
.page-hero h1{margin:0 0 .4rem;font-family:var(--dna-font-heading,Georgia,serif);font-size:clamp(1.45rem,2.6vw,2rem);font-weight:700;line-height:1.2;color:var(--dna-ink,#231F20)}
.page-hero__sub{margin:0;font-size:.95rem;color:color-mix(in srgb,var(--dna-ink,#111) 68%,var(--dna-paper,#fff));max-width:40rem}
.page-title-banner{max-width:1120px;margin:0 auto;padding:1.25rem clamp(1rem,3vw,2rem) .5rem}
.page-title-banner h1{margin:0;font-family:var(--dna-font-heading,Georgia,serif);font-size:clamp(1.35rem,2.4vw,1.85rem);font-weight:600;color:var(--dna-ink,#231F20)}
.home-hero{max-width:none;margin:0;padding:0;background:linear-gradient(165deg,color-mix(in srgb,var(--dna-shading,#F2F2F2) 70%,var(--dna-paper,#fff)) 0%,var(--dna-paper,#fff) 55%,color-mix(in srgb,var(--dna-brand,#B8912A) 8%,var(--dna-paper,#fff)) 100%);border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent)}
.home-hero__inner{max-width:1120px;margin:0 auto;padding:2.75rem clamp(1rem,3vw,2rem) 2rem}
.home-kicker{margin:0 0 .45rem;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:var(--dna-brand,#B8912A);font-weight:700}
.home-hero h1{margin:0 0 .55rem;font-family:var(--dna-font-heading,Georgia,serif);font-size:clamp(2rem,4.2vw,3rem);line-height:1.12;letter-spacing:-.02em}
.home-period{margin:0 0 .85rem;font-size:1.05rem;color:color-mix(in srgb,var(--dna-ink,#111) 72%,var(--dna-paper,#fff));max-width:40rem}
.home-lede{margin:0 0 1.35rem;max-width:38rem;font-size:1.02rem;line-height:1.55;color:color-mix(in srgb,var(--dna-ink,#111) 78%,var(--dna-paper,#fff))}
.home-cta{display:flex;flex-wrap:wrap;gap:.75rem 1rem;align-items:center}
.home-cta__primary{display:inline-block;padding:.65rem 1.15rem;background:var(--dna-brand,#B8912A);color:var(--dna-paper,#fff)!important;text-decoration:none;font-size:.88rem;font-weight:600;letter-spacing:.02em}
.home-cta__secondary{color:var(--dna-brand,#B8912A);font-size:.9rem;text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--dna-brand,#B8912A) 45%,transparent)}
.home-body,.prose-body,.page-statement{max-width:1120px;margin:0 auto;padding:1.5rem clamp(1rem,3vw,2rem) 1.5rem;display:grid;gap:2rem}
.section-hdr{margin:0 0 1rem}
.section-hdr__title{margin:0 0 .25rem;font-family:var(--dna-font-heading,Georgia,serif);font-size:clamp(1.35rem,2.2vw,1.75rem);font-weight:700;color:var(--dna-ink,#231F20)}
.section-hdr__sub{margin:0;font-size:.9rem;color:color-mix(in srgb,var(--dna-ink,#111) 58%,var(--dna-paper,#fff))}
.kpi-band .kpi-grid{margin:0}
.highlights .prose-p,.prose-p{margin:.35rem 0;line-height:1.55}
.highlights-band .highlight-list{list-style:none;margin:0;padding:0;display:grid;gap:.65rem}
.highlight-item{padding:.85rem 1rem;border-left:3px solid var(--dna-brand,#B8912A);background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 45%,var(--dna-paper,#fff));font-size:.95rem;line-height:1.5}
.explore-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(16.5rem,1fr));gap:1rem}
.explore-card{display:flex;gap:.85rem;align-items:flex-start;padding:1.15rem 1.2rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 14%,transparent);background:linear-gradient(180deg,var(--dna-paper,#fff),color-mix(in srgb,var(--dna-shading,#F2F2F2) 35%,var(--dna-paper,#fff)));color:inherit;text-decoration:none;min-height:9.5rem;transition:border-color .2s ease,transform .2s ease}
.explore-card:hover{border-color:var(--dna-brand,#B8912A);transform:translateY(-2px)}
.explore-n{font-size:.72rem;letter-spacing:.08em;color:var(--dna-brand,#B8912A);font-weight:700;flex-shrink:0;padding-top:.15rem}
.explore-card__body{display:flex;flex-direction:column;gap:.4rem;min-width:0}
.explore-label{font-family:var(--dna-font-heading,Georgia,serif);font-size:1.15rem;font-weight:700;line-height:1.25}
.explore-desc{font-size:.88rem;line-height:1.45;color:color-mix(in srgb,var(--dna-ink,#111) 68%,var(--dna-paper,#fff))}
.explore-cta{margin-top:auto;padding-top:.35rem;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:var(--dna-brand,#B8912A);font-weight:600}
.commentary-toc{display:flex;flex-wrap:wrap;align-items:baseline;gap:.65rem 1.25rem;padding:.85rem 0 1.25rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);margin-bottom:.25rem}
.commentary-toc__label{margin:0;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 55%,var(--dna-paper,#fff));font-weight:700}
.commentary-toc__links{display:flex;flex-wrap:wrap;gap:.5rem 1rem}
.commentary-toc__link{color:var(--dna-brand,#B8912A);text-decoration:none;font-size:.92rem}
.commentary-toc__link:hover{text-decoration:underline}
.commentary-section{scroll-margin-top:5rem;padding:1.5rem 0 1.75rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent)}
.commentary-section:last-of-type{border-bottom:0}
.commentary-section__hdr{margin:0 0 1.15rem;max-width:40rem}
.commentary-section__eyebrow{margin:0 0 .35rem;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--dna-brand,#B8912A);font-weight:700}
.commentary-section__title{margin:0;font-family:var(--dna-font-heading,Georgia,serif);font-size:clamp(1.4rem,2.4vw,1.85rem);font-weight:700;line-height:1.2}
.commentary-section__doc-title{margin:0 0 .85rem;font-family:var(--dna-font-heading,Georgia,serif);font-size:1.1rem}
.commentary-dek{margin:0 0 1rem;font-size:1.05rem;line-height:1.5;color:color-mix(in srgb,var(--dna-ink,#111) 75%,var(--dna-paper,#fff))}
.prose-rail{max-width:42rem}
.prose-rail .prose-p,.prose-rail .prose-subh,.prose-rail .prose-signoff{max-width:42rem}
.prose-subh{margin:1.35rem 0 .55rem;font-family:var(--dna-font-heading,Georgia,serif);font-size:1.15rem;font-weight:700;line-height:1.3}
.prose-ul{margin:.5rem 0 1rem;padding-left:1.2rem}
.prose-li{margin:.35rem 0;line-height:1.55}
.prose-signoff{margin:1.5rem 0 .35rem;font-weight:600}
.download-list{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
.download-list li{padding:.85rem 0;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent)}
.dl-label{display:block;font-weight:600}
.dl-note{display:block;margin-top:.25rem;font-size:.9rem;color:color-mix(in srgb,var(--dna-ink,#111) 62%,var(--dna-paper,#fff))}
.note-block{margin:1.5rem 0 1rem;padding-top:.5rem;scroll-margin-top:5rem}
.note-title{font-family:var(--dna-font-heading,Georgia,serif);font-size:1.1rem;margin:0 0 .65rem}
.note-block .prose-p{margin:.4rem 0;line-height:1.55}
`.trim();
