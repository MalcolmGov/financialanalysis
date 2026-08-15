import {
  officialStatementNavLabel,
  officialStatementTitle,
  type Blueprint,
  type FinancialDocModel,
  type SitePlan,
  type StatementType,
} from "@rs/contracts";
import { classifySectionTitle, isNoteLikeTitle, noteNumberOf, stripContinuedSuffix } from "./classify.js";

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

const STATEMENT_PATHS: Record<StatementType, { path: string }> = {
  pnl_oci: { path: "financials/income-statement.html" },
  financial_position: { path: "financials/balance-sheet.html" },
  changes_in_equity: { path: "financials/changes-in-equity.html" },
  cash_flows: { path: "financials/cash-flows.html" },
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

/** Detect dual-entity AFS (GROUP × COMPANY column bands) from statement tables. */
export function docModelHasDualEntity(docModel: FinancialDocModel): boolean {
  for (const t of docModel.tables) {
    if (t.table_type !== "statement") continue;
    const joined = t.header_matrix
      .flat()
      .map((c) => (c.raw ?? "").replace(/\u00a0/g, " ").trim())
      .join(" | ");
    if (/\bGROUP\b/i.test(joined) && /\bCOMPANY\b/i.test(joined)) return true;
  }
  return false;
}

/** Separate Group vs Company statement books (MTN) — not dual column bands. */
export function docModelHasSeparateEntityBooks(docModel: FinancialDocModel): boolean {
  let hasGroup = false;
  let hasCompany = false;
  for (const sec of docModel.sections) {
    const t = sec.title?.text ?? "";
    if (sec.kind !== "statement" && !sec.statement_type) continue;
    if (/\bgroup\b/i.test(t)) hasGroup = true;
    if (/\bcompany\b/i.test(t)) hasCompany = true;
  }
  // Prefer titled books even when a stray dual-header table exists.
  return hasGroup && hasCompany;
}

function entityFromTitle(title: string): "group" | "company" | null {
  if (/notes\s+to\s+the\s+company|\bcompany\b/i.test(title) && !/\bgroup\b.*\band\b.*\bcompany\b/i.test(title)) {
    if (/\bcompany\b/i.test(title) && !/\bgroup\b/i.test(title)) return "company";
    if (/^company\b|company\s+[—-]|notes\s+to\s+the\s+company/i.test(title)) return "company";
  }
  if (/\bgroup\b/i.test(title) && !/\bcompany\b/i.test(title)) return "group";
  if (/^group\b|group\s+[—-]|notes\s+to\s+the\s+group/i.test(title)) return "group";
  if (/\bcompany\b/i.test(title)) return "company";
  if (/\bgroup\b/i.test(title)) return "group";
  return null;
}

/** Section banners like “Notes to the Group financial statements (continued)”. */
const GENERIC_NOTE_SHELL =
  /^(?:notes?\s+to\s+the\s+(?:group\s+|company\s+|consolidated\s+)?(?:annual\s+)?financial statements|notes?\s+to\s+(?:consolidated\s+)?(?:annual\s+)?financial statements|notes?)$/i;

export function isGenericNoteShellTitle(title: string): boolean {
  const t = stripContinuedSuffix(title.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .replace(/[.:\-–—]+$/g, "")
    .trim();
  return GENERIC_NOTE_SHELL.test(t);
}

/** Topic label for a note heading, or null for numbering-only / shell banners. */
export function noteTopicFromTitle(raw: string): string | null {
  const cleaned = stripContinuedSuffix(raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim());
  if (isGenericNoteShellTitle(cleaned)) return null;
  const withoutBanner = stripPeriodRunningHeader(cleaned);
  if (!withoutBanner || isGenericNoteShellTitle(withoutBanner)) return null;
  const stripped = withoutBanner
    .replace(/^notes?\s+\d+(?:\.\d+)?\s*[.:\-–—]?\s*/i, "")
    .replace(/^note\s+\d+(?:\.\d+)?\s*[.:\-–—]?\s*/i, "")
    .replace(/^\d{1,2}(?:\.\d+)?\s*[.:\-–—]?\s*/i, "")
    .trim();
  if (stripped.length < 4 || /^notes?\s+\d/i.test(stripped)) return null;
  if (isGenericNoteShellTitle(stripped)) return null;
  if (PERIOD_DATE_ONLY.test(stripped)) return null;
  return stripped.length > 42 ? `${stripped.slice(0, 40)}…` : stripped;
}

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const CAL_DATE = `\\d{1,2}\\s+${MONTH}\\s+\\d{4}`;
const PERIOD_DATE_ONLY = new RegExp(`^(?:${CAL_DATE}|year ended|six months ended)\\b`, "i");
const RUNNING_HEADER = new RegExp(
  `^(?:group|company|the\\s+spar\\s+group(?:\\s+limited|\\s+ltd)?)\\s*[—\\-–]\\s*(?:${CAL_DATE}|(?:year|six months)\\s+ended(?:\\s+${CAL_DATE})?)\\s*`,
  "i",
);

function stripPeriodRunningHeader(title: string): string {
  return title.replace(RUNNING_HEADER, "").trim();
}

function topicByNoteNumber(
  docModel: FinancialDocModel,
  titleByTableId: Map<string, string>,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const sec of docModel.sections) {
    const n = sec.note_number ?? (sec.title?.text ? noteNumberOf(sec.title.text) : null);
    if (n == null) continue;
    const topic = noteTopicFromTitle(sec.title?.text ?? "");
    if (topic && !map.has(n)) map.set(n, topic);
  }
  for (const [id, title] of titleByTableId) {
    const n = noteNumberOf(title);
    if (n == null || map.has(n)) continue;
    const topic = noteTopicFromTitle(title);
    if (topic) map.set(n, topic);
  }
  return map;
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
 * Returns null to keep a single notes.html page (interim shape).
 * `pathPrefix` is "" for flat financials/, or "group/" / "company/".
 */
export function planNotePages(
  docModel: FinancialDocModel,
  noteTables: string[],
  titleByTableId: Map<string, string>,
  pathPrefix = "",
): { indexTableIds: string[]; groups: NoteGroup[]; indexPath: string } | null {
  const byNum = new Map<number, string[]>();
  const unnumbered: string[] = [];
  const prefix = pathPrefix.replace(/^\/+|\/+$/g, "");
  const base = prefix ? `financials/${prefix}` : "financials";

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
  const minNotes = prefix ? 8 : NOTE_SPLIT_MIN_NOTES;
  const minTables = prefix ? 20 : NOTE_SPLIT_MIN_TABLES;
  const shouldSplit = nums.length >= minNotes || noteTables.length >= minTables;
  if (!shouldSplit) return null;

  // If numbers are still sparse but table volume is high, chunk unnumbered
  // sequentially so MTN-style dumps never stay on one megapage.
  if (nums.length < minNotes && unnumbered.length >= minTables) {
    const chunk = 20;
    const groups: NoteGroup[] = [];
    for (let i = 0; i < unnumbered.length; i += chunk) {
      const slice = unnumbered.slice(i, i + chunk);
      const lo = Math.floor(i / chunk) + 1;
      const hi = lo;
      groups.push({
        path: `${base}/notes-part-${lo}.html`,
        title: `Notes (part ${lo})`,
        nav: `Notes · part ${lo}`,
        lo,
        hi,
        tableIds: slice,
      });
    }
    return { indexTableIds: [], groups, indexPath: `${base}/notes.html` };
  }

  const groups: NoteGroup[] = [];
  const topics = topicByNoteNumber(docModel, titleByTableId);
  for (let i = 0; i < nums.length; i += NOTE_GROUP_SIZE) {
    const slice = nums.slice(i, i + NOTE_GROUP_SIZE);
    const lo = slice[0]!;
    const hi = slice[slice.length - 1]!;
    const tableIds = slice.flatMap((n) => byNum.get(n) ?? []);
    const path =
      lo === hi ? `${base}/notes-${lo}.html` : `${base}/notes-${lo}-${hi}.html`;
    const rangeLabel = lo === hi ? `Note ${lo}` : `Notes ${lo}–${hi}`;
    // Prefer a real note topic for single-note pages; for ranges, tip the
    // first topic so nav is not only "Notes 1–31".
    const topic = (() => {
      for (const n of slice) {
        const fromSec = topics.get(n);
        if (fromSec) return fromSec;
      }
      return null;
    })();
    const label =
      lo === hi && topic
        ? `Note ${lo} · ${topic}`
        : topic
          ? `${rangeLabel} · ${topic}`
          : rangeLabel;
    groups.push({
      path,
      title: topic ? `${rangeLabel} — ${topic}` : rangeLabel,
      nav: label,
      lo,
      hi,
      tableIds,
    });
  }

  // Unnumbered / orphan note tables stay on the index for discovery.
  return { indexTableIds: unnumbered, groups, indexPath: `${base}/notes.html` };
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
  const splitBooks = docModelHasSeparateEntityBooks(docModel);
  const dual = !splitBooks && docModelHasDualEntity(docModel);
  const afsProse =
    sectionHasProse(docModel, "directorsReport") ||
    sectionHasProse(docModel, "auditorReport") ||
    sectionHasProse(docModel, "accountingPolicies");
  const audited = docModel.meta.doc_kind === "annual_audited";
  if (!afsProse && !audited && !dual && !splitBooks) return "interim_short";
  // Prefer separate Group/Company books (MTN) over dual-column bands (Spar).
  if (splitBooks) return "afs_group_company_split";
  if (dual) return "afs_dual_entity";
  if (afsProse || audited) return "afs_group_company_split";
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
  const splitBooks = docModelHasSeparateEntityBooks(docModel);
  const dualEntity = !splitBooks && docModelHasDualEntity(docModel);

  // Map tables → buckets by caption / section title
  const byStatement: Partial<Record<StatementType, string[]>> = {};
  const byStatementEntity: Record<
    "group" | "company",
    Partial<Record<StatementType, string[]>>
  > = { group: {}, company: {} };
  const noteTables: string[] = [];
  const noteTablesEntity: Record<"group" | "company" | "shared", string[]> = {
    group: [],
    company: [],
    shared: [],
  };
  const commentaryTables: string[] = [];

  const titleByTableId = new Map<string, string>();
  for (const sec of docModel.sections) {
    for (const b of sec.blocks) {
      if (b.kind === "table" && b.table_ref) {
        titleByTableId.set(b.table_ref, sec.title?.text ?? sec.statement_type ?? b.table_ref);
        const ent = entityFromTitle(sec.title?.text ?? "") ?? "shared";
        if (sec.statement_type) {
          if (splitBooks && (ent === "group" || ent === "company")) {
            (byStatementEntity[ent][sec.statement_type] ??= []).push(b.table_ref);
          } else {
            (byStatement[sec.statement_type] ??= []).push(b.table_ref);
          }
        } else if (sec.kind === "reviewOfOperations") {
          commentaryTables.push(b.table_ref);
        } else if (
          sec.kind === "note" ||
          sec.kind === "segments" ||
          isNoteTitle(sec.title?.text ?? "")
        ) {
          noteTables.push(b.table_ref);
          noteTablesEntity[ent === "shared" ? "shared" : ent].push(b.table_ref);
        }
      }
    }
  }

  for (const t of docModel.tables) {
    if (
      [...Object.values(byStatement)].some((ids) => ids?.includes(t.id)) ||
      [...Object.values(byStatementEntity.group)].some((ids) => ids?.includes(t.id)) ||
      [...Object.values(byStatementEntity.company)].some((ids) => ids?.includes(t.id)) ||
      noteTables.includes(t.id) ||
      commentaryTables.includes(t.id)
    ) {
      continue;
    }
    const title = titleByTableId.get(t.id) ?? "";
    const ent = entityFromTitle(title) ?? "shared";
    const st = statementTypeForTitle(title);
    if (st) {
      if (splitBooks && (ent === "group" || ent === "company")) {
        (byStatementEntity[ent][st] ??= []).push(t.id);
      } else {
        (byStatement[st] ??= []).push(t.id);
      }
    } else if (isOpsFactsTable(t, title)) {
      commentaryTables.push(t.id);
    } else if (
      isNoteTitle(title) ||
      isNoteLikeTitle(title) ||
      t.table_type === "note" ||
      t.table_type === "reconciliation" ||
      t.table_type === "sensitivity" ||
      t.table_type === "wide"
    ) {
      noteTables.push(t.id);
      noteTablesEntity[ent === "shared" ? "shared" : ent].push(t.id);
    }
    // Do not dump leftover must-appear tables onto the income statement —
    // that is how EPS / Rand Refinery recon stole statement slots.
  }

  // Shared notes on a split AFS default into the Group book.
  if (splitBooks && noteTablesEntity.shared.length) {
    noteTablesEntity.group.push(...noteTablesEntity.shared);
    noteTablesEntity.shared = [];
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

  const emitStatementPages = (
    bucket: Partial<Record<StatementType, string[]>>,
    opts: { entity?: "group" | "company"; dualLabel?: boolean },
  ) => {
    const entity = opts.entity;
    const pathBase = entity ? `financials/${entity}` : "financials";
    const docKind = docModel.meta.doc_kind;
    for (const st of Object.keys(STATEMENT_PATHS) as StatementType[]) {
      const meta = STATEMENT_PATHS[st];
      const ids = bucket[st] ?? [];
      const file = meta.path.replace(/^financials\//, "");
      const path = `${pathBase}/${file}`;
      const sourceTitle = ids
        .map((id) => titleByTableId.get(id) ?? "")
        .find((t) => t.length > 0);
      const titleOpts = {
        docKind,
        statementType: st,
        entity: entity ?? null,
        dualEntity: Boolean(opts.dualLabel && ids.length),
        sourceTitle,
        periodLabel: docModel.meta.period_label,
      };
      const title = officialStatementTitle(titleOpts);
      const navLabel = officialStatementNavLabel(titleOpts);
      pages.push({
        path,
        template: stmtTpl,
        title,
        regions: { [region]: tableInstances(ids, tableComponent, slotName) },
        downloads: [],
      });
      nav.push({ label: navLabel, href: path });
    }
  };

  if (splitBooks) {
    emitStatementPages(byStatementEntity.group, { entity: "group" });
    emitStatementPages(byStatementEntity.company, { entity: "company" });
  } else {
    emitStatementPages(byStatement, { dualLabel: dualEntity });
  }

  const emitNotes = (tables: string[], pathPrefix: string, navPrefix: string) => {
    if (!tables.length && pathPrefix) return;
    const notePlan = planNotePages(docModel, tables, titleByTableId, pathPrefix);
    if (notePlan) {
      pages.push({
        path: notePlan.indexPath,
        template: stmtTpl,
        title: pathPrefix ? `${navPrefix}Notes index` : "Notes index",
        regions: {
          [region]: tableInstances(notePlan.indexTableIds, tableComponent, slotName),
        },
        downloads: [],
      });
      nav.push({
        label: pathPrefix ? `${navPrefix}Notes` : "Notes",
        href: notePlan.indexPath,
      });
      for (const g of notePlan.groups) {
        pages.push({
          path: g.path,
          template: stmtTpl,
          title: pathPrefix ? `${navPrefix}${g.title}` : g.title,
          regions: { [region]: tableInstances(g.tableIds, tableComponent, slotName) },
          downloads: [],
        });
        nav.push({
          label: pathPrefix ? `${navPrefix}${g.nav}` : g.nav,
          href: g.path,
        });
      }
    } else {
      const path = pathPrefix
        ? `financials/${pathPrefix.replace(/\/$/, "")}/notes.html`
        : "financials/notes.html";
      pages.push({
        path,
        template: stmtTpl,
        title: pathPrefix ? `${navPrefix}Notes` : "Notes",
        regions: { [region]: tableInstances(tables, tableComponent, slotName) },
        downloads: [],
      });
      nav.push({
        label: pathPrefix ? `${navPrefix}Notes` : "Notes",
        href: path,
      });
    }
  };

  if (splitBooks) {
    emitNotes(noteTablesEntity.group, "group/", "Group · ");
    emitNotes(noteTablesEntity.company, "company/", "Company · ");
  } else {
    emitNotes(noteTables, "", "");
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
