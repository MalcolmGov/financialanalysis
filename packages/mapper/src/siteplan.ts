import type { Blueprint, FinancialDocModel, SitePlan, StatementType } from "@rs/contracts";
import { classifySectionTitle, noteNumberOf } from "./classify.js";

/**
 * FinancialDocModel → SitePlan (references only). Deterministic baseline.
 * When the blueprint includes multi-page templates (bp:tpl_home etc.), emits
 * the WW-style page tree. Otherwise falls back to a single statements page
 * so older locked blueprints keep validating.
 *
 * Adaptive sitemap: short interim PDFs keep the compact IR shell
 * (Home · Commentary · Financials · Admin · Downloads). Large AFS DocModels
 * expand from real sections — Directors' report, auditor's report, accounting
 * policies, and paginated note groups — so nav/explore/footer/pager mirror
 * extraction shape rather than a fixed ~10-page hollow copy.
 */

function firstComponentAccepting(blueprint: Blueprint, kind: "table"): string | null {
  for (const c of blueprint.components) {
    for (const slot of Object.values(c.slots)) {
      if (slot.type === "ref" && (slot.accepts === kind || slot.accepts === "any")) return c.id;
    }
  }
  return null;
}

function tableSlotName(blueprint: Blueprint, componentId: string): string | null {
  const comp = blueprint.components.find((c) => c.id === componentId);
  if (!comp) return null;
  for (const [name, slot] of Object.entries(comp.slots)) {
    if (slot.type === "ref" && (slot.accepts === "table" || slot.accepts === "any")) return name;
  }
  return null;
}

function firstStatementTemplate(blueprint: Blueprint): string {
  const named = blueprint.page_templates.find((t) => /statement|prose|main|cover/i.test(t.id + t.name));
  return (named ?? blueprint.page_templates[0]).id;
}

function firstRegionAccepting(blueprint: Blueprint, templateId: string, componentId: string): string {
  const tpl = blueprint.page_templates.find((t) => t.id === templateId)!;
  const short = componentId.replace(/^bp:cmp_/, "");
  const region = tpl.regions.find(
    (r) => r.accepts.includes(componentId) || r.accepts.includes(short) || r.accepts.length === 0,
  );
  return (region ?? tpl.regions[0]).id;
}

function hasTemplate(blueprint: Blueprint, id: string): boolean {
  return blueprint.page_templates.some((t) => t.id === id);
}

function supportsMultiPage(blueprint: Blueprint): boolean {
  return hasTemplate(blueprint, "bp:tpl_home") && hasTemplate(blueprint, "bp:tpl_statement_page");
}

const STATEMENT_PATHS: Record<StatementType, { path: string; title: string; nav: string }> = {
  pnl_oci: {
    path: "financials/income-statement.html",
    title: "Income statement",
    nav: "Income statement",
  },
  financial_position: {
    path: "financials/balance-sheet.html",
    title: "Statement of financial position",
    nav: "Balance sheet",
  },
  changes_in_equity: {
    path: "financials/changes-in-equity.html",
    title: "Changes in equity",
    nav: "Changes in equity",
  },
  cash_flows: {
    path: "financials/cash-flows.html",
    title: "Cash flows",
    nav: "Cash flows",
  },
};

/** Split large note sets into ranges of this many note numbers. */
const NOTE_GROUP_SIZE = 10;
/** Unique numbered notes before we paginate (interim packs stay on one page). */
const NOTE_SPLIT_MIN_NOTES = 12;
/** Or table count threshold when note numbers are sparse. */
const NOTE_SPLIT_MIN_TABLES = 40;

function statementTypeForTitle(title: string): StatementType | null {
  const cls = classifySectionTitle(title);
  return cls.statement_type ?? null;
}

function isNoteTitle(title: string): boolean {
  const cls = classifySectionTitle(title);
  return cls.kind === "note" || /^notes?\b/i.test(title) || /\bnote\s+\d/i.test(title);
}

function isOpsFactsTable(
  table: FinancialDocModel["tables"][number],
  title: string,
): boolean {
  if (table.table_type === "facts") return true;
  const cls = classifySectionTitle(title);
  return cls.kind === "reviewOfOperations" || /review\s+of\s+operations/i.test(title);
}

function tableInstances(
  tableIds: string[],
  tableComponent: string,
  slotName: string,
): SitePlan["pages"][number]["regions"][string] {
  return tableIds.map((id) => ({
    component: tableComponent,
    slots: { [slotName]: id },
  }));
}

function sectionHasProse(docModel: FinancialDocModel, kind: string): boolean {
  return docModel.sections.some(
    (s) =>
      s.kind === kind &&
      s.blocks.some((b) => b.kind !== "table" && Boolean((b.text ?? "").trim())),
  );
}

