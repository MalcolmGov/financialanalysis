/**
 * Ground Studio Chat in PDF extraction / DocModel evidence so HTML edits
 * stay accurate without inventing figures. Retrieves page-relevant slices
 * when the full extraction exceeds the prompt budget.
 */

import type {
  ExtractionResult,
  FinancialDocModel,
  FinTable,
  SitePlan,
} from "@rs/contracts";
import { mapToDocModel } from "@rs/mapper";
import { inferDocKind } from "@rs/render";

/** Soft cap for SOURCE EXTRACTION CONTEXT block (chars). */
export const SITE_CHAT_EXTRACTION_CHAR_BUDGET = 90_000;

export type SiteChatPageMeta = { path: string; title: string };

export type ExtractionEvidenceChunk = {
  id: string;
  kind: "meta" | "section" | "table" | "note" | "kpi" | "page_text" | "inventory";
  /** Ranking score — higher = more relevant to selected page + operator request. */
  score: number;
  text: string;
};

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "please",
  "make",
  "fix",
  "update",
  "change",
  "html",
  "page",
  "this",
  "that",
  "from",
  "into",
  "add",
  "remove",
  "set",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%.\-_/ ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function overlapScore(haystack: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const h = haystack.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (h.includes(t)) hits += 1;
  }
  return hits;
}

