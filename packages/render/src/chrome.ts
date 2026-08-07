/**
 * Shared microsite chrome for multi-page SitePlan export:
 * sticky nav (Financials dropdown), breadcrumb, prev/next footer, SEO head.
 * Uses DNA CSS variables — no Inter / Google Fonts CDN.
 */

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
  return `<nav class="site-nav" data-dna-component="sticky-nav" aria-label="Primary"><ul class="nav-row">${items}</ul></nav>`;
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

/** Tiny chrome behaviours: Financials dropdown click + copy/share. */
export const CHROME_SCRIPT = `
(function(){
  document.querySelectorAll('.nav-dd-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var open=btn.getAttribute('aria-expanded')==='true';
      btn.setAttribute('aria-expanded', open?'false':'true');
      btn.parentElement && btn.parentElement.classList.toggle('is-open', !open);
    });
  });
  document.querySelectorAll('[data-share="copy"]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var url=location.href;
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(function(){btn.textContent='Copied'; setTimeout(function(){btn.textContent='Copy link'},1600)});
      }
    });
  });
  document.querySelectorAll('[data-share="linkedin"]').forEach(function(a){
    a.addEventListener('click',function(e){
      e.preventDefault();
      var u='https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(location.href);
      window.open(u,'_blank','noopener,noreferrer');
    });
  });
})();
`.trim();

/** Baseline chrome CSS (DNA tokens; no external font CDN). */
export const CHROME_CSS = `
.site-nav{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--dna-paper,#fff) 94%,var(--dna-ink,#111));border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 16%,transparent);backdrop-filter:blur(10px)}
.site-nav .nav-row{display:flex;flex-wrap:wrap;align-items:center;gap:.1rem .35rem;list-style:none;margin:0 auto;padding:.65rem clamp(1rem,3vw,2rem);max-width:1120px}
.site-nav a,.site-nav .nav-dd-btn{font-family:var(--dna-font-body,system-ui,sans-serif);font-size:.76rem;letter-spacing:.05em;text-transform:uppercase;color:var(--dna-ink,#231F20);text-decoration:none;background:none;border:0;padding:.5rem .6rem;cursor:pointer}
.site-nav a[aria-current="page"],.site-nav .is-active>a,.site-nav .is-active>.nav-dd-btn{color:var(--dna-brand,#B8912A);font-weight:700}
.nav-dd{position:relative}
.nav-dd-menu{display:none;position:absolute;left:0;top:calc(100% - 2px);min-width:15rem;margin:0;padding:.4rem 0;list-style:none;background:var(--dna-paper,#fff);border:1px solid color-mix(in srgb,var(--dna-ink,#111) 18%,transparent);box-shadow:0 10px 28px rgba(0,0,0,.1);z-index:50}
.nav-dd:hover .nav-dd-menu,.nav-dd:focus-within .nav-dd-menu,.nav-dd.is-open .nav-dd-menu{display:block}
.nav-dd-menu a{display:block;text-transform:none;letter-spacing:0;font-size:.9rem;padding:.45rem .95rem}
.share-bar{display:flex;gap:.5rem;align-items:center;max-width:1120px;margin:0 auto;padding:.45rem clamp(1rem,3vw,2rem) 0;font-family:var(--dna-font-body,system-ui,sans-serif)}
.share-bar button,.share-bar a{font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 60%,var(--dna-paper,#fff));background:none;border:0;padding:.35rem .45rem;cursor:pointer;text-decoration:none}
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
.home-hero{max-width:1120px;margin:0 auto;padding:2.25rem clamp(1rem,3vw,2rem) 1.25rem}
.home-kicker{margin:0 0 .35rem;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--dna-brand,#B8912A);font-weight:700}
.home-hero h1{margin:0 0 .5rem;font-family:var(--dna-font-heading,Georgia,serif);font-size:clamp(1.75rem,3.5vw,2.6rem);line-height:1.15}
.home-period{margin:0 0 1rem;color:color-mix(in srgb,var(--dna-ink,#111) 70%,var(--dna-paper,#fff));max-width:36rem}
.home-cta{display:flex;flex-wrap:wrap;gap:.75rem}
.home-cta a{color:var(--dna-brand,#B8912A);font-size:.9rem}
.home-body,.prose-body,.page-statement{max-width:1120px;margin:0 auto;padding:1rem clamp(1rem,3vw,2rem) 1.25rem;display:grid;gap:1.25rem}
.highlights .prose-p,.prose-p{margin:.35rem 0;line-height:1.55}
.explore-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.75rem}
.explore-card{display:flex;gap:.65rem;align-items:baseline;padding:.85rem 1rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 16%,transparent);color:inherit;text-decoration:none}
.explore-n{font-size:.72rem;letter-spacing:.06em;color:var(--dna-brand,#B8912A)}
.explore-label{font-family:var(--dna-font-heading,Georgia,serif)}
.download-list{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}
.download-list li{padding:.85rem 0;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent)}
.dl-label{display:block;font-weight:600}
.dl-note{display:block;margin-top:.25rem;font-size:.9rem;color:color-mix(in srgb,var(--dna-ink,#111) 62%,var(--dna-paper,#fff))}
.note-block{margin:1.5rem 0 1rem;padding-top:.5rem;scroll-margin-top:5rem}
.note-title{font-family:var(--dna-font-heading,Georgia,serif);font-size:1.1rem;margin:0 0 .65rem}
.note-block .prose-p{margin:.4rem 0;line-height:1.55}
`.trim();