/** Detect dual-entity AFS (GROUP × COMPANY column bands) from table headers. */
export function docModelHasDualEntity(docModel: FinancialDocModel): boolean {
  for (const t of docModel.tables) {
    const joined = t.header_matrix
      .flat()
      .map((c) => (c.raw ?? "").replace(/\u00a0/g, " ").trim())
      .join(" | ");
    if (/\bGROUP\b/i.test(joined) && /\bCOMPANY\b/i.test(joined)) return true;
  }
  return false;
}

type NoteGroup = {
  path: string;
  title: string;
  nav: string;
  lo: number;
  hi: number;
  tableIds: string[];
};

/**
 * When note volume is high, split into notes index + numbered ranges.
 * Returns null to keep a single financials/notes.html page (interim shape).
 */
export function planNotePages(
  docModel: FinancialDocModel,
  noteTables: string[],
  titleByTableId: Map<string, string>,
): { indexTableIds: string[]; groups: NoteGroup[] } | null {
  const byNum = new Map<number, string[]>();
  const unnumbered: string[] = [];

  for (const id of noteTables) {
    const sec = docModel.sections.find(
      (s) =>
        s.blocks.some((b) => b.kind === "table" && b.table_ref === id) &&
        (s.note_number != null || isNoteTitle(s.title?.text ?? "")),
    );
    const fromSec =
      sec?.note_number ??
      (sec?.title?.text ? noteNumberOf(sec.title.text) : null);
    const fromTitle = noteNumberOf(titleByTableId.get(id) ?? "");
    const n = fromSec ?? fromTitle;
    if (n != null) {
      (byNum.get(n) ?? byNum.set(n, []).get(n)!).push(id);
    } else {
      unnumbered.push(id);
    }
  }

  // Also bucket note sections that may only contribute via section.note_number
  for (const sec of docModel.sections) {
    if (sec.kind !== "note" && !isNoteTitle(sec.title?.text ?? "")) continue;
    const n = sec.note_number ?? (sec.title?.text ? noteNumberOf(sec.title.text) : null);
    if (n == null) continue;
    for (const b of sec.blocks) {
      if (b.kind !== "table" || !b.table_ref) continue;
      if (!noteTables.includes(b.table_ref)) continue;
      const list = byNum.get(n) ?? [];
      if (!list.includes(b.table_ref)) list.push(b.table_ref);
      byNum.set(n, list);
    }
  }

  const nums = [...byNum.keys()].sort((a, b) => a - b);
  if (nums.length < NOTE_SPLIT_MIN_NOTES && noteTables.length < NOTE_SPLIT_MIN_TABLES) {
    return null;
  }

  const groups: NoteGroup[] = [];
  for (let i = 0; i < nums.length; i += NOTE_GROUP_SIZE) {
    const slice = nums.slice(i, i + NOTE_GROUP_SIZE);
    const lo = slice[0]!;
    const hi = slice[slice.length - 1]!;
    const tableIds = slice.flatMap((n) => byNum.get(n) ?? []);
    const path =
      lo === hi
        ? `financials/notes-${lo}.html`
        : `financials/notes-${lo}-${hi}.html`;
    const label = lo === hi ? `Note ${lo}` : `Notes ${lo}–${hi}`;
    groups.push({
      path,
      title: lo === hi ? `Note ${lo}` : `Notes ${lo}–${hi}`,
      nav: label,
      lo,
      hi,
      tableIds,
    });
  }

  // Unnumbered / orphan note tables stay on the index for discovery.
  return { indexTableIds: unnumbered, groups };
}

function buildLegacySinglePage(docModel: FinancialDocModel, blueprint: Blueprint): SitePlan {
  const tableComponent = firstComponentAccepting(blueprint, "table");
  const template = firstStatementTemplate(blueprint);
  const pages: SitePlan["pages"] = [];

  if (tableComponent) {
    const slotName = tableSlotName(blueprint, tableComponent)!;
    const region = firstRegionAccepting(blueprint, template, tableComponent);
    pages.push({
      path: "statements/index.html",
      template,
      title: "Financial statements",
      regions: {
        [region]: docModel.tables.map((t) => ({
          component: tableComponent,
          slots: { [slotName]: t.id },
        })),
      },
      downloads: [],
    });
  }

  return {
    schema_version: "siteplan/1",
    site_plan_id: `sp_${docModel.doc_model_id}`,
    doc_model_id: docModel.doc_model_id,
    blueprint_version_id: blueprint.blueprint_version_id,
    blueprint_checksum: blueprint.checksum,
    model: "deterministic-baseline",
    iteration: 0,
    nav: [{ label: "Financial statements", href: "statements/index.html" }],
    pages,
    validation: { status: "unvalidated", errors: [] },
  };
}

