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

/** Baseline chrome CSS (DNA tokens; no external font CDN). */
export const CHROME_CSS = `
.site-nav{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--dna-paper,#fff) 92%,var(--dna-ink,#111));border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 18%,transparent);backdrop-filter:blur(8px)}
.site-nav .nav-row{display:flex;flex-wrap:wrap;align-items:center;gap:.15rem .5rem;list-style:none;margin:0 auto;padding:.55rem clamp(1rem,3vw,2rem);max-width:1120px}
.site-nav a,.site-nav .nav-dd-btn{font-family:var(--dna-font-body,Georgia,"Times New Roman",serif);font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:var(--dna-ink,#231F20);text-decoration:none;background:none;border:0;padding:.45rem .55rem;cursor:pointer}
.site-nav a[aria-current="page"],.site-nav .is-active>a,.site-nav .is-active>.nav-dd-btn{color:var(--dna-brand,#B8912A);font-weight:600}
.nav-dd{position:relative}
.nav-dd-menu{display:none;position:absolute;left:0;top:100%;min-width:14rem;margin:0;padding:.35rem 0;list-style:none;background:var(--dna-paper,#fff);border:1px solid color-mix(in srgb,var(--dna-ink,#111) 22%,transparent);box-shadow:0 8px 24px rgba(0,0,0,.08)}
.nav-dd:hover .nav-dd-menu,.nav-dd:focus-within .nav-dd-menu{display:block}
.nav-dd-menu a{display:block;text-transform:none;letter-spacing:0;font-size:.88rem;padding:.4rem .85rem}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.35rem .5rem;align-items:center;max-width:1120px;margin:0 auto;padding:.85rem clamp(1rem,3vw,2rem) 0;font-family:var(--dna-font-body,Georgia,serif);font-size:.85rem;color:color-mix(in srgb,var(--dna-ink,#111) 72%,var(--dna-paper,#fff))}
.breadcrumb a{color:var(--dna-brand,#B8912A);text-decoration:none}
.bc-sep{opacity:.45}
.page-pager{display:flex;justify-content:space-between;gap:1rem;max-width:1120px;margin:2.5rem auto 0;padding:1.25rem clamp(1rem,3vw,2rem) 2.5rem;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 18%,transparent);font-family:var(--dna-font-body,Georgia,serif)}
.page-pager a{color:var(--dna-ink,#231F20);text-decoration:none;max-width:45%}
.page-pager .pager-lbl{display:block;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb,var(--dna-ink,#111) 55%,var(--dna-paper,#fff));margin-bottom:.2rem}
.page-pager .pager-next{text-align:right;margin-left:auto}
.page-pager .is-empty{flex:1}
`.trim();
