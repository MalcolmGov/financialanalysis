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
  renderStickyNav,
} from "./chrome.js";
import { enrichMultiPageFiles } from "./enrich.js";
import { extractHomeKpis } from "./home-composer.js";
import { linkNoteRefHtml, notesBaseHref } from "./notes-linker.js";
import { findDocTable, resolveCell, type ResolveContext } from "./resolve.js";
import {
  classifyStatementRow,
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

function renderFinTable(table: FinTable, notesBase: string | null): string {
  const cur0 = findCurrentPeriodCol(table);
  const curAttr = cur0 != null ? ` data-cur-col="${cur0 + 1}"` : "";

  const head = table.header_matrix
    .map((row) => {
      let col = 0;
      const cells = row
        .map((h) => {
          const start = col;
          const span = Math.max(1, h.col_span ?? 1);
          col += span;
          const isCur = cur0 != null && cur0 >= start && cur0 < start + span;
          // Header cells carry provenance too: they hold dates ("31 Dec 2025")
          // and unit labels whose digits must be traceable + verified. Empty
          // header slots (real tables are sparse) carry no data-src.
          const src = h.raw.trim() !== "" ? ` data-src="${escapeHtml(h.src_ref)}"` : "";
          const cls = isCur ? ` class="cur"` : "";
          return `<th${cls}${src}${h.col_span > 1 ? ` colspan="${h.col_span}"` : ""}${h.row_span > 1 ? ` rowspan="${h.row_span}"` : ""}>${escapeHtml(h.raw)}</th>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const body = table.rows
    .map((row) => {
      const label = row.cells[0]?.raw ?? "";
      const role = classifyStatementRow(label, rowHasNumeric(row.cells));
      let col = 0;
      const cells = row.cells
        .map((cell) => {
          const start = col;
          const span = Math.max(1, (cell as { col_span?: number }).col_span ?? 1);
          col += span;
          const isCur = cur0 != null && cur0 >= start && cur0 < start + span;
          const curCls = isCur ? " cur" : "";
          if (cell.kind === "number") {
            return `<td class="cell-num${curCls}">${numberSpan(cell.src_ref, cell.raw)}</td>`;
          }
          if (cell.kind === "noteRef" && cell.raw.trim() && notesBase) {
            const src = ` data-src="${escapeHtml(cell.src_ref)}"`;
            const linked = linkNoteRefHtml(cell.raw, notesBase, escapeHtml);
            return `<td class="cell-noteRef${curCls}"${src}>${linked}</td>`;
          }
          // Every cell with CONTENT is provenance-tagged — text row-labels
          // ("Balance at 30 June 2024"), nil markers and note refs all carry
          // digits that must trace to their source cell (cell.raw is the
          // mapper's byte-for-byte copy). Empty grid slots — real Docling tables
          // omit cells — carry no digit and need no provenance.
          const src = cell.raw.trim() !== "" ? ` data-src="${escapeHtml(cell.src_ref)}"` : "";
          return `<td class="cell-${cell.kind}${curCls}"${src}>${escapeHtml(cell.raw)}</td>`;
        })
        .join("");
      return `<tr class="${rowRoleClass(role)}">${cells}</tr>`;
    })
    .join("");

  return `<table class="fin-table"${curAttr} data-table-src="${escapeHtml(table.src_table)}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
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

    const css = ensureStatementCss(blueprint.tokens.css ?? "") + (multiPage ? `\n${CHROME_CSS}` : "");
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

    const chromeTop = multiPage
      ? `${renderStickyNav(plan.nav, page.path)}${renderShareBar()}${
          crumbInHero ? "" : renderBreadcrumb(page.path, page.title, company)
        }`
      : "";
    const chromeBottom = multiPage
      ? `${renderPrevNext(pageOrder, page.path)}${renderSelectionTooltip()}<script src="${siteRuntimeHref(page.path)}" defer></script>`
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
    return { files: enrichMultiPageFiles(files, plan, ctx.docModel) };
  }
  return { files };
}

/** Older blueprints only locked :root tokens — inject baseline table layout. */
function ensureStatementCss(tokensCss: string): string {
  if (tokensCss.includes(".fin-table")) {
    // P1 row taxonomy / note-ref rules may be missing from older locked blueprints.
    if (tokensCss.includes(".r-section") && tokensCss.includes(".note-ref")) return tokensCss;
    return `${tokensCss}
${STATEMENT_P1_CSS}`;
  }
  return `${tokensCss}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:0;background:var(--dna-paper,#fff);color:var(--dna-ink,#111);font-family:var(--dna-font-body,system-ui,sans-serif);line-height:1.45}
main[data-dna-component="page-shell"]{max-width:1120px;margin:0 auto;padding:0 clamp(1rem,3vw,2rem) 2rem;display:grid;gap:1.5rem}
.statement-table{overflow-x:auto}
.fin-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.fin-table th{background:var(--dna-table-header-bg,var(--dna-ink,#111));color:var(--dna-table-header-text,#fff);font-weight:600;text-align:left;padding:8px 10px;vertical-align:bottom}
.fin-table th:not(:first-child),.fin-table td.cell-num{text-align:right}
.fin-table td{padding:6px 10px;border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 10%,transparent);vertical-align:top}
.fin-table td.cur,.fin-table th.cur,.fin-table[data-cur-col] tbody td.cur{background:var(--dna-shading,#F2F2F2)!important}
.fin-table thead th.cur{filter:brightness(.92)}
.fin-table .cell-nil{text-align:right;opacity:.55}
.fin-table .cell-noteRef{text-align:center;width:3.5em}
.fin-table .num{font-variant-numeric:tabular-nums}
${STATEMENT_P1_CSS}
`;
}

/** Row taxonomy + note-ref presentation (appended when base .fin-table CSS already exists). */
const STATEMENT_P1_CSS = `
.fin-table tr.r-section td{font-weight:700;border-bottom:none;padding-top:12px}
.fin-table tr.r-subtotal td{font-weight:700}
.fin-table tr.r-total td{font-weight:700;border-top:1px solid color-mix(in srgb,var(--dna-ink,#111) 45%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dna-ink,#111) 22%,transparent)}
.fin-table tr.r-line td.cell-num.cur{font-weight:600}
.fin-table .note-ref{color:var(--dna-brand,#B8912A);text-decoration:none;font-weight:600;border-bottom:1px dotted color-mix(in srgb,var(--dna-brand,#B8912A) 55%,transparent)}
.fin-table .note-ref:hover{border-bottom-style:solid}
.fin-table .cell-noteRef{text-align:center;width:3.5em}
`.trim();