/**
 * Doc-shape labels for operator messaging / gates. SitePlan expansion is still
 * driven by real sections present (never a fixed page count).
 */
export type DocShape =
  | "interim_short"
  | "afs_dual_entity"
  | "afs_group_company_split"
  | "afs_generic";

export function classifyDocShape(docModel: FinancialDocModel): DocShape {
  const dual = docModelHasDualEntity(docModel);
  const afsProse =
    sectionHasProse(docModel, "directorsReport") ||
    sectionHasProse(docModel, "auditorReport") ||
    sectionHasProse(docModel, "accountingPolicies");
  const audited = docModel.meta.doc_kind === "annual_audited";
  if (!afsProse && !audited && !dual) return "interim_short";
  if (dual) return "afs_dual_entity";
  if (afsProse || audited) {
    // Separate Group vs Company statement books lack dual column bands.
    return "afs_group_company_split";
  }
  return "afs_generic";
}

function buildMultiPageSitePlan(docModel: FinancialDocModel, blueprint: Blueprint): SitePlan {
  const tableComponent = firstComponentAccepting(blueprint, "table");
  if (!tableComponent) return buildLegacySinglePage(docModel, blueprint);

  const slotName = tableSlotName(blueprint, tableComponent)!;
  const stmtTpl = "bp:tpl_statement_page";
  const homeTpl = "bp:tpl_home";
  const proseTpl = hasTemplate(blueprint, "bp:tpl_prose") ? "bp:tpl_prose" : homeTpl;
  const region = firstRegionAccepting(blueprint, stmtTpl, tableComponent);
  const dualEntity = docModelHasDualEntity(docModel);

  // Map tables → buckets by caption / section title
  const byStatement: Partial<Record<StatementType, string[]>> = {};
  const noteTables: string[] = [];
  const commentaryTables: string[] = [];
  const otherFinancial: string[] = [];

  const titleByTableId = new Map<string, string>();
  for (const sec of docModel.sections) {
    for (const b of sec.blocks) {
      if (b.kind === "table" && b.table_ref) {
        titleByTableId.set(b.table_ref, sec.title?.text ?? sec.statement_type ?? b.table_ref);
        if (sec.statement_type) {
          (byStatement[sec.statement_type] ??= []).push(b.table_ref);
        } else if (sec.kind === "reviewOfOperations") {
          commentaryTables.push(b.table_ref);
        } else if (
          sec.kind === "note" ||
          sec.kind === "segments" ||
          isNoteTitle(sec.title?.text ?? "")
        ) {
          noteTables.push(b.table_ref);
        }
      }
    }
  }

  for (const t of docModel.tables) {
    if (
      [...Object.values(byStatement)].some((ids) => ids?.includes(t.id)) ||
      noteTables.includes(t.id) ||
      commentaryTables.includes(t.id)
    ) {
      continue;
    }
    const title = titleByTableId.get(t.id) ?? "";
    const st = statementTypeForTitle(title);
    if (st) {
      (byStatement[st] ??= []).push(t.id);
    } else if (isOpsFactsTable(t, title)) {
      commentaryTables.push(t.id);
    } else if (isNoteTitle(title) || t.table_type === "note" || t.table_type === "wide") {
      noteTables.push(t.id);
    } else if (t.table_type === "statement" || t.must_appear) {
      otherFinancial.push(t.id);
    }
  }

  // Unclassified must-appear tables: put on income statement page as fallback bucket
  if (otherFinancial.length) {
    (byStatement.pnl_oci ??= []).push(...otherFinancial);
  }

  const pages: SitePlan["pages"] = [];
  const nav: SitePlan["nav"] = [];

  pages.push({
    path: "index.html",
    template: homeTpl,
    title: "Home",
    regions: { main: [] },
    downloads: [],
  });
  nav.push({ label: "Home", href: "index.html" });

  // Ops / facts KPI grids live on Commentary (with Review of operations prose),
  // not on the income-statement page — Financials stays statements-only.
  const proseRegion = firstRegionAccepting(blueprint, proseTpl, tableComponent);
  pages.push({
    path: "commentary.html",
    template: proseTpl,
    title: "Commentary",
    regions: { [proseRegion]: tableInstances(commentaryTables, tableComponent, slotName) },
    downloads: [],
  });
  nav.push({ label: "Commentary", href: "commentary.html" });

  // AFS expansion: Directors' report as top-level when prose exists.
  if (sectionHasProse(docModel, "directorsReport")) {
    pages.push({
      path: "directors-report.html",
      template: proseTpl,
      title: "Directors' report",
      regions: { main: [] },
      downloads: [],
    });
    nav.push({ label: "Directors' report", href: "directors-report.html" });
  }

  if (sectionHasProse(docModel, "auditorReport")) {
    pages.push({
      path: "auditors-report.html",
      template: proseTpl,
      title: "Independent auditor's report",
      regions: { main: [] },
      downloads: [],
    });
    nav.push({ label: "Auditor's report", href: "auditors-report.html" });
  }

  for (const st of Object.keys(STATEMENT_PATHS) as StatementType[]) {
    const meta = STATEMENT_PATHS[st];
    const ids = byStatement[st] ?? [];
    const title =
      dualEntity && ids.length
        ? `${meta.title} (Group and Company)`
        : meta.title;
    // Always emit the four primary statement pages (empty region ok if min=0)
    pages.push({
      path: meta.path,
      template: stmtTpl,
      title,
      regions: { [region]: tableInstances(ids, tableComponent, slotName) },
      downloads: [],
    });
    nav.push({ label: meta.nav, href: meta.path });
  }

  const notePlan = planNotePages(docModel, noteTables, titleByTableId);
  if (notePlan) {
    pages.push({
      path: "financials/notes.html",
      template: stmtTpl,
      title: "Notes index",
      regions: {
        [region]: tableInstances(notePlan.indexTableIds, tableComponent, slotName),
      },
      downloads: [],
    });
    nav.push({ label: "Notes", href: "financials/notes.html" });
    for (const g of notePlan.groups) {
      pages.push({
        path: g.path,
        template: stmtTpl,
        title: g.title,
        regions: { [region]: tableInstances(g.tableIds, tableComponent, slotName) },
        downloads: [],
      });
      nav.push({ label: g.nav, href: g.path });
    }
  } else {
    pages.push({
      path: "financials/notes.html",
      template: stmtTpl,
      title: "Notes",
      regions: { [region]: tableInstances(noteTables, tableComponent, slotName) },
      downloads: [],
    });
    nav.push({ label: "Notes", href: "financials/notes.html" });
  }

  if (sectionHasProse(docModel, "accountingPolicies")) {
    pages.push({
      path: "financials/accounting-policies.html",
      template: proseTpl,
      title: "Accounting policies",
      regions: { main: [] },
      downloads: [],
    });
    nav.push({ label: "Accounting policies", href: "financials/accounting-policies.html" });
  }

  pages.push({
    path: "administration.html",
    template: proseTpl,
    title: "Administration",
    regions: { main: [] },
    downloads: [],
  });
  nav.push({ label: "Administration", href: "administration.html" });

  const statementTableIds = docModel.tables
    .filter((t) => t.table_type === "statement" || t.must_appear)
    .map((t) => t.id);
  pages.push({
    path: "downloads.html",
    template: proseTpl,
    title: "Downloads",
    regions: { main: [] },
    downloads: [
      { kind: "pdf", tables: docModel.tables.map((t) => t.id) },
      { kind: "xlsx", tables: statementTableIds },
    ],
  });
  nav.push({ label: "Downloads", href: "downloads.html" });

  // Compatibility aggregate — secondary "all tables" surface (not in primary nav).
  if (hasTemplate(blueprint, "bp:tpl_statement") || hasTemplate(blueprint, stmtTpl)) {
    const aggTpl = hasTemplate(blueprint, "bp:tpl_statement") ? "bp:tpl_statement" : stmtTpl;
    const aggRegion = firstRegionAccepting(blueprint, aggTpl, tableComponent);
    pages.push({
      path: "statements/index.html",
      template: aggTpl,
      title: "All tables",
      regions: {
        [aggRegion]: docModel.tables.map((t) => ({
          component: tableComponent,
          slots: { [slotName]: t.id },
        })),
      },
      downloads: [],
    });
  }

  return {
    schema_version: "siteplan/1",
    site_plan_id: `sp_${docModel.doc_model_id}`,
    doc_model_id: docModel.doc_model_id,
    blueprint_version_id: blueprint.blueprint_version_id,
    blueprint_checksum: blueprint.checksum,
    model: "deterministic-multipage",
    iteration: 0,
    nav,
    pages,
    validation: { status: "unvalidated", errors: [] },
  };
}

export function buildSitePlan(docModel: FinancialDocModel, blueprint: Blueprint): SitePlan {
  if (supportsMultiPage(blueprint)) {
    return buildMultiPageSitePlan(docModel, blueprint);
  }
  return buildLegacySinglePage(docModel, blueprint);
}
