import type { Blueprint, FinancialDocModel, SitePlan, StatementType } from "@rs/contracts";
import { classifySectionTitle } from "./classify.js";

/**
 * FinancialDocModel → SitePlan (references only). Deterministic baseline.
 * When the blueprint includes multi-page templates (bp:tpl_home etc.), emits
 * the WW-style page tree. Otherwise falls back to a single statements page
 * so older locked blueprints keep validating.
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

function buildMultiPageSitePlan(docModel: FinancialDocModel, blueprint: Blueprint): SitePlan {
  const tableComponent = firstComponentAccepting(blueprint, "table");
  if (!tableComponent) return buildLegacySinglePage(docModel, blueprint);

  const slotName = tableSlotName(blueprint, tableComponent)!;
  const stmtTpl = "bp:tpl_statement_page";
  const homeTpl = "bp:tpl_home";
  const proseTpl = hasTemplate(blueprint, "bp:tpl_prose") ? "bp:tpl_prose" : homeTpl;
  const region = firstRegionAccepting(blueprint, stmtTpl, tableComponent);

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

  for (const st of Object.keys(STATEMENT_PATHS) as StatementType[]) {
    const meta = STATEMENT_PATHS[st];
    const ids = byStatement[st] ?? [];
    // Always emit the four primary statement pages (empty region ok if min=0)
    pages.push({
      path: meta.path,
      template: stmtTpl,
      title: meta.title,
      regions: { [region]: tableInstances(ids, tableComponent, slotName) },
      downloads: [],
    });
    nav.push({ label: meta.nav, href: meta.path });
  }

  pages.push({
    path: "financials/notes.html",
    template: stmtTpl,
    title: "Notes",
    regions: { [region]: tableInstances(noteTables, tableComponent, slotName) },
    downloads: [],
  });
  nav.push({ label: "Notes", href: "financials/notes.html" });

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

  // Compatibility aggregate for tools that still look for statements/index.html
  if (hasTemplate(blueprint, "bp:tpl_statement") || hasTemplate(blueprint, stmtTpl)) {
    const aggTpl = hasTemplate(blueprint, "bp:tpl_statement") ? "bp:tpl_statement" : stmtTpl;
    const aggRegion = firstRegionAccepting(blueprint, aggTpl, tableComponent);
    pages.push({
      path: "statements/index.html",
      template: aggTpl,
      title: "Financial statements",
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