/** Map IR page paths → DocModel affinities used for retrieval boosts. */
export function pagePathAffinities(pagePath: string): {
  sectionKinds: string[];
  statementTypes: string[];
  noteFocus: boolean;
  homeFocus: boolean;
  commentaryFocus: boolean;
  entity?: "group" | "company";
} {
  const p = pagePath.replace(/^\//, "").toLowerCase();
  const entity = p.includes("/group/")
    ? ("group" as const)
    : p.includes("/company/")
      ? ("company" as const)
      : undefined;

  if (p === "index.html" || p.endsWith("/index.html")) {
    return {
      sectionKinds: ["cover", "highlights", "shareholderInfo", "marketCap", "issuedCapital"],
      statementTypes: [],
      noteFocus: false,
      homeFocus: true,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("commentary")) {
    return {
      sectionKinds: [
        "letter",
        "reviewOfOperations",
        "dividendDeclaration",
        "highlights",
        "segments",
        "forwardLooking",
      ],
      statementTypes: [],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: true,
      entity,
    };
  }
  if (p.includes("directors-report") || p.includes("directors_report")) {
    return {
      sectionKinds: ["directorsReport", "directors"],
      statementTypes: [],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("auditor")) {
    return {
      sectionKinds: ["auditorReport"],
      statementTypes: [],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("accounting") || p.includes("policies")) {
    return {
      sectionKinds: ["accountingPolicies"],
      statementTypes: [],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("note")) {
    return {
      sectionKinds: ["note"],
      statementTypes: [],
      noteFocus: true,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("income") || p.includes("pnl") || p.includes("oci")) {
    return {
      sectionKinds: ["statement"],
      statementTypes: ["pnl_oci"],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("balance") || p.includes("financial-position") || p.includes("position")) {
    return {
      sectionKinds: ["statement"],
      statementTypes: ["financial_position"],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("equity")) {
    return {
      sectionKinds: ["statement"],
      statementTypes: ["changes_in_equity"],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("cash")) {
    return {
      sectionKinds: ["statement", "cashReconciliation"],
      statementTypes: ["cash_flows"],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  if (p.includes("download")) {
    return {
      sectionKinds: ["contacts", "disclaimers"],
      statementTypes: [],
      noteFocus: false,
      homeFocus: false,
      commentaryFocus: false,
      entity,
    };
  }
  return {
    sectionKinds: [],
    statementTypes: [],
    noteFocus: false,
    homeFocus: false,
    commentaryFocus: false,
    entity,
  };
}

function noteRangeFromPath(pagePath: string): { lo: number; hi: number } | null {
  // e.g. financials/notes-1-20.html or notes-21-40.html
  const m = pagePath.match(/notes?-(\d+)-(\d+)/i);
  if (!m) return null;
  return { lo: Number(m[1]), hi: Number(m[2]) };
}

function formatTableSlice(table: FinTable, maxRows = 48): string {
  const headers =
    table.header_matrix.at(-1)?.map((h) => h.raw).join(" | ") ??
    `(${table.rows[0]?.cells.length ?? "?"} cols)`;
  const rows = table.rows.slice(0, maxRows).map((r) =>
    r.cells.map((c) => c.raw).join(" | "),
  );
  const more =
    table.rows.length > maxRows ? `\n… (+${table.rows.length - maxRows} rows omitted)` : "";
  return [
    `TABLE ${table.id} type=${table.table_type} must_appear=${table.must_appear}`,
    `headers: ${headers}`,
    ...rows,
    more,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSectionSlice(
  sec: FinancialDocModel["sections"][number],
  maxChars = 12_000,
): string {
  const title = sec.title?.text ?? sec.kind;
  const head = [
    `SECTION ${sec.id} kind=${sec.kind}` +
      (sec.statement_type ? ` statement=${sec.statement_type}` : "") +
      (sec.note_number != null ? ` note=${sec.note_number}` : ""),
    `title: ${title}`,
  ];
  const body: string[] = [];
  for (const b of sec.blocks ?? []) {
    if (b.kind === "table" && b.table_ref) {
      body.push(`[table_ref ${b.table_ref}]`);
      continue;
    }
    if (b.text) body.push(`[${b.kind}] ${b.text}`);
  }
  for (const item of sec.items ?? []) {
    body.push(`• ${item.label.text}: ${item.value.raw}`);
  }
  let text = [...head, ...body].join("\n");
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… (section truncated)`;
  }
  return text;
}

function entityBoost(title: string, entity?: "group" | "company"): number {
  if (!entity) return 0;
  const t = title.toLowerCase();
  if (entity === "group" && /\bgroup\b/.test(t)) return 8;
  if (entity === "company" && /\bcompany\b/.test(t)) return 8;
  if (entity === "group" && /\bcompany\b/.test(t) && !/\bgroup\b/.test(t)) return -4;
  if (entity === "company" && /\bgroup\b/.test(t) && !/\bcompany\b/.test(t)) return -4;
  return 0;
}

function collectPageTexts(
  extraction: ExtractionResult,
  pageNos: number[],
  maxCharsPerPage = 4_500,
): ExtractionEvidenceChunk[] {
  const wanted = new Set(pageNos.filter((n) => n > 0));
  if (!wanted.size) return [];

  const byPage = new Map<number, string[]>();
  const walk = (nodes: ExtractionResult["body"], fallbackPage?: number) => {
    for (const n of nodes) {
      const page =
        n.prov?.[0]?.page_no ??
        fallbackPage ??
        undefined;
      if (n.text && page && wanted.has(page)) {
        const arr = byPage.get(page) ?? [];
        arr.push(n.text);
        byPage.set(page, arr);
      }
      if (n.children?.length) walk(n.children, page);
    }
  };
  walk(extraction.body);

  const chunks: ExtractionEvidenceChunk[] = [];
  for (const page of [...wanted].sort((a, b) => a - b)) {
    const parts = byPage.get(page);
    if (!parts?.length) continue;
    let text = parts.join("\n");
    if (text.length > maxCharsPerPage) {
      text = `${text.slice(0, maxCharsPerPage)}\n… (page text truncated)`;
    }
    chunks.push({
      id: `page:${page}`,
      kind: "page_text",
      score: 12,
      text: `PAGE ${page} TEXT (verbatim from extraction):\n${text}`,
    });
  }
  return chunks;
}

function tablePageNos(extraction: ExtractionResult, table: FinTable): number[] {
  const src = table.src_table?.replace(/^ext:/, "") ?? "";
  const extTable = extraction.tables[src];
  if (!extTable?.prov?.length) return [];
  return [...new Set(extTable.prov.map((p) => p.page_no).filter(Boolean))];
}

/**
 * Build ranked extraction evidence for the chat prompt.
 * Always includes doc meta + section inventory; then page- and query-relevant
 * DocModel sections/tables and related page prose.
 */
export function buildExtractionEvidence(opts: {
  extraction: ExtractionResult;
  docModel: FinancialDocModel;
  pagePath: string;
  message: string;
  pages?: SiteChatPageMeta[];
  sitePlan?: SitePlan | null;
  budget?: number;
}): {
  text: string;
  truncated: boolean;
  chunkCount: number;
  selectedIds: string[];
} {
  const budget = opts.budget ?? SITE_CHAT_EXTRACTION_CHAR_BUDGET;
  const aff = pagePathAffinities(opts.pagePath);
  const noteRange = noteRangeFromPath(opts.pagePath);
  const qTokens = tokenize(opts.message);
  const pathTokens = tokenize(opts.pagePath.replace(/\.html$/, "").replace(/[-_/]/g, " "));

  const chunks: ExtractionEvidenceChunk[] = [];

  const meta = opts.docModel.meta;
  chunks.push({
    id: "meta",
    kind: "meta",
    score: 1_000,
    text: [
      `DOC META: company=${meta.company}; period=${meta.period_label}; doc_kind=${meta.doc_kind}; currency=${meta.currency}`,
      `EXTRACTION: id=${opts.extraction.extraction_id}; pages=${opts.extraction.source.page_count}; sha256=${opts.extraction.source.sha256.slice(0, 16)}…`,
      `PDF title: ${opts.extraction.source.pdf_meta?.title || "(none)"}`,
    ].join("\n"),
  });

  const kpis = opts.extraction.enrichment?.key_figures?.slice(0, 16) ?? [];
  if (kpis.length) {
    chunks.push({
      id: "kpis",
      kind: "kpi",
      score: aff.homeFocus || aff.commentaryFocus ? 80 : 25,
      text: [
        "KEY FIGURES (verbatim enrichment — do not invent beyond these / tables):",
        ...kpis.map(
          (k) =>
            `- ${k.label}: ${k.value_raw}` +
            (k.comparative_raw ? ` (comp ${k.comparative_raw})` : "") +
            ` [p${k.page}]`,
        ),
      ].join("\n"),
    });
  }

  const inventoryLines = opts.docModel.sections.map((s) => {
    const title = s.title?.text ?? s.kind;
    return `- ${s.id} | ${s.kind}${s.statement_type ? `/${s.statement_type}` : ""}${
      s.note_number != null ? ` #${s.note_number}` : ""
    }: ${title}`;
  });
  chunks.push({
    id: "inventory",
    kind: "inventory",
    score: 900,
    text: [
      `SECTION INVENTORY (${opts.docModel.sections.length} sections, ${opts.docModel.tables.length} tables):`,
      ...inventoryLines.slice(0, 200),
      inventoryLines.length > 200 ? `… (+${inventoryLines.length - 200} more)` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  if (opts.pages?.length) {
    chunks.push({
      id: "sitemap",
      kind: "inventory",
      score: 850,
      text: [
        "SITE STRUCTURE (draft pages):",
        ...opts.pages.map((p) => `- ${p.path} — ${p.title}`),
      ].join("\n"),
    });
  } else if (opts.sitePlan?.nav?.length) {
    chunks.push({
      id: "sitemap",
      kind: "inventory",
      score: 850,
      text: [
        "SITE NAV:",
        ...opts.sitePlan.nav.map((n) => `- ${n.href} — ${n.label}`),
      ].join("\n"),
    });
  }

  const tableById = new Map(opts.docModel.tables.map((t) => [t.id, t]));
  const relatedPageNos = new Set<number>();

  for (const sec of opts.docModel.sections) {
    const title = sec.title?.text ?? "";
    let score = 0;
    if (aff.sectionKinds.includes(sec.kind)) score += 40;
    if (sec.statement_type && aff.statementTypes.includes(sec.statement_type)) score += 50;
    if (aff.noteFocus && sec.kind === "note") score += 30;
    if (noteRange && sec.note_number != null) {
      if (sec.note_number >= noteRange.lo && sec.note_number <= noteRange.hi) score += 55;
      else score -= 20;
    }
    score += entityBoost(title, aff.entity);
    score += overlapScore(`${title} ${sec.kind} ${sec.statement_type ?? ""}`, qTokens) * 6;
    score += overlapScore(title, pathTokens) * 3;

    // Always keep a floor for notes/statements on their pages
    if (score < 15 && aff.sectionKinds.includes(sec.kind)) score = 15;
    if (score <= 0) continue;

    chunks.push({
      id: `sec:${sec.id}`,
      kind: sec.kind === "note" ? "note" : "section",
      score,
      text: formatSectionSlice(sec),
    });

    for (const b of sec.blocks ?? []) {
      if (b.kind !== "table" || !b.table_ref) continue;
      const table = tableById.get(b.table_ref);
      if (!table) continue;
      let tScore = score + 5;
      tScore += overlapScore(formatTableSlice(table, 8), qTokens) * 2;
      chunks.push({
        id: `tbl:${table.id}`,
        kind: "table",
        score: tScore,
        text: formatTableSlice(table),
      });
      for (const pn of tablePageNos(opts.extraction, table)) relatedPageNos.add(pn);
    }
  }

  // Orphan must-appear tables not linked from a scored section
  for (const table of opts.docModel.tables) {
    if (chunks.some((c) => c.id === `tbl:${table.id}`)) continue;
    let score = table.must_appear ? 8 : 2;
    score += overlapScore(formatTableSlice(table, 6), [...qTokens, ...pathTokens]) * 4;
    if (aff.statementTypes.length && table.table_type === "statement") score += 10;
    if (aff.noteFocus && table.table_type === "note") score += 12;
    if (score < 12) continue;
    chunks.push({
      id: `tbl:${table.id}`,
      kind: "table",
      score,
      text: formatTableSlice(table),
    });
    for (const pn of tablePageNos(opts.extraction, table)) relatedPageNos.add(pn);
  }

  // Enrichment section titles that match the query (page-span hints)
  for (const es of opts.extraction.enrichment?.sections ?? []) {
    const s = overlapScore(`${es.title}`, [...qTokens, ...pathTokens]);
    if (s < 1 && !aff.noteFocus) continue;
    const score = 10 + s * 5;
    chunks.push({
      id: `enrich:${es.id}`,
      kind: "section",
      score,
      text: `ENRICHMENT SECTION “${es.title}” pages ${es.page_span[0]}–${es.page_span[1]}`,
    });
    for (let p = es.page_span[0]; p <= Math.min(es.page_span[1], es.page_span[0] + 2); p++) {
      relatedPageNos.add(p);
    }
  }

  chunks.push(...collectPageTexts(opts.extraction, [...relatedPageNos].slice(0, 8)));

  chunks.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const selected: ExtractionEvidenceChunk[] = [];
  const selectedIds: string[] = [];
  let used = 0;
  let truncated = false;

  const headerLines = [
    "SOURCE EXTRACTION CONTEXT (verbatim from PDF extraction / DocModel — ground truth for figures & wording):",
    "Rules for you: Prefer these strings when fixing labels, note titles, commentary, or table presentation.",
    "NEVER invent financial numbers. If a figure is not present here or in the current HTML, leave it unchanged or ask.",
    "Preserve Gate A/B digit integrity unless the operator explicitly authorized a number override.",
  ];
  const headerReserve = headerLines.join("\n").length + 160;
  const bodyBudget = Math.max(800, budget - headerReserve);

  // Prefer meta/inventory/sitemap, then relevance-ranked evidence.
  const must = chunks.filter((c) => c.score >= 800);
  const rest = chunks.filter((c) => c.score < 800);

  for (const c of [...must, ...rest]) {
    const piece = `\n\n---\n${c.text}`;
    if (used + piece.length <= bodyBudget) {
      selected.push(c);
      selectedIds.push(c.id);
      used += piece.length;
      continue;
    }
    const room = bodyBudget - used - 40;
    if (room >= 280) {
      selected.push({ ...c, text: `${c.text.slice(0, room)}\n… (truncated for budget)` });
      selectedIds.push(c.id);
      used += room;
    }
    truncated = true;
    break;
  }

  if (!truncated && used >= bodyBudget - 20) truncated = true;

  const header = [
    ...headerLines,
    truncated
      ? `Context was budget-truncated (${selected.length} chunks). Prefer surgical edits on the selected page; ask to switch pages for other sections.`
      : `Included ${selected.length} evidence chunks within budget.`,
  ].join("\n");

  let text = `${header}${selected.map((c) => `\n\n---\n${c.text}`).join("")}`;
  if (text.length > budget) {
    text = `${text.slice(0, Math.max(0, budget - 40))}\n… (truncated for budget)`;
    truncated = true;
  }

  return {
    text,
    truncated,
    chunkCount: selected.length,
    selectedIds,
  };
}

export function mapExtractionToDocModelForChat(
  extraction: ExtractionResult,
  company: string,
  periodLabel: string,
): FinancialDocModel {
  const coverTexts: string[] = [];
  for (const b of extraction.body.slice(0, 40)) {
    if (b.text) coverTexts.push(b.text);
    for (const c of b.children ?? []) {
      if (c.text) coverTexts.push(c.text);
    }
  }
  const title = extraction.source.pdf_meta?.title ?? "";
  const doc_kind = inferDocKind([...coverTexts, title], periodLabel);
  return mapToDocModel(extraction, {
    company,
    period_label: periodLabel,
    doc_kind,
    currency: "ZAR",
  });
}

export function summarizeSiteStructure(pages: SiteChatPageMeta[]): string {
  if (!pages.length) return "(no pages listed)";
  return pages.map((p) => `- ${p.path} — ${p.title}`).join("\n");
}
