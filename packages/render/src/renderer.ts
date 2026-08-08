import type {
  Blueprint,
  ComponentDef,
  ComponentInstance,
  FinTable,
  SitePlan,
  SlotDef,
} from "@rs/contracts";
import {
  CHROME_CSS,
  collectFooterExtras,
  renderBreadcrumb,
  renderPrevNext,
  renderSelectionTooltip,
  renderShareBar,
  renderSiteFooter,
  renderStickyNav,
} from "./chrome.js";
import { enrichMultiPageFiles } from "./enrich.js";
import { extractHomeKpis, resolveDisplayPeriodLabel } from "./home-composer.js";
import { linkNoteRefHtml, notesBaseHref } from "./notes-linker.js";
import { findDocTable, resolveCell, type ResolveContext } from "./resolve.js";
import { fontFaceCss } from "./fonts.js";
import {
  classifyStatementRow,
  groupBorderClass,
  rowHasNumeric,
  rowRoleClass,
} from "./row-taxonomy.js";
import { composeSeoHead } from "./seo.js";
import { SITE_RUNTIME_JS, siteRuntimeHref } from "./site-runtime.js";

/**
 * Deterministic renderer. (SitePlan, FinancialDocModel, ExtractionResult,
 * Blueprint) → a file tree of HTML. Every numeric value is emitted inside a
 * `<span class="num" data-src="…">VERBATIM</span>` sourced from a resolved
 * reference — never from the SitePlan directly. Rendering identical inputs is
 * deterministic. A renderer bug is the ONLY way a wrong number can appear, and
 * the DOM audit exists to catch exactly that.
 */

