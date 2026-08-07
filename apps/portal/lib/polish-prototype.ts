/**
 * Deterministic readability / contrast / layout polish for assembled prototype HTML.
 * Injects (or replaces) a late <style data-rs-readable> block so future gens
 * and one-off backfills share the same WCAG-minded overrides without relying
 * on the model to get measure, leading, header contrast, nav fit, or centering right.
 */

const STYLE_ATTR = 'data-rs-readable="1"';

/** Override CSS — DNA tokens remain the color source; neutrals derive from ink/paper. */
export const READABLE_CSS = `
/* Results Studio — readable / AA contrast / layout overrides (DNA-derived) */
:root{
  --rs-meta:color-mix(in srgb,var(--dna-ink,#231F20) 92%,var(--dna-paper,#fff));
  --rs-rule:color-mix(in srgb,var(--dna-ink,#231F20) 32%,var(--dna-paper,#fff));
  --rs-header-bg:color-mix(in srgb,var(--dna-table-header-bg,#839097) 68%,var(--dna-ink,#231F20));
  --rs-header-bg-emph:color-mix(in srgb,var(--dna-table-header-bg,#839097) 48%,var(--dna-ink,#231F20));
  --rs-content:min(1120px,100%);
  --rs-prose:68ch;
  --rs-pad:clamp(1rem,3.2vw,2rem);
  --n-muted:var(--rs-meta);
  --n-rule:var(--rs-rule);
}

/* Page shell — never horizontal-scroll the document */
html,body{
  overflow-x:hidden!important;
  max-width:100%;
}
body{
  box-sizing:border-box;
}

/* Sticky nav — wrap onto multiple rows; no overflow-x scrollbar; all items visible.
   Specifiers include .nav (common model class) so we beat overflow-x:auto / nowrap. */
nav,
nav.nav,
.nav,
header nav,
.masthead nav,
.site-nav,
.top-nav,
.nav-bar,
.nav-links,
.nav-row,
[data-dna-component="sticky-nav"],
[data-dna-component="masthead"] nav,
[data-dna-component="site-nav"],
[role="navigation"]{
  overflow-x:visible!important;
  overflow-y:visible!important;
  max-width:100%;
  white-space:normal!important;
  box-sizing:border-box;
}
nav ul,
nav.nav ul,
.nav ul,
header nav ul,
.masthead nav ul,
.site-nav ul,
.top-nav ul,
.nav-links,
.nav-row ul,
[role="navigation"] ul{
  display:flex!important;
  flex-wrap:wrap!important;
  align-items:center;
  gap:.3rem .55rem;
  row-gap:.15rem;
  margin:0;
  padding:0;
  list-style:none;
  overflow-x:visible!important;
  overflow-y:visible!important;
  max-width:100%;
  white-space:normal!important;
  scrollbar-width:none!important;
}
nav ul::-webkit-scrollbar,
.nav ul::-webkit-scrollbar{
  display:none!important;
  width:0!important;
  height:0!important;
}
nav li,
.nav li,
.nav-links li,
[role="navigation"] li{
  flex:0 1 auto;
  max-width:100%;
}
nav a,
nav.nav a,
.nav a,
nav button,
.nav-links a,
.site-nav a,
.top-nav a,
[role="navigation"] a{
  white-space:normal!important;
  overflow-wrap:anywhere;
  word-break:normal;
  line-height:1.25;
  font-size:clamp(.68rem,.7vw + .52rem,.8rem);
  letter-spacing:.04em!important;
  padding:.45rem .55rem!important;
}
/* Kill common model patterns that force a horizontal nav scroller */
nav[style*="overflow"],
.nav[style*="overflow"],
.nav-links[style*="overflow"],
.site-nav[style*="overflow"]{
  overflow-x:visible!important;
}

/* Centered content column — proportion to viewport; comfortable padding */
main,
.wrap,
.shell,
.container,
.page,
.inner,
.content,
.content-wrap,
.page-inner,
.layout,
.site-main,
[data-dna-component="page-shell"]{
  width:100%;
  max-width:var(--rs-content);
  margin-inline:auto;
  padding-inline:var(--rs-pad);
  box-sizing:border-box;
}
/* Section bands that aren't full-bleed heroes still sit in the centered column */
main > section,
.wrap > section,
.shell > section,
.container > section,
.page > section,
main > article,
.wrap > article{
  width:100%;
  max-width:var(--rs-content);
  margin-inline:auto;
  box-sizing:border-box;
}
/* Full-bleed exceptions (hero / masthead / footer strips keep edge-to-edge) */
header.masthead,
.masthead,
[data-dna-component="hero-banner"],
[data-dna-component="footer-strip"],
footer{
  max-width:none;
  width:100%;
}
/* But nav *inside* a full-bleed masthead still centers its row */
header.masthead > .wrap,
header.masthead > .inner,
header.masthead > .container,
.masthead > .wrap,
.masthead > .inner,
.masthead > .container,
[data-dna-component="hero-banner"] > .wrap,
[data-dna-component="hero-banner"] > .inner,
footer > .wrap,
footer > .inner,
footer > .container{
  max-width:var(--rs-content);
  margin-inline:auto;
  padding-inline:var(--rs-pad);
  box-sizing:border-box;
}

/* Section title rows / page meta — never washed grey */
.sec-head .num,
.sec-head .pg,
.contmark,
.panel .lbl,
.footnote,
.tbl-note,
.scrollhint,
.sig .role,
.kpi .k-label,
.chart-legend,
.svg-unit{
  color:var(--rs-meta)!important;
}
.sec-head{
  border-bottom:2px solid color-mix(in srgb,var(--dna-ink,#231F20) 45%,var(--dna-brand,#FCAF17));
  max-width:var(--rs-content);
  margin-inline:auto;
  width:100%;
  box-sizing:border-box;
}
.contmark::before,
.contmark::after,
.kicker{
  border-color:var(--rs-rule);
}
.kicker{
  border-top:1px solid var(--rs-rule);
  border-bottom:1px solid var(--rs-rule);
}

/* Prose — comfortable web reading measure + leading + centered column */
.prose,
article.prose,
[data-dna-component="letter-prose"],
[data-dna-component="letter-block"],
[data-dna-component="note-block"] .prose,
.rs-letter-miss,
.rs-coverage-appendix .rs-letter-miss{
  max-width:var(--rs-prose);
  margin-inline:auto;
  width:100%;
  box-sizing:border-box;
}
.prose,
article.prose,
[data-dna-component="letter-prose"],
[data-dna-component="letter-block"],
.rs-letter-miss{
  line-height:1.65;
}
.prose p,
article.prose p,
[data-dna-component="letter-prose"] p,
[data-dna-component="letter-block"] p,
.rs-letter-miss p,
.rs-coverage-appendix .rs-letter-miss p{
  max-width:var(--rs-prose);
  line-height:1.65;
  margin:0 0 1.28em;
  color:var(--dna-ink,#231F20);
}
.prose h3,
article.prose h3,
[data-dna-component="letter-prose"] h3{
  margin:2.15em 0 .85em;
  line-height:1.3;
}
.prose h4,
article.prose h4,
[data-dna-component="letter-prose"] h4{
  margin:1.8em 0 .7em;
  line-height:1.35;
  color:color-mix(in srgb,var(--dna-ink,#231F20) 90%,var(--dna-paper,#fff));
}
.prose ul,
.prose ol,
article.prose ul,
article.prose ol{
  margin:0 0 1.35em;
  line-height:1.65;
  max-width:var(--rs-prose);
}
.prose li,
article.prose li{
  margin:0 0 .55em;
}
.kicker{
  margin-bottom:1.75em;
  line-height:1.5;
  max-width:var(--rs-prose);
  margin-inline:auto;
}

/* KPI / chart / statement blocks — centered, wider than prose */
.kpi-row,
.kpis,
[data-dna-component="kpi-card"],
[data-dna-component="chart-block"],
[data-dna-component="statement-table"],
[data-dna-component="note-block"],
.panel,
.statement,
.statements,
.rs-coverage-appendix{
  max-width:var(--rs-content);
  margin-inline:auto;
  width:100%;
  box-sizing:border-box;
}

/* Tables — horizontal scroll ONLY on table wrappers, never the page */
.tbl-wrap,
.table-wrap,
.tbl-scroll,
.scroll-x,
[data-dna-component="statement-table"] .scroll,
[data-dna-component="statement-table"] > div{
  max-width:100%;
  overflow-x:auto;
  -webkit-overflow-scrolling:touch;
}
table{
  max-width:none;
}

/* Statement tables — header text must meet AA vs header bg; first column readable */
thead th,
.rs-coverage-appendix thead th{
  background:var(--rs-header-bg)!important;
  color:var(--dna-table-header-text,#fff)!important;
}
thead th:first-child,
.rs-coverage-appendix thead th:first-child{
  background:var(--rs-header-bg)!important;
  color:var(--dna-table-header-text,#fff)!important;
  text-align:left;
}
/* Current-period shading must never replace thead with light paper fill */
table[data-cur-col~="2"] thead th:nth-child(2),
table[data-cur-col~="3"] thead th:nth-child(3),
table[data-cur-col~="4"] thead th:nth-child(4),
table[data-cur-col~="5"] thead th:nth-child(5){
  background:var(--rs-header-bg-emph)!important;
  color:var(--dna-table-header-text,#fff)!important;
}
tbody td:first-child,
tbody th[scope="row"],
.rs-coverage-appendix th[scope="row"],
.rs-coverage-appendix td:first-child,
.rs-coverage-appendix th:first-child{
  color:var(--dna-ink,#231F20)!important;
  font-weight:600;
}
caption{
  color:var(--dna-ink,#231F20);
}
`.trim();

function styleTag(): string {
  return `<style ${STYLE_ATTR}>\n${READABLE_CSS}\n</style>`;
}

/**
 * Inject or replace the readable/contrast override stylesheet.
 * Idempotent; safe to run after ensureContentCoverage and on refine.
 */
export function polishPrototypeHtml(html: string): string {
  if (!html || !html.trim()) return html;
  const tag = styleTag();
  // Replace prior polish block if present.
  let out = html.replace(/<style\s+data-rs-readable="1"[\s\S]*?<\/style>\s*/gi, "");
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${tag}\n</head>`);
  } else if (/<html[\s>]/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`);
  } else {
    out = tag + out;
  }
  return out;
}
