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

  const homeHref = hrefFrom(currentPath, "index.html");
  const brandLabel = (company?.trim() || "Results").toUpperCase();
  const mark = logoHref
    ? `<img class="nav-brand__logo" src="${escapeHtml(logoHref)}" alt="" width="140" height="36" decoding="async">`
    : `<span class="nav-brand__mark" aria-hidden="true"></span>`;
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

/** Site-wide identity footer — company / period only (no invented figures). */
export function renderSiteFooter(
  company?: string,
  periodLabel?: string,
  logoHref?: string,
): string {
  const brand = company?.trim() || "Investor results";
  const period = periodLabel?.trim();
  const logo = logoHref
    ? `<img class="site-footer__logo" src="${escapeHtml(logoHref)}" alt="" width="120" height="32" decoding="async">`
    : "";
  return `<footer class="site-footer" data-dna-component="site-footer"><div class="site-footer__accent" aria-hidden="true"></div><div class="site-footer__inner">${logo}<p class="site-footer__brand" data-allow-number>${escapeHtml(brand)}</p>${
    period
      ? `<p class="site-footer__period" data-allow-number>${escapeHtml(period)}</p>`
      : ""
  }<p class="site-footer__note">Condensed consolidated results — interactive microsite</p></div></footer>`;
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

/**
 * Designed IR chrome CSS — DNA tokens only (no Inter CDN / purple themes).
 * Brand accents use --dna-brand / --dna-masthead from locked DesignDNA.
 */
export const CHROME_CSS = `
/* rs-ir-chrome — dense DNA-matched type scale (Open Sans; no Inter CDN) */
html{scroll-behavior:smooth;font-size:16px}
body{margin:0;color:var(--dna-ink,#231F20);background:var(--dna-paper,#fff);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.9375rem;line-height:1.5;letter-spacing:-.005em;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.site-nav{position:sticky;top:0;z-index:40;background:var(--dna-masthead,#0F3B2E);border-bottom:3px solid var(--dna-brand,#FCAF17);box-shadow:0 8px 28px rgba(15,59,46,.22)}
.site-nav .nav-inner{display:flex;align-items:center;gap:1rem;max-width:1120px;margin:0 auto;padding:0 clamp(1rem,3vw,2rem);min-height:4.5rem}
.nav-brand{display:flex;align-items:center;gap:.65rem;text-decoration:none;flex-shrink:0;padding:.35rem 0;margin-right:.35rem}
.nav-brand__mark{width:10px;height:28px;background:linear-gradient(180deg,var(--dna-brand,#FCAF17),color-mix(in srgb,var(--dna-brand,#FCAF17) 40%,#000));border-radius:1px}
.nav-brand__logo{display:block;height:40px;width:auto;max-width:180px;object-fit:contain;filter:brightness(0) invert(1)}
.nav-brand--logo .nav-brand__name{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.nav-brand__name{font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:.72rem;font-weight:800;letter-spacing:.06em;color:var(--dna-paper,#fff);line-height:1.15;max-width:14ch}
.site-nav .nav-row{display:flex;flex-wrap:wrap;align-items:stretch;gap:0;list-style:none;margin:0;padding:0;flex:1;justify-content:flex-end}
.site-nav .nav-row>li{display:flex;align-items:stretch}
.site-nav a,.site-nav .nav-dd-btn{font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.7rem;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,.78);text-decoration:none;background:none;border:0;padding:0 .8rem;cursor:pointer;display:inline-flex;align-items:center;min-height:4.5rem}
.site-nav a:hover,.site-nav .nav-dd-btn:hover{color:#fff;background:rgba(255,255,255,.06)}
.site-nav a[aria-current="page"],.site-nav .is-active>a,.site-nav .is-active>.nav-dd-btn{color:#fff;font-weight:700;box-shadow:inset 0 -3px 0 var(--dna-brand,#FCAF17)}
.site-nav a.nav-brand,.site-nav a.nav-brand:hover{background:transparent;box-shadow:none;padding:.35rem 0;min-height:0}
.nav-dd{position:relative}
.nav-dd-menu{display:none;position:absolute;right:0;left:auto;top:calc(100% - 2px);min-width:17rem;margin:0;padding:.45rem 0;list-style:none;background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 94%,#000);border:1px solid rgba(255,255,255,.1);border-top:2px solid var(--dna-brand,#FCAF17);box-shadow:0 16px 40px rgba(0,0,0,.28);z-index:50}
.nav-dd:hover .nav-dd-menu,.nav-dd:focus-within .nav-dd-menu,.nav-dd.is-open .nav-dd-menu{display:block}
.nav-dd-menu a{display:block;text-transform:none;letter-spacing:0;font-size:.9rem;padding:.55rem 1.1rem;border-radius:0;min-height:0;color:rgba(255,255,255,.88)}
.nav-dd-menu a:hover,.nav-dd-menu a[aria-current="page"]{background:rgba(255,255,255,.08);color:#fff;box-shadow:none}
.nav-toggle{display:none;flex-direction:column;justify-content:center;gap:5px;margin-left:auto;padding:.45rem;background:none;border:0;cursor:pointer}
.nav-toggle span{display:block;width:22px;height:2px;background:var(--dna-paper,#fff);border-radius:1px}
.nav-mobile{display:none;flex-direction:column;gap:0;padding:.35rem clamp(1rem,3vw,2rem) 1rem;border-top:1px solid rgba(255,255,255,.12);background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 96%,#000)}
.nav-mobile.is-open{display:flex}
.nav-mobile__link{display:block;padding:.75rem .35rem;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.95rem;color:rgba(255,255,255,.88);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.1);min-height:0}
.nav-mobile__link.is-active,.nav-mobile__link[aria-current="page"]{color:var(--dna-brand,#FCAF17);font-weight:700}
.nav-mobile__sub{padding-left:1.1rem;font-size:.9rem}
.nav-mobile__heading{padding:.65rem .35rem .2rem;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:700}
@media (max-width:820px){
  .site-nav .nav-row{display:none}
  .nav-toggle{display:flex}
  .nav-mobile.is-open{display:flex}
  .nav-brand__name{max-width:18ch;font-size:.72rem}
}
.share-bar{display:flex;gap:.55rem;align-items:center;max-width:1120px;margin:0 auto;padding:.55rem clamp(1rem,3vw,2rem) 0;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif)}
.share-bar button,.share-bar a{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 58%,var(--dna-paper,#fff));background:none;border:0;padding:.4rem .5rem;cursor:pointer;text-decoration:none}
.share-bar button:hover,.share-bar a:hover{color:var(--dna-masthead,#0F3B2E)}
#share-tooltip{position:absolute;z-index:200;display:none;gap:.35rem;background:var(--dna-masthead,#0F3B2E);color:var(--dna-paper,#fff);border-radius:4px;padding:.4rem .5rem;box-shadow:0 10px 28px rgba(15,59,46,.22);transform:translateX(-50%);pointer-events:none}
#share-tooltip.is-visible{display:flex;pointer-events:auto}
.share-tip-btn{font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--dna-paper,#fff);background:transparent;border:0;padding:.35rem .55rem;cursor:pointer}
.share-tip-btn:hover{color:var(--dna-brand,#FCAF17)}
mark.user-mark{background:color-mix(in srgb,var(--dna-brand,#FCAF17) 32%,transparent);color:inherit;border-radius:2px;padding:0 2px;box-shadow:0 0 0 1px color-mix(in srgb,var(--dna-brand,#FCAF17) 45%,transparent)}
.reveal,.kpi-card{opacity:0;transform:translateY(16px);transition:opacity .6s ease,transform .6s ease}
.reveal.is-visible,.reveal.revealed,.kpi-card.is-visible,.kpi-card.revealed{opacity:1;transform:none}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(15.5rem,1fr));gap:1rem;margin:0}
.kpi-card{display:flex;flex-direction:column;gap:.55rem;padding:1.25rem 1.25rem 1.1rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);background:var(--dna-paper,#fff);border-left:4px solid var(--dna-brand,#FCAF17);min-height:9.5rem;box-shadow:0 1px 0 color-mix(in srgb,var(--dna-ink,#111) 6%,transparent)}
.kpi-card:nth-child(even){border-left-color:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 55%,var(--dna-brand,#FCAF17))}
.kpi-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:.65rem}
.kpi-title{margin:0;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:var(--dna-masthead,#0F3B2E);line-height:1.3}
.kpi-delta{margin:0;flex-shrink:0;font-size:.72rem;font-weight:700;letter-spacing:.02em;color:var(--dna-masthead,#0F3B2E);background:color-mix(in srgb,var(--dna-brand,#FCAF17) 22%,var(--dna-paper,#fff));padding:.2rem .45rem;border-radius:2px;white-space:nowrap}
.kpi-value{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.5rem,2.6vw,1.9rem);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.025em;color:var(--dna-ink,#231F20);line-height:1.08}
.kpi-label{margin:0;font-size:.78rem;line-height:1.4;color:color-mix(in srgb,var(--dna-ink,#111) 62%,var(--dna-paper,#fff))}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.35rem .5rem;align-items:center;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.8rem;color:color-mix(in srgb,var(--dna-ink,#111) 60%,var(--dna-paper,#fff));margin:0 0 .9rem}
.breadcrumb a{color:var(--dna-masthead,#0F3B2E);text-decoration:none;font-weight:600}
.bc-sep{opacity:.4}
.page-pager{display:flex;justify-content:space-between;gap:1rem;max-width:1120px;margin:2.5rem auto 0;padding:1.5rem clamp(1rem,3vw,2rem);border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 14%,transparent);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif)}
.page-pager a{color:var(--dna-ink,#231F20);text-decoration:none;max-width:45%;padding:.35rem 0}
.page-pager a:hover .pager-title{color:var(--dna-masthead,#0F3B2E)}
.page-pager .pager-lbl{display:block;font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 50%,var(--dna-paper,#fff));margin-bottom:.3rem;font-weight:700}
.page-pager .pager-title{font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.05rem;font-weight:700}
.page-pager .pager-next{text-align:right;margin-left:auto}
.page-pager .is-empty{flex:1}
.site-footer{margin-top:0;background:var(--dna-masthead,#0F3B2E);color:rgba(255,255,255,.82)}
.site-footer__accent{height:3px;background:linear-gradient(90deg,var(--dna-footer-accent,var(--dna-brand,#FCAF17)) 0%,var(--dna-footer-accent,var(--dna-brand,#FCAF17)) 28%,transparent 28%)}
.site-footer__inner{max-width:1120px;margin:0 auto;padding:1.75rem clamp(1rem,3vw,2rem) 2.25rem;display:grid;gap:.35rem}
.site-footer__logo{display:block;height:32px;width:auto;max-width:140px;object-fit:contain;margin-bottom:.35rem;filter:brightness(0) invert(1);opacity:.92}
.site-footer__brand{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.05rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--dna-brand,#FCAF17)}
.site-footer__period{margin:0;font-size:.92rem;font-weight:600;color:rgba(255,255,255,.9)}
.site-footer__note{margin:.35rem 0 0;font-size:.78rem;letter-spacing:.04em;color:rgba(255,255,255,.5)}
.page-hero{max-width:1120px;margin:0 auto;padding:1.75rem clamp(1rem,3vw,2rem) 1.35rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 7%,var(--dna-paper,#fff)),var(--dna-paper,#fff) 72%)}
.page-hero__eyebrow{margin:0 0 .45rem;font-size:.7rem;letter-spacing:.11em;text-transform:uppercase;color:var(--dna-brand,#FCAF17);font-weight:700}
.page-hero h1{margin:0 0 .45rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.55rem,2.8vw,2.15rem);font-weight:700;line-height:1.18;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.02em}
.page-hero__sub{margin:0;font-size:.95rem;color:color-mix(in srgb,var(--dna-ink,#111) 68%,var(--dna-paper,#fff));max-width:42rem}
.page-title-banner{max-width:1120px;margin:0 auto;padding:1.25rem clamp(1rem,3vw,2rem) .5rem}
.page-title-banner h1{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.35rem,2.4vw,1.85rem);font-weight:700;color:var(--dna-masthead,#0F3B2E)}
.home-hero{position:relative;max-width:none;margin:0;padding:0;background:linear-gradient(135deg,var(--dna-masthead,#0F3B2E) 0%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 82%,#000) 48%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 70%,var(--dna-brand,#FCAF17)) 100%);color:var(--dna-paper,#fff);border-bottom:0;overflow:hidden;min-height:min(72vh,36rem)}
.home-hero--photo{background:var(--dna-masthead,#0F3B2E)}
.home-hero__photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 28%;opacity:.48;pointer-events:none}
/* Ultra-wide extraction strips — keep cinematic band, slightly stronger presence */
.home-hero--strip .home-hero__photo{object-fit:cover;object-position:center 40%;opacity:.55;transform:scale(1.04)}
/* Full page-1 render fallback — crop to upper masthead, not mid-page tables */
.home-hero--page .home-hero__photo{object-fit:cover;object-position:center 12%;opacity:.38}
.home-hero--photo::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 92%,#000) 0%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 55%,transparent) 55%,color-mix(in srgb,var(--dna-masthead,#0F3B2E) 35%,transparent) 100%);pointer-events:none}
.home-hero__mast{height:5px;background:linear-gradient(90deg,var(--dna-brand,#FCAF17) 0%,var(--dna-brand,#FCAF17) 36%,rgba(255,255,255,.35) 36%,rgba(255,255,255,.35) 100%);position:relative;z-index:1}
.home-hero__lockup{display:flex;align-items:center;gap:.85rem;margin:0 0 1.1rem}
.home-hero__logo{display:block;height:52px;width:auto;max-width:220px;object-fit:contain;filter:brightness(0) invert(1)}
.home-hero__inner{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:clamp(3.2rem,8vh,4.4rem) clamp(1rem,3vw,2rem) clamp(2.8rem,6vh,3.6rem)}
.home-kicker{margin:0 0 .65rem;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--dna-brand,#FCAF17);font-weight:700;max-width:40rem}
.home-hero h1{margin:0 0 .7rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(2.4rem,5vw,3.5rem);line-height:1.02;letter-spacing:-.035em;color:#fff;font-weight:800;max-width:12ch}
.home-period{margin:0 0 1rem;font-size:clamp(1.02rem,1.8vw,1.22rem);color:rgba(255,255,255,.86);max-width:38rem;font-weight:600;letter-spacing:-.01em}
.home-lede{margin:0 0 1.15rem;max-width:38rem;font-size:1.02rem;line-height:1.55;color:rgba(255,255,255,.78);letter-spacing:-.005em}
.home-meta{display:flex;flex-wrap:wrap;gap:.45rem .65rem;margin:0 0 1.55rem}
.home-meta__chip{display:inline-block;padding:.4rem .7rem;font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18)}
.home-cta{display:flex;flex-wrap:wrap;gap:.85rem 1.15rem;align-items:center}
.home-cta__primary{display:inline-block;padding:.85rem 1.45rem;background:var(--dna-brand,#FCAF17);color:var(--dna-ink,#231F20)!important;text-decoration:none;font-size:.92rem;font-weight:800;letter-spacing:.02em;border:1px solid transparent}
.home-cta__primary:hover{filter:brightness(1.03)}
.home-cta__secondary{color:#fff;font-size:.92rem;font-weight:700;text-decoration:none;border-bottom:2px solid color-mix(in srgb,var(--dna-brand,#FCAF17) 80%,transparent);padding-bottom:2px}
.home-body,.prose-body,.page-statement{max-width:1120px;margin:0 auto;padding:2rem clamp(1rem,3vw,2rem) 1.75rem;display:grid;gap:2.6rem}
.home-body{margin-top:-1.75rem;position:relative;z-index:1;padding-top:0}
.kpi-band{background:var(--dna-paper,#fff);border:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);padding:1.5rem 1.35rem 1.35rem;box-shadow:0 18px 40px rgba(15,59,46,.1)}
.section-hdr{margin:0 0 1.2rem;padding-bottom:.7rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.5rem 1.25rem}
.section-hdr__title{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.45rem,2.4vw,1.9rem);font-weight:800;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.02em}
.section-hdr__sub{margin:0;font-size:.88rem;color:color-mix(in srgb,var(--dna-ink,#111) 55%,var(--dna-paper,#fff))}
.kpi-band .section-hdr{border-bottom-color:color-mix(in srgb,var(--dna-brand,#FCAF17) 45%,transparent)}
.highlights .prose-p,.prose-p{margin:.45rem 0;line-height:1.65}
.prose-lead{font-size:1.08rem;line-height:1.7;color:color-mix(in srgb,var(--dna-ink,#111) 88%,var(--dna-paper,#fff))}
.highlights-band .highlight-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(22rem,1fr));gap:.85rem}
.highlight-item{padding:1.05rem 1.2rem;border-left:3px solid var(--dna-brand,#FCAF17);background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 45%,var(--dna-paper,#fff));font-size:.95rem;line-height:1.55}
.explore-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(17rem,1fr));gap:1.15rem}
.explore-card{display:flex;gap:.95rem;align-items:flex-start;padding:1.4rem 1.35rem 1.2rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);background:var(--dna-paper,#fff);color:inherit;text-decoration:none;min-height:11rem;transition:border-color .2s ease,transform .2s ease,box-shadow .2s ease;border-top:3px solid transparent}
.explore-card:hover{border-color:color-mix(in srgb,var(--dna-ink,#111) 18%,transparent);border-top-color:var(--dna-brand,#FCAF17);transform:translateY(-3px);box-shadow:0 14px 32px rgba(15,59,46,.1)}
.explore-n{font-size:.72rem;letter-spacing:.1em;color:var(--dna-brand,#FCAF17);font-weight:800;flex-shrink:0;padding-top:.2rem}
.explore-card__body{display:flex;flex-direction:column;gap:.45rem;min-width:0;flex:1}
.explore-label{font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.2rem;font-weight:800;line-height:1.25;color:var(--dna-masthead,#0F3B2E)}
.explore-desc{font-size:.9rem;line-height:1.5;color:color-mix(in srgb,var(--dna-ink,#111) 68%,var(--dna-paper,#fff))}
.explore-cta{margin-top:auto;padding-top:.45rem;font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;color:var(--dna-masthead,#0F3B2E);font-weight:700}
.commentary-toc{display:flex;flex-wrap:wrap;align-items:baseline;gap:.75rem 1.35rem;padding:1.1rem 1.15rem 1.25rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);border-left:3px solid var(--dna-brand,#FCAF17);margin-bottom:.5rem;background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 40%,var(--dna-paper,#fff))}
.commentary-toc__label{margin:0;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 52%,var(--dna-paper,#fff));font-weight:700}
.commentary-toc__links{display:flex;flex-wrap:wrap;gap:.55rem 1.15rem}
.commentary-toc__link{color:var(--dna-masthead,#0F3B2E);text-decoration:none;font-size:.95rem;font-weight:600}
.commentary-toc__link:hover{color:var(--dna-brand,#FCAF17)}
.commentary-section{scroll-margin-top:5.5rem;padding:2rem 0 2.15rem;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent)}
.commentary-section:last-of-type{border-bottom:0}
.commentary-section__hdr{margin:0 0 1.35rem;max-width:42rem;padding-left:1rem;border-left:3px solid var(--dna-brand,#FCAF17)}
.commentary-section__eyebrow{margin:0 0 .4rem;font-size:.7rem;letter-spacing:.11em;text-transform:uppercase;color:var(--dna-brand,#FCAF17);font-weight:700}
.commentary-section__title{margin:0;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:clamp(1.5rem,2.5vw,1.95rem);font-weight:800;line-height:1.18;color:var(--dna-masthead,#0F3B2E);letter-spacing:-.02em}
.commentary-section__doc-title{margin:0 0 .9rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.12rem;font-weight:700}
.commentary-dek{margin:0 0 1.15rem;font-size:1.12rem;line-height:1.6;color:color-mix(in srgb,var(--dna-ink,#111) 78%,var(--dna-paper,#fff));font-weight:600}
.prose-rail{max-width:42rem}
.prose-rail .prose-p,.prose-rail .prose-subh,.prose-rail .prose-signoff{max-width:42rem}
.prose-subh{margin:1.7rem 0 .65rem;font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.18rem;font-weight:700;line-height:1.3;color:var(--dna-masthead,#0F3B2E)}
.prose-ul{margin:.55rem 0 1.1rem;padding-left:1.25rem}
.prose-li{margin:.45rem 0;line-height:1.65}
.prose-signoff{margin:1.75rem 0 .4rem;font-weight:700}
.download-list{list-style:none;margin:0;padding:0;display:grid;gap:.85rem}
.download-list li{padding:1.05rem 0;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent)}
.dl-link{display:block;color:inherit;text-decoration:none}
.dl-link:hover .dl-label{color:var(--dna-masthead,#0F3B2E)}
.dl-label{display:block;font-weight:700;font-size:1.02rem}
.dl-note{display:block;margin-top:.3rem;font-size:.9rem;color:color-mix(in srgb,var(--dna-ink,#111) 60%,var(--dna-paper,#fff))}
.xls-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.7rem 1.1rem;max-width:1120px;margin:0 auto;padding:.9rem clamp(1rem,3vw,2rem) .2rem;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 40%,var(--dna-paper,#fff));border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent)}
.xls-toolbar__label{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--dna-brand,#FCAF17)}
.xls-download{font-size:.86rem;color:var(--dna-masthead,#0F3B2E);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--dna-brand,#FCAF17) 60%,transparent);font-weight:600}
.xls-download:hover{color:var(--dna-ink,#231F20)}
.xls-download--secondary{border-bottom-color:color-mix(in srgb,var(--dna-ink,#111) 22%,transparent);color:color-mix(in srgb,var(--dna-ink,#111) 70%,var(--dna-paper,#fff));font-weight:500}
.note-block{margin:1.75rem 0 1.15rem;padding-top:.65rem;scroll-margin-top:5.5rem;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 8%,transparent)}
.note-title{font-family:var(--dna-font-heading,"Open Sans","Segoe UI",sans-serif);font-size:1.15rem;margin:0 0 .7rem;color:var(--dna-masthead,#0F3B2E);font-weight:700}
.note-block .prose-p{margin:.4rem 0;line-height:1.55}
.statement-unit{display:flex;flex-wrap:wrap;align-items:baseline;gap:.4rem .75rem;margin:0 0 .55rem;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;font-weight:700;color:color-mix(in srgb,var(--dna-ink,#111) 58%,var(--dna-paper,#fff))}
.statement-unit__value{color:var(--dna-masthead,#0F3B2E);font-weight:800}
`.trim();

