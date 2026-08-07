import type {
  Blueprint,
  ComponentDef,
  ComponentInstance,
  FinTable,
  SitePlan,
  SlotDef,
} from "@rs/contracts";
import { findDocTable, resolveCell, type ResolveContext } from "./resolve.js";

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

/** Latest-year column (0-based) from FinTable header matrix, or null. */
function findCurrentPeriodCol(table: FinTable): number | null {
  let bestCol: number | null = null;
  let bestYear = -1;
  for (const row of table.header_matrix) {
    let col = 0;
    for (const h of row) {
      const years = [...h.raw.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
      const y = years.length ? Math.max(...years) : null;
      if (y != null && y >= bestYear) {
        bestYear = y;
        bestCol = col;
      }
      col += Math.max(1, h.col_span ?? 1);
    }
  }
  return bestCol;
}

function renderFinTable(table: FinTable): string {
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
          // Every cell with CONTENT is provenance-tagged — text row-labels
          // ("Balance at 30 June 2024"), nil markers and note refs all carry
          // digits that must trace to their source cell (cell.raw is the
          // mapper's byte-for-byte copy). Empty grid slots — real Docling tables
          // omit cells — carry no digit and need no provenance.
          const src = cell.raw.trim() !== "" ? ` data-src="${escapeHtml(cell.src_ref)}"` : "";
          return `<td class="cell-${cell.kind}${curCls}"${src}>${escapeHtml(cell.raw)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table class="fin-table"${curAttr} data-table-src="${escapeHtml(table.src_table)}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderSlot(
  slotName: string,
  slotDef: SlotDef,
  value: unknown,
  ctx: ResolveContext,
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
        return table ? renderFinTable(table) : `<!-- unresolved table ${escapeHtml(ref)} -->`;
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
): string {
  let html = def.html;
  html = html.replace(/\{\{variant\}\}/g, escapeHtml(inst.variant ?? "default"));
  html = html.replace(/\{\{slot:([a-zA-Z0-9_]+)\}\}/g, (_m, slotName: string) => {
    const slotDef = def.slots[slotName];
    if (!slotDef) return "";
    return renderSlot(slotName, slotDef, inst.slots[slotName], ctx);
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

  for (const page of plan.pages) {
    const tpl = templates.get(page.template);
    let shell = tpl?.shell_html ?? "<main>{{region:main}}</main>";
    shell = shell.replace(/\{\{region:([a-zA-Z0-9_-]+)\}\}/g, (_m, regionId: string) => {
      const instances = page.regions[regionId] ?? [];
      return instances
        .map((inst) => {
          const def = components.get(inst.component);
          return def ? renderComponent(def, inst, ctx) : "";
        })
        .join("\n");
    });

    const css = ensureStatementCss(blueprint.tokens.css ?? "");
    const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(page.title)}</title><style>${css}</style></head><body>${shell}</body></html>`;
    files[page.path] = doc;
  }

  return { files };
}

/** Older blueprints only locked :root tokens — inject baseline table layout. */
function ensureStatementCss(tokensCss: string): string {
  if (tokensCss.includes(".fin-table")) return tokensCss;
  return `${tokensCss}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:24px 20px 48px;background:var(--dna-paper,#fff);color:var(--dna-ink,#111);font-family:var(--dna-font-body,system-ui,sans-serif);line-height:1.45}
main[data-dna-component="page-shell"]{max-width:1100px;margin:0 auto;display:grid;gap:28px}
.statement-table{overflow-x:auto}
.fin-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.fin-table th{background:var(--dna-table-header-bg,var(--dna-ink,#111));color:var(--dna-table-header-text,#fff);font-weight:600;text-align:left;padding:8px 10px;vertical-align:bottom}
.fin-table th:not(:first-child),.fin-table td.cell-num{text-align:right}
.fin-table td{padding:7px 10px;border-bottom:1px solid rgba(0,0,0,.1);vertical-align:top}
.fin-table tbody tr:nth-child(even) td{background:var(--dna-shading,#f2f2f2)}
.fin-table td.cur,.fin-table th.cur,.fin-table[data-cur-col] tbody td.cur{background:var(--dna-shading,#E9E7E4)!important}
.fin-table thead th.cur{filter:brightness(.92)}
.fin-table .cell-nil{text-align:right;opacity:.55}
.fin-table .cell-noteRef{text-align:center;width:3.5em;opacity:.6}
`;
}
