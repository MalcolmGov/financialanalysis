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
  renderBreadcrumb,
  renderPrevNext,
  renderSelectionTooltip,
  renderShareBar,
  renderSiteFooter,
  renderStickyNav,
} from "./chrome.js";
import { enrichMultiPageFiles } from "./enrich.js";
import { extractHomeKpis } from "./home-composer.js";
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

/** Stack IR period headers (As at / date / Rm / Unaudited) without inventing text. */
function formatHeaderCellHtml(raw: string): string {
  const m = raw
    .replace(/\s+/g, " ")
    .trim()
    .match(
      /^(As at|For the (?:six months|year) ended)\s+(.+?)\s+(Rm|R'000|R million)\s+(Unaudited|Audited)$/i,
    );
  if (m) {
    return `${escapeHtml(m[1]!)}<br><span class="h-fig__date">${escapeHtml(m[2]!)}</span><br><span class="h-fig__unit">${escapeHtml(m[3]!)}</span><br><span class="h-fig__audit">${escapeHtml(m[4]!)}</span>`;
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

function renderFinTable(table: FinTable, notesBase: string | null): string {
  const cur0 = findCurrentPeriodCol(table);
  const noteCol = noteColIndex(table);
  const curAttr = cur0 != null ? ` data-cur-col="${cur0 + 1}"` : "";
  const colCount = Math.max(
    ...table.header_matrix.map((row) =>
      row.reduce((n, h) => n + Math.max(1, h.col_span ?? 1), 0),
    ),
    ...table.rows.map((r) => r.cells.length),
    1,
  );
  const cols = Array.from({ length: colCount }, (_, i) => {
    if (i === 0) return `<col class="c-label">`;
    if (noteCol != null && i === noteCol) return `<col class="c-note">`;
    if (cur0 != null && i === cur0) return `<col class="c-cur">`;
    return `<col class="c-cmp">`;
  }).join("");

  const head = table.header_matrix
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
          return `<th${cls}${src}${h.col_span > 1 ? ` colspan="${h.col_span}"` : ""}${h.row_span > 1 ? ` rowspan="${h.row_span}"` : ""}>${inner}</th>`;
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
          const noteEmpty =
            noteCol != null && start === noteCol ? " cell-noteRef note" : "";
          return `<td class="cell-${cell.kind}${labelCls}${noteEmpty}${curCls}"${src}>${escapeHtml(cell.raw)}</td>`;
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
  return `${unitHtml}<table class="fin-table"${curAttr} data-table-src="${escapeHtml(table.src_table)}"><colgroup>${cols}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table>`;
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
  const periodLabel = ctx.docModel?.meta?.period_label;
  const docKind = ctx.docModel?.meta?.doc_kind;
  const currency = ctx.docModel?.meta?.currency;
  const homeKpis = ctx.docModel ? extractHomeKpis(ctx.docModel) : [];
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
      ? `${renderStickyNav(plan.nav, page.path, company, logoHref)}${renderShareBar()}${
          crumbInHero ? "" : renderBreadcrumb(page.path, page.title, company)
        }`
      : "";
    const chromeBottom = multiPage
      ? `${renderPrevNext(pageOrder, page.path)}${renderSiteFooter(company, periodLabel, logoHref)}${renderSelectionTooltip()}<script src="${siteRuntimeHref(page.path)}" defer></script>`
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

/** Older blueprints only locked :root tokens — inject baseline + IR table skin. */
function ensureStatementCss(tokensCss: string): string {
  // Always ensure IR statement polish is present (idempotent marker).
  if (tokensCss.includes("/* rs-statement-ir */")) return tokensCss;
  if (tokensCss.includes(".fin-table")) {
    return `${tokensCss}
${STATEMENT_IR_CSS}`;
  }
  return `${tokensCss}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:0;background:var(--dna-paper,#fff);color:var(--dna-ink,#111);font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);font-size:.9375rem;line-height:1.45;letter-spacing:-.005em}
main[data-dna-component="page-shell"]{max-width:1120px;margin:0 auto;padding:0 clamp(1rem,3vw,2rem) 2rem;display:grid;gap:1.5rem}
.statement-table{overflow-x:auto;margin:.35rem 0 1rem;border:1px solid color-mix(in srgb,var(--dna-ink,#111) 12%,transparent);background:var(--dna-paper,#fff)}
.fin-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;font-family:var(--dna-font-body,"Open Sans","Segoe UI",system-ui,sans-serif);letter-spacing:-.01em}
.fin-table thead th{position:sticky;top:0;z-index:2}
.fin-table th{background:var(--dna-table-header-bg,var(--dna-ink,#111));color:var(--dna-table-header-text,#fff);font-weight:700;text-align:left;padding:10px 12px;vertical-align:bottom;font-size:11px;letter-spacing:.03em;line-height:1.35;border-bottom:2px solid var(--dna-brand,#FCAF17)}
.fin-table th:not(:first-child),.fin-table td.cell-num{text-align:right}
.fin-table td{padding:7px 12px;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 9%,transparent);vertical-align:top}
.fin-table td.cur,.fin-table th.cur,.fin-table[data-cur-col] tbody td.cur{background:var(--dna-shading,#F2F2F2)!important}
.fin-table thead th.cur{filter:brightness(.94)}
.fin-table .cell-nil{text-align:right;opacity:.55}
.fin-table .cell-noteRef{text-align:center;width:3.75em}
.fin-table .num{font-variant-numeric:tabular-nums}
${STATEMENT_IR_CSS}
`;
}

/** WW-grade row taxonomy + note-ref + banding (safe to append after any .fin-table base). */
const STATEMENT_IR_CSS = `
/* rs-statement-ir — dense IR table skin */
.statement-table{overflow-x:auto;margin:.35rem 0 1.35rem;border:0;border-top:2px solid var(--dna-brand,#FCAF17);border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);background:var(--dna-paper,#fff);padding:0;box-shadow:none}
.fin-table{width:100%;border-collapse:collapse;table-layout:fixed;font-variant-numeric:tabular-nums;font-size:12.5px;letter-spacing:-.01em}
.fin-table col.c-label{width:auto}
.fin-table col.c-note{width:3.5em}
.fin-table col.c-cur,.fin-table col.c-cmp{width:7.35em}
.fin-table thead th{position:sticky;top:0;z-index:2;border-bottom:2px solid var(--dna-brand,#FCAF17);letter-spacing:.015em;font-size:11px;font-weight:700;padding:12px 10px 11px;vertical-align:bottom;line-height:1.28;color:var(--dna-ink,#231F20);background:color-mix(in srgb,var(--dna-paper,#fff) 94%,var(--dna-shading,#F2F2F2));backdrop-filter:blur(4px)}
.fin-table thead th.h-title{text-align:left;font-size:12px;letter-spacing:.005em;font-weight:800}
.fin-table thead th.h-notes{text-align:center;font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;vertical-align:bottom;font-weight:800}
.fin-table thead th.h-fig{text-align:right;font-weight:700}
.fin-table thead th.h-fig .h-fig__date{display:block;font-weight:800;letter-spacing:-.01em;line-height:1.3}
.fin-table thead th.h-fig .h-fig__unit,.fin-table thead th.h-fig .h-fig__audit{display:block;font-weight:600;opacity:.88;font-size:10.5px;margin-top:.15rem}
.fin-table td{padding:6.5px 10px;vertical-align:middle;line-height:1.35;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 8%,transparent)}
.fin-table td.lbl,.fin-table td.cell-label,.fin-table td:first-child{text-align:left;color:var(--dna-ink,#231F20);padding-left:10px}
.fin-table td.cell-num,.fin-table td.cmp{text-align:right;white-space:nowrap;padding-right:11px}
.fin-table td.cur{font-weight:700}
.fin-table tbody tr.r-line:nth-child(even) td:not(.cur){background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 34%,var(--dna-paper,#fff))}
.fin-table tr.r-section td{font-weight:800;border-bottom:none;padding-top:16px;padding-bottom:6px;color:var(--dna-masthead,#0F3B2E);font-size:12.5px;letter-spacing:.015em;background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 5.5%,var(--dna-paper,#fff))!important;border-top:1px solid color-mix(in srgb,var(--dna-brand,#FCAF17) 58%,transparent)}
.fin-table tr.r-section td.cell-num,.fin-table tr.r-section td.cur{background:color-mix(in srgb,var(--dna-masthead,#0F3B2E) 5.5%,var(--dna-paper,#fff))!important}
.fin-table tr.r-subtotal td{font-weight:700;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 22%,transparent);background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 58%,var(--dna-paper,#fff))!important}
.fin-table tr.r-subtotal td.cur{background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 80%,var(--dna-paper,#fff))!important}
.fin-table tr.r-total td{font-weight:800;border-top:2px solid var(--dna-masthead,#0F3B2E);border-bottom:2px solid color-mix(in srgb,var(--dna-brand,#FCAF17) 68%,transparent);background:color-mix(in srgb,var(--dna-brand,#FCAF17) 11%,var(--dna-paper,#fff))!important;padding-top:10px;padding-bottom:10px}
.fin-table tr.r-total td.cur{background:color-mix(in srgb,var(--dna-brand,#FCAF17) 18%,var(--dna-shading,#F2F2F2))!important}
.fin-table tr.r-line td.cell-num.cur{font-weight:700}
.fin-table[data-cur-col] thead th.cur,.fin-table[data-cur-col] tbody td.cur{background:color-mix(in srgb,var(--dna-shading,#F2F2F2) 72%,var(--dna-paper,#fff))!important}
.fin-table[data-cur-col] tbody td.cur{box-shadow:inset 1px 0 0 color-mix(in srgb,var(--dna-ink,#111) 14%,transparent)}
.fin-table .note-ref{color:var(--dna-masthead,#0F3B2E);text-decoration:none;font-weight:800;border-bottom:1px dashed color-mix(in srgb,var(--dna-brand,#FCAF17) 85%,transparent);padding:0 1px}
.fin-table .note-ref:hover{border-bottom-style:solid;color:var(--dna-brand,#FCAF17)}
.fin-table .cell-noteRef,.fin-table td.note{text-align:center;width:3.5em;font-size:11.5px}
.fin-table tr.bd-tan>td{border-top:1.5px solid color-mix(in srgb,var(--dna-brand,#FCAF17) 55%,#CDAE86)}
.fin-table tr.bd-blue>td{border-top:1px solid #BAC4CA}
.fin-table tr.grp td.cur{border-left:1px solid #6C6C6C}
.fin-table tr.grp td.cmp:last-child,.fin-table tr.grp td.cell-num.cmp:last-child{border-right:1px solid #6C6C6C}
.fin-table tr.grp-top td.cur,.fin-table tr.grp-top td.cmp,.fin-table tr.grp-top td.cell-num{border-top:1px solid #6C6C6C}
.fin-table tr.grp-bot td.cur,.fin-table tr.grp-bot td.cmp,.fin-table tr.grp-bot td.cell-num{border-bottom:1px solid #6C6C6C}
.fin-table tbody tr{transition:background-color .15s ease}
.fin-table tbody tr:hover td{background-color:color-mix(in srgb,var(--dna-brand,#FCAF17) 5%,transparent)!important}
.fin-table tbody tr:hover td.cur{background-color:color-mix(in srgb,var(--dna-shading,#F2F2F2) 82%,var(--dna-brand,#FCAF17))!important}
@media (max-width:720px){
  .fin-table{table-layout:auto;font-size:11.5px}
  .fin-table col.c-cur,.fin-table col.c-cmp{width:auto}
}
`.trim();