export interface RenderResult {
  files: Record<string, string>;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The one place a number becomes markup. */
export function numberSpan(ref: string, verbatim: string): string {
  return `<span class="num" data-src="${escapeHtml(ref)}">${escapeHtml(verbatim)}</span>`;
}

/**
 * Latest-year column (0-based) from FinTable header matrix, or null.
 * On same-year ties prefer leftmost (current period is listed first in IR tables).
 */
function findCurrentPeriodCol(table: FinTable): number | null {
  let bestCol: number | null = null;
  let bestYear = -1;
  for (const row of table.header_matrix) {
    let col = 0;
    for (const h of row) {
      const years = [...h.raw.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
      const y = years.length ? Math.max(...years) : null;
      if (
        y != null &&
        (bestCol == null || y > bestYear || (y === bestYear && col < bestCol))
      ) {
        bestYear = y;
        bestCol = col;
      }
      col += Math.max(1, h.col_span ?? 1);
    }
  }
  return bestCol;
}

/** Stack IR period headers (As at / date / Rm / audit) without inventing text. */
function formatHeaderCellHtml(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const lead =
    "As at|For the (?:six months|year) ended|Six months ended|Year ended";
  // Full IR stack: "Six months ended 31 Dec 2025 Rm Unaudited"
  // Block spans only (no <br>) so headers stay dense and never double-gap.
  const full = t.match(
    new RegExp(`^(${lead})\\s+(.+?)\\s+(Rm|R'000|R million)\\s+(Unaudited|Audited)$`, "i"),
  );
  if (full) {
    return `<span class="h-fig__lead">${escapeHtml(full[1]!)}</span><span class="h-fig__date">${escapeHtml(full[2]!)}</span><span class="h-fig__unit">${escapeHtml(full[3]!)}</span><span class="h-fig__audit">${escapeHtml(full[4]!)}</span>`;
  }
  // Partial: "As at 31 Dec 2025" / "Six months ended 31 Dec 2025 Rm"
  const partial = t.match(new RegExp(`^(${lead})\\s+(.+)$`, "i"));
  if (partial) {
    const rest = partial[2]!.trim();
    const withUnit = rest.match(/^(.*?)\s+(Rm|R'000|R million)$/i);
    if (withUnit) {
      return `<span class="h-fig__lead">${escapeHtml(partial[1]!)}</span><span class="h-fig__date">${escapeHtml(withUnit[1]!)}</span><span class="h-fig__unit">${escapeHtml(withUnit[2]!)}</span>`;
    }
    return `<span class="h-fig__lead">${escapeHtml(partial[1]!)}</span><span class="h-fig__date">${escapeHtml(rest)}</span>`;
  }
  return escapeHtml(raw);
}

function noteColIndex(table: FinTable): number | null {
  for (const row of table.header_matrix) {
    let col = 0;
    for (const h of row) {
      if (/^notes?$/i.test(h.raw.trim())) return col;
      col += Math.max(1, h.col_span ?? 1);
    }
  }
  return null;
}

/**
 * Soft-break jammed OCI / long row labels for readability.
 * Display-only — data-src still points at the verbatim source cell.
 */
function formatLabelCellHtml(raw: string): string {
  let html = escapeHtml(raw);
  // Common Docling join: "...net of tax Net fair value..."
  html = html.replace(/(net of tax)\s+(Net fair value)/gi, "$1<br>$2");
  // Long run-ons: break once after a mid-label comma before a capital clause.
  if (html.length > 88 && !html.includes("<br>")) {
    html = html.replace(/,\s+(?=[A-Z])/g, (m, offset) =>
      offset > 36 && offset < html.length - 28 ? `,<br>` : m,
    );
  }
  return html;
}

/** Per-row unit column (ops/KPI / assumptions) — col 1 when most cells look like units. */
function unitColIndex(table: FinTable): number | null {
  if (noteColIndex(table) === 1) return null;
  const samples = table.rows
    .map((r) => r.cells[1]?.raw?.trim() ?? "")
    .filter(Boolean);
  if (samples.length < 2) return null;
  const unitLike = samples.filter((u) =>
    /^(kg|oz|%|R\b|US\$|R\/|years?\b|South African cents)/i.test(u),
  ).length;
  return unitLike >= Math.ceil(samples.length * 0.5) ? 1 : null;
}

/**
 * Prefer body width when header colspans were over-claimed (layout defense).
 * Clamps individual header spans so Σ spans === bodyColCount.
 */
function normalizedHeaderMatrix(
  table: FinTable,
  bodyColCount: number,
): FinTable["header_matrix"] {
  return table.header_matrix.map((row) => {
    const out: typeof row = [];
    let used = 0;
    for (const h of row) {
      if (used >= bodyColCount) break;
      let span = Math.max(1, h.col_span ?? 1);
      if (used + span > bodyColCount) span = bodyColCount - used;
      // Discrete Notes / figure cells after a title must not be absorbed.
      if (span > 1 && out.length === 0 && row.length > 1) {
        const restNeed = row.slice(1).reduce((n, x) => n + Math.max(1, x.col_span ?? 1), 0);
        if (used + span + restNeed > bodyColCount) span = 1;
      }
      out.push({ ...h, col_span: span });
      used += span;
    }
    return out;
  });
}

function renderFinTable(table: FinTable, notesBase: string | null): string {
  const bodyColCount = Math.max(...table.rows.map((r) => r.cells.length), 1);
  const header_matrix = normalizedHeaderMatrix(table, bodyColCount);
  const normTable = { ...table, header_matrix };
  const cur0 = findCurrentPeriodCol(normTable);
  const noteCol = noteColIndex(normTable);
  const unitCol = unitColIndex(normTable);
  const curAttr = cur0 != null ? ` data-cur-col="${cur0 + 1}"` : "";
  const colCount = bodyColCount;
  const figureCols = Array.from({ length: colCount }, (_, i) => i).filter(
    (i) => i !== 0 && i !== noteCol && i !== unitCol,
  ).length;
  // 3+ period columns (typical BS) need denser IR widths so labels/notes breathe.
  const densityAttr =
    colCount >= 5 && figureCols >= 3
      ? ` data-density="periods-3"`
      : noteCol != null
        ? ` data-density="notes"`
        : "";
  const cols = Array.from({ length: colCount }, (_, i) => {
    if (i === 0) return `<col class="c-label">`;
    if (noteCol != null && i === noteCol) return `<col class="c-note">`;
    if (unitCol != null && i === unitCol) return `<col class="c-unit">`;
    if (cur0 != null && i === cur0) return `<col class="c-cur">`;
    return `<col class="c-cmp">`;
  }).join("");

  const head = header_matrix
    .map((row) => {
      let col = 0;
      const cells = row
        .map((h) => {
          const start = col;
          const span = Math.max(1, h.col_span ?? 1);
          col += span;
          const isCur = cur0 != null && cur0 >= start && cur0 < start + span;
          const isNote = /^notes?$/i.test(h.raw.trim());
          const isTitle = start === 0 && !isNote && !/\b(19|20)\d{2}\b/.test(h.raw);
          // Header cells carry provenance too: they hold dates ("31 Dec 2025")
          // and unit labels whose digits must be traceable + verified. Empty
          // header slots (real tables are sparse) carry no data-src.
          const src = h.raw.trim() !== "" ? ` data-src="${escapeHtml(h.src_ref)}"` : "";
          const classes = [
            isCur ? "cur" : "",
            isNote ? "h-notes" : "",
            isTitle ? "h-title" : "",
            !isNote && !isTitle && h.raw.trim() ? "h-fig" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const cls = classes ? ` class="${classes}"` : "";
          const inner = isNote || isTitle ? escapeHtml(h.raw) : formatHeaderCellHtml(h.raw);
          return `<th${cls}${src}${span > 1 ? ` colspan="${span}"` : ""}${h.row_span > 1 ? ` rowspan="${h.row_span}"` : ""}>${inner}</th>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const roles = table.rows.map((row) =>
    classifyStatementRow(row.cells[0]?.raw ?? "", rowHasNumeric(row.cells)),
  );
  const body = table.rows
    .map((row, rowIdx) => {
      const role = roles[rowIdx]!;
      const prev = rowIdx > 0 ? roles[rowIdx - 1]! : null;
      const next = rowIdx < roles.length - 1 ? roles[rowIdx + 1]! : null;
      const trClass = `${rowRoleClass(role)}${groupBorderClass(role, prev, next)}`;
      let col = 0;
      const cells = row.cells
        .map((cell, cellIdx) => {
          const start = col;
          const span = Math.max(1, (cell as { col_span?: number }).col_span ?? 1);
          col += span;
          const isCur = cur0 != null && cur0 >= start && cur0 < start + span;
          const curCls = isCur ? " cur" : "";
          const cmpCls = !isCur && cell.kind === "number" ? " cmp" : "";
          if (cell.kind === "number") {
            return `<td class="cell-num${curCls}${cmpCls}">${numberSpan(cell.src_ref, cell.raw)}</td>`;
          }
          if (cell.kind === "noteRef" && cell.raw.trim() && notesBase) {
            const src = ` data-src="${escapeHtml(cell.src_ref)}"`;
            const linked = linkNoteRefHtml(cell.raw, notesBase, escapeHtml);
            return `<td class="cell-noteRef note${curCls}"${src}>${linked}</td>`;
          }
          // Every cell with CONTENT is provenance-tagged — text row-labels
          // ("Balance at 30 June 2024"), nil markers and note refs all carry
          // digits that must trace to their source cell (cell.raw is the
          // mapper's byte-for-byte copy). Empty grid slots — real Docling tables
          // omit cells — carry no digit and need no provenance.
          const src = cell.raw.trim() !== "" ? ` data-src="${escapeHtml(cell.src_ref)}"` : "";
          const labelCls = cellIdx === 0 ? " cell-label lbl" : "";
          const unitCls = unitCol != null && start === unitCol ? " cell-unit" : "";
          const noteEmpty =
            noteCol != null && start === noteCol ? " cell-noteRef note" : "";
          const inner =
            cellIdx === 0 && cell.raw.trim()
              ? formatLabelCellHtml(cell.raw)
              : escapeHtml(cell.raw);
          return `<td class="cell-${cell.kind}${labelCls}${unitCls}${noteEmpty}${curCls}"${src}>${inner}</td>`;
        })
        .join("");
      return `<tr class="${trClass}">${cells}</tr>`;
    })
    .join("");

  const unit = table.unit_context?.default?.trim();
  const unitHtml = unit
    ? `<p class="statement-unit" data-dna-component="statement-unit"><span>Unit</span><span class="statement-unit__value" data-allow-number>${escapeHtml(unit)}</span></p>`
    : "";

  // Section chrome already provides `.statement-table`; emit unit + table only.
  return `${unitHtml}<table class="fin-table"${curAttr}${densityAttr} data-table-src="${escapeHtml(table.src_table)}"><colgroup>${cols}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderSlot(
  slotName: string,
  slotDef: SlotDef,
  value: unknown,
  ctx: ResolveContext,
  notesBase: string | null,
): string {
  switch (slotDef.type) {
    case "text":
      return escapeHtml(String(value ?? ""));
    case "enum":
      return escapeHtml(String(value ?? ""));
    case "ref": {
      const ref = String(value ?? "");
      if (slotDef.accepts === "table") {
        const table = findDocTable(ref, ctx);
        return table
          ? renderFinTable(table, notesBase)
          : `<!-- unresolved table ${escapeHtml(ref)} -->`;
      }
      const raw = resolveCell(ref, ctx);
      if (raw === null) return `<!-- unresolved ref ${escapeHtml(ref)} -->`;
      return numberSpan(ref, raw);
    }
    case "asset":
      return `<!-- asset:${escapeHtml(String(value ?? ""))} -->`;
    case "chart":
      // A chart's value labels must still be traceable; emit them as number
      // spans alongside the config so the DOM audit covers the chart too.
      return renderChart(value, ctx);
  }
}

function renderChart(value: unknown, ctx: ResolveContext): string {
  const spec = value as { series?: Array<{ values?: string[] }> } | undefined;
  const labels: string[] = [];
  for (const s of spec?.series ?? []) {
    for (const ref of s.values ?? []) {
      const raw = resolveCell(ref, ctx);
      if (raw !== null) labels.push(numberSpan(ref, raw));
    }
  }
  const config = escapeHtml(JSON.stringify(spec ?? {}));
  return `<figure class="chart"><script type="application/json" data-dna-chart>${config}</script><div class="chart-values">${labels.join(" ")}</div></figure>`;
}

function renderComponent(
  def: ComponentDef,
  inst: ComponentInstance,
  ctx: ResolveContext,
  notesBase: string | null,
): string {
  let html = def.html;
  html = html.replace(/\{\{variant\}\}/g, escapeHtml(inst.variant ?? "default"));
  html = html.replace(/\{\{slot:([a-zA-Z0-9_]+)\}\}/g, (_m, slotName: string) => {
    const slotDef = def.slots[slotName];
    if (!slotDef) return "";
    return renderSlot(slotName, slotDef, inst.slots[slotName], ctx, notesBase);
  });
  return html;
}

export function renderSitePlan(
  plan: SitePlan,
  blueprint: Blueprint,
  ctx: ResolveContext,
): RenderResult {
  const components = new Map<string, ComponentDef>(blueprint.components.map((c) => [c.id, c]));
  const templates = new Map(blueprint.page_templates.map((t) => [t.id, t]));
  const files: Record<string, string> = {};
  const multiPage = plan.pages.length > 1 || plan.model === "deterministic-multipage";
  const company = ctx.docModel?.meta?.company;
  const periodLabel = ctx.docModel
    ? resolveDisplayPeriodLabel(ctx.docModel, ctx.extraction)
    : undefined;
  const docKind = ctx.docModel?.meta?.doc_kind;
  const currency = ctx.docModel?.meta?.currency;
  const homeKpis = ctx.docModel ? extractHomeKpis(ctx.docModel) : [];
  const footerExtras = ctx.docModel
    ? collectFooterExtras(ctx.docModel, ctx.extraction)
    : null;
  // Exclude legacy aggregate from prev/next so WW IA pages chain cleanly.
  const pageOrder = plan.pages
    .filter((p) => !p.path.startsWith("statements/"))
    .map((p) => ({ path: p.path, title: p.title }));

  for (const page of plan.pages) {
    const tpl = templates.get(page.template);
    const notesBase = notesBaseHref(page.path);
    // Breadcrumb lives in page-hero for financial pages (enrich); keep top crumb elsewhere.
    const crumbInHero =
      multiPage &&
      (page.path.startsWith("financials/") ||
        page.path.startsWith("statements/") ||
        page.path === "commentary.html" ||
        page.path === "administration.html" ||
        page.path === "downloads.html");
    let shell = tpl?.shell_html ?? "<main>{{region:main}}</main>";
    shell = shell.replace(/\{\{region:([a-zA-Z0-9_-]+)\}\}/g, (_m, regionId: string) => {
      const instances = page.regions[regionId] ?? [];
      return instances
        .map((inst) => {
          const def = components.get(inst.component);
          return def ? renderComponent(def, inst, ctx, notesBase) : "";
        })
        .join("\n");
    });

    const fonts = multiPage ? `${fontFaceCss(page.path)}\n` : "";
    const css =
      fonts +
      ensureStatementCss(blueprint.tokens.css ?? "") +
      (multiPage ? `\n${CHROME_CSS}` : "");
    const head = multiPage
      ? composeSeoHead(
          {
            path: page.path,
            title: page.title,
            company,
            periodLabel,
            docKind,
            currency,
            kpis: homeKpis,
          },
          css,
        )
      : `<meta charset="utf-8"><title>${escapeHtml(page.title)}</title><style>${css}</style>`;

    const logoHref = ctx.brandAssets?.logo
      ? hrefFromPage(page.path, ctx.brandAssets.logo)
      : undefined;
    const chromeTop = multiPage
      ? `${renderStickyNav(plan.nav, page.path, company, logoHref)}${
          crumbInHero ? "" : renderBreadcrumb(page.path, page.title, company)
        }`
      : "";
    const chromeBottom = multiPage
      ? `${renderPrevNext(pageOrder, page.path)}${renderShareBar()}${renderSiteFooter({
          company,
          periodLabel,
          logoHref,
          nav: plan.nav,
          currentPath: page.path,
          listingCodes: footerExtras?.listingCodes,
          website: footerExtras?.website,
          phone: footerExtras?.phone,
          blurb: footerExtras?.blurb,
          publishedLine: footerExtras?.publishedLine,
          resultsLine: footerExtras?.resultsLine,
        })}${renderSelectionTooltip()}<script src="${siteRuntimeHref(page.path)}" defer></script>`
      : "";

    // Prefer injecting chrome around main; otherwise wrap body content.
    let body = shell;
    if (multiPage) {
      if (/<main\b/i.test(body)) {
        body = `${chromeTop}${body}${chromeBottom}`;
      } else {
        body = `${chromeTop}<main data-dna-component="page-shell">${body}</main>${chromeBottom}`;
      }
    }

    const doc = `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
    files[page.path] = doc;
  }

  if (multiPage) {
    files["assets/site.js"] = SITE_RUNTIME_JS;
  }

  if (multiPage && ctx.docModel) {
    return {
      files: enrichMultiPageFiles(files, plan, ctx.docModel, undefined, {
        brandAssets: ctx.brandAssets,
        extraction: ctx.extraction,
      }),
    };
  }
  return { files };
}

/** Resolve a site-root asset path (assets/…) relative to the current page. */
function hrefFromPage(fromPath: string, toPath: string): string {
  if (toPath.startsWith("data:") || toPath.startsWith("http") || toPath.startsWith("//")) {
    return toPath;
  }
  const fromDir = fromPath.includes("/") ? fromPath.replace(/\/[^/]+$/, "/") : "";
  if (!fromDir) return toPath;
  const depth = fromDir.split("/").filter(Boolean).length;
  return `${"../".repeat(depth)}${toPath}`;
}

const STATEMENT_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:0;background:var(--dna-paper,#fff);color:var(--dna-ink,#111);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.9375rem;line-height:1.45;letter-spacing:-.005em}
main[data-dna-component="page-shell"]{max-width:none;width:100%;margin:0;padding:0 0 2rem;display:block}
.statement-table{overflow-x:auto;margin:.35rem 0 1rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);background:var(--dna-paper,#fff)}
.fin-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);letter-spacing:-.01em}
.fin-table thead th{position:relative;z-index:1}
.fin-table th{background:var(--dna-table-header-bg,var(--dna-ink,#111));color:var(--dna-table-header-text,#fff);font-weight:700;text-align:left;padding:10px 12px;vertical-align:bottom;font-size:11px;letter-spacing:.03em;line-height:1.35;border-bottom:2px solid var(--dna-brand,#243B53)}
.fin-table th:not(:first-child),.fin-table td.cell-num{text-align:right}
.fin-table td{padding:7px 12px;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 9%,transparent);vertical-align:top}
.fin-table td.cur,.fin-table th.cur,.fin-table[data-cur-col] tbody td.cur{background:var(--dna-shading,#F2F2F2)!important}
.fin-table thead th.cur{filter:brightness(.94)}
.fin-table .cell-nil{text-align:right;opacity:.55}
.fin-table .cell-noteRef{text-align:center;width:3.75em}
.fin-table .num{font-variant-numeric:tabular-nums}
`.trim();

/** Strip prior IR skin blocks so rebuilds always get the latest STATEMENT_IR_CSS. */
function stripStatementIrCss(css: string): string {
  return css
    .replace(/\/\* rs-statement-ir \*\/[\s\S]*?\/\* end-rs-statement-ir \*\//g, "")
    .replace(/\/\* rs-statement-ir[^*]*\*\/[\s\S]*?(?=\n\/\* rs-|\n<\/style>|$)/g, "")
    .trim();
}

/** Older blueprints only locked :root tokens — inject baseline + IR table skin. */
function ensureStatementCss(tokensCss: string): string {
  const base = stripStatementIrCss(tokensCss);
  if (base.includes(".fin-table")) {
    return `${base}
${STATEMENT_IR_CSS}`;
  }
  return `${base}
${STATEMENT_BASE_CSS}
${STATEMENT_IR_CSS}`;
}

/** WW-recognizable statement IR skin (sofp-style widths; no decorative grp rules). */
const STATEMENT_IR_CSS = `
/* rs-statement-ir */
.statement-table,.fin-wrapper{overflow-x:auto;overflow-y:visible;margin:var(--rs-space-2,.7rem) 0 var(--rs-space-5,1.35rem);border:0;border-top:2px solid var(--dna-brand,#243B53);border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);background:var(--dna-paper,#fff);padding:0;box-shadow:none}
.statement-unit{display:inline-flex;align-items:center;gap:.45rem;margin:0 0 var(--rs-space-2,.7rem);padding:.28rem .55rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);border-left:3px solid var(--dna-brand,#243B53);background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 42%,var(--dna-paper,#fff));font-size:var(--rs-fs-eyebrow,.68rem);letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:color-mix(in srgb,var(--dna-ink,#111) 55%,var(--dna-paper,#fff))}
.statement-unit__value{color:var(--dna-masthead,#1B2A3A);font-weight:800;letter-spacing:.06em}
.fin-table{width:100%;min-width:34rem;border-collapse:collapse;border-spacing:0;table-layout:fixed;font-variant-numeric:tabular-nums;font-size:.8125rem;letter-spacing:-.01em;color:var(--dna-ink,#221F1F);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif)}
.fin-table col.c-label{width:auto}
.fin-table col.c-note{width:3.25rem}
.fin-table col.c-unit{width:8.5rem}
.fin-table col.c-cur,.fin-table col.c-cmp{width:9.25rem}
.fin-table[data-density="notes"] col.c-cur,.fin-table[data-density="notes"] col.c-cmp{width:9.25rem}
.fin-table[data-density="periods-3"]{min-width:42rem}
.fin-table[data-density="periods-3"] col.c-note{width:3rem}
.fin-table[data-density="periods-3"] col.c-cur,.fin-table[data-density="periods-3"] col.c-cmp{width:7.25rem}
.fin-table thead th{position:relative;z-index:1;letter-spacing:.01em;font-size:.72rem;font-weight:700;padding:8px 10px;vertical-align:bottom;line-height:1.3;border:none;border-bottom:2px solid var(--dna-brand,#243B53);background:var(--dna-paper,#fff);color:var(--dna-ink,#221F1F)}
.fin-table thead th.h-title{text-align:left;font-size:.875rem;letter-spacing:-.005em;font-weight:800;padding:10px 8px 6px 2px;background:var(--dna-paper,#fff)!important;color:var(--dna-table-header-bg,#64748B)}
.fin-table thead th.h-notes{text-align:center;font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;vertical-align:bottom;font-weight:800;background:var(--dna-paper,#fff)!important;color:var(--dna-ink,#221F1F);width:3.25rem;padding-left:4px;padding-right:4px}
.fin-table thead th.h-fig{text-align:right;font-weight:700;color:#fff!important;background:var(--dna-table-header-bg,#64748B)!important;border-left:1px solid #fff;white-space:normal;padding:7px 9px;line-height:1.3;overflow-wrap:break-word;hyphens:manual;vertical-align:bottom}
.fin-table thead th.h-fig:first-of-type,.fin-table thead th.h-notes + th.h-fig{border-left:0}
.fin-table[data-density="periods-3"] thead th.h-fig{padding:6px 7px;font-size:.66rem;line-height:1.28}
.fin-table thead th.h-fig.cur{filter:brightness(.94)}
.fin-table thead th.h-fig .h-fig__lead,.fin-table thead th.h-fig .h-fig__date,.fin-table thead th.h-fig .h-fig__unit,.fin-table thead th.h-fig .h-fig__audit{display:block;margin:0}
.fin-table thead th.h-fig .h-fig__lead{font-weight:600;opacity:.92;font-size:.66rem;letter-spacing:.01em;line-height:1.25;margin-bottom:.12rem}
.fin-table thead th.h-fig .h-fig__date{font-weight:800;letter-spacing:-.01em;line-height:1.25;margin-bottom:.1rem}
.fin-table thead th.h-fig .h-fig__unit,.fin-table thead th.h-fig .h-fig__audit{font-weight:600;opacity:.92;font-size:.66rem;line-height:1.25}
.fin-table td{padding:4px 8px;vertical-align:middle;line-height:1.4;border-bottom:none;border-left:0;border-right:0}
.fin-table td.lbl,.fin-table td.cell-label,.fin-table td:first-child{text-align:left;color:var(--dna-ink,#221F1F);padding-left:2px;padding-right:10px;white-space:normal;overflow-wrap:break-word;word-break:normal;hyphens:auto;line-height:1.42}
.fin-table td.cell-unit{text-align:left;white-space:nowrap;color:color-mix(in srgb,var(--dna-ink,#221F1F) 72%,var(--dna-paper,#fff));font-size:.78rem;padding-left:6px;padding-right:8px}
.fin-table td.cell-num,.fin-table td.cmp,.fin-table td.cur{text-align:right;white-space:nowrap;padding-right:10px;font-variant-numeric:tabular-nums}
.fin-table td.cur{font-weight:700;background:var(--dna-shading,#F2F2F2)}
.fin-table tbody tr.r-line:nth-child(even) td:not(.cur){background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 28%,var(--dna-paper,#fff))}
.fin-table tr.r-section td{font-weight:700;border-bottom:none;padding-top:10px;padding-bottom:3px;color:var(--dna-ink,#221F1F);font-size:.8125rem;letter-spacing:.01em;background:transparent!important}
.fin-table tr.r-section td.cell-num,.fin-table tr.r-section td.cur{background:transparent!important}
.fin-table tr.r-subtotal td{font-weight:700;background:transparent!important}
.fin-table tr.r-subtotal td.cur{background:var(--dna-shading,#F2F2F2)!important}
.fin-table tr.r-total td{font-weight:700;border-top:1px solid #6C6C6C;border-bottom:1px solid #BAC4CA;background:transparent!important;padding-top:5px;padding-bottom:5px}
.fin-table tr.r-total td.cur{background:var(--dna-shading,#F2F2F2)!important}
.fin-table tr.r-line td.cell-num.cur{font-weight:700}
.fin-table[data-cur-col] thead th.cur{background:color-mix(in srgb,var(--dna-table-header-bg,#64748B) 88%,#000)!important;color:#fff!important}
.fin-table[data-cur-col] tbody td.cur{background:var(--dna-shading,#F2F2F2)!important}
.fin-table .note-ref{color:color-mix(in srgb,var(--dna-brand,#243B53) 35%,var(--dna-masthead,#1B2A3A));text-decoration:none;font-weight:700;border-bottom:1px dotted color-mix(in srgb,var(--dna-brand,#243B53) 70%,#94A3B8);padding:0 1px}
.fin-table .note-ref:hover{border-bottom-style:solid;color:var(--dna-brand,#243B53)}
.fin-table .cell-noteRef,.fin-table td.note{text-align:center;width:3.25rem;max-width:3.25rem;padding-left:4px;padding-right:4px;font-size:.76rem;color:var(--dna-ink,#221F1F);vertical-align:middle}
/* Section/subtotal rules on the label column only — keep figure cells clear. */
.fin-table tr.bd-tan>td,.fin-table tr.bd-blue>td{border-top:none}
.fin-table tr.bd-tan>td:first-child{border-top:1.5px solid #CDAE86}
.fin-table tr.bd-blue>td:first-child{border-top:1px solid #BAC4CA}
.fin-table tbody tr{transition:background-color .12s ease}
.fin-table tbody tr:hover td{background-color:#DCE3E7!important}
.fin-table tbody tr:hover td.cur{background-color:#CBD4D9!important}
@media (max-width:720px){
  .fin-table,.fin-table[data-density="periods-3"]{table-layout:auto;font-size:.72rem;min-width:0}
  .fin-table col.c-cur,.fin-table col.c-cmp{width:auto}
  .fin-table td.cur,.fin-table td.cmp,.fin-table td.cell-num{padding-left:4px;padding-right:6px}
  .fin-table thead th.h-fig{padding:6px 6px;font-size:.64rem}
}
@media print{
  .site-nav,.nav-mobile,.nav-toggle,.share-bar,.page-pager,.xls-toolbar,.share-tooltip,.sel-share-mark{display:none!important}
  .statement-table,.fin-wrapper{overflow:visible;border-top:2px solid #000;break-inside:avoid}
  .fin-table{font-size:9.5pt;table-layout:auto;min-width:0}
  .fin-table thead th{position:static;background:#fff!important;color:#000!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .fin-table thead th.h-fig{background:#64748B!important;color:#fff!important}
  .fin-table td.cur,.fin-table[data-cur-col] tbody td.cur{background:#F2F2F2!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .fin-table tbody tr:hover td,.fin-table tbody tr:hover td.cur{background:inherit!important}
  .fin-table .note-ref{color:#000;border-bottom:none;font-weight:700}
  a.note-ref::after{content:""}
  .fin-table tr.bd-tan>td:first-child{border-top-color:#000}
  .fin-table tr.bd-blue>td:first-child{border-top-color:#666}
}
/* end-rs-statement-ir */
`.trim();
