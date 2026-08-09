import type {
  DocCell,
  ExtractionResult,
  ExtractionTable,
  FinancialDocModel,
  FinTable,
  StatementType,
} from "@rs/contracts";
import {
  classifySectionTitle,
  classifyTable,
  headerRows,
  isWeakTableTitle,
  noteNumberOf,
  statementTypeFromRowLabels,
} from "./classify.js";

/**
 * ExtractionResult → FinancialDocModel. Numbers are NEVER re-interpreted: each
 * cell keeps its verbatim `raw` string and a `src_ref` back to the extraction.
 * Classification only labels; it never rewrites a value. The mapper's `kind`
 * decision (number | text | nil | noteRef) governs how the renderer tags a cell
 * for the audit — it does not alter the displayed string.
 */

const NIL = /^[—–-]$/;
const DIGIT = /[0-9]/;
/** Notes column: "5" or "5, 7" — cross-refs, not financial figures. */
const NOTE_REF = /^\d{1,2}(?:\s*,\s*\d{1,2})*$/;

function cellKind(text: string, isRowHeader: boolean, colIndex: number): DocCell["kind"] {
  const t = text.trim();
  if (t === "") return "text";
  if (NIL.test(t)) return "nil";
  if (isRowHeader || colIndex === 0) return "text";
  if (!DIGIT.test(t)) return "text";
  return "number";
}

type ExtCell = ExtractionTable["cells"][number];

/**
 * Resolve header colspan without inventing columns.
 * Docling often marks the title colspan=2 while also emitting a discrete Notes
 * cell at c+1 — trusting both yields 5 logical cols vs 4 body cols and shreds
 * the table layout (numbers land in the notes col width).
 */
function resolvedHeaderColSpan(
  claimed: number,
  r: number,
  c: number,
  numCols: number,
  byPos: Map<string, ExtCell>,
): number {
  let span = Math.max(1, claimed);
  for (let k = 1; k < span && c + k < numCols; k++) {
    if (byPos.has(`${r}:${c + k}`)) {
      span = 1;
      break;
    }
  }
  return Math.min(span, numCols - c);
}

function buildFinTable(table: ExtractionTable, docTableId: string, mustAppear: boolean): FinTable {
  const nHeader = headerRows(table);
  const byPos = new Map<string, (typeof table.cells)[number]>();
  for (const c of table.cells) byPos.set(`${c.r}:${c.c}`, c);

  // Header matrix: advance by resolved colspan so covered empty slots are skipped.
  const header_matrix = [];
  for (let r = 0; r < nHeader; r++) {
    const row = [];
    for (let c = 0; c < table.num_cols; ) {
      const cell = byPos.get(`${r}:${c}`);
      const col_span = resolvedHeaderColSpan(cell?.col_span ?? 1, r, c, table.num_cols, byPos);
      row.push({
        raw: cell?.text ?? "",
        col_span,
        row_span: cell?.row_span ?? 1,
        src_ref: `ext:${table.id}:r${r}c${c}`,
      });
      c += col_span;
    }
    header_matrix.push(row);
  }

  // Data rows — dense grid (one cell per column).
  const rows = [];
  for (let r = nHeader; r < table.num_rows; r++) {
    const cells: DocCell[] = [];
    for (let c = 0; c < table.num_cols; c++) {
      const cell = byPos.get(`${r}:${c}`);
      const raw = cell?.text ?? "";
      const isRowHeader = cell?.is_row_header ?? false;
      let kind = cellKind(raw, isRowHeader, c);
      if (kind === "number" && NOTE_REF.test(raw.trim()) && c === 1) {
        // Notes column cross-ref — not a data value.
        kind = "noteRef";
      }
      cells.push({
        src_ref: `ext:${table.id}:r${r}c${c}`,
        raw,
        kind,
        footnote_refs: [],
        ...(kind === "noteRef"
          ? { note_number: Number(raw.trim().split(/\s*,\s*/)[0]!) || null }
          : {}),
      });
    }
    rows.push({ cells });
  }

  const cls = classifyTable(table);
  return {
    id: docTableId,
    src_table: `ext:${table.id}`,
    must_appear: mustAppear,
    table_type: cls.table_type,
    header_matrix,
    unit_context: { default: inferDefaultUnit(table), per_row: {} },
    row_groups: [],
    rows,
  };
}

/**
 * Statement tables carry a shared Rm / R'000 banner. Ops/KPI and assumptions
 * grids have a per-row unit column — a global "Unit Rm" chip is wrong there.
 */
function inferDefaultUnit(table: ExtractionTable): string {
  const headerText = table.cells
    .filter((c) => c.is_col_header)
    .map((c) => c.text)
    .join(" ");
  const title = table.cells
    .filter((c) => c.r === 0)
    .sort((a, b) => a.c - b.c)
    .map((c) => c.text)
    .join(" ");
  if (/review\s+of\s+operations/i.test(title)) return "";

  const col1 = table.cells
    .filter((c) => c.c === 1 && c.r > 0)
    .map((c) => c.text.trim())
    .filter(Boolean);
  const unitLike = col1.filter((u) =>
    /^(kg|oz|%|R\b|US\$|R\/|years?\b)/i.test(u),
  ).length;
  if (col1.length >= 2 && unitLike >= Math.ceil(col1.length * 0.5)) return "";

  // SPAR/AFS often use "Rmillion" (no space); DRD uses "Rm" / "R million".
  const m = headerText.match(/\b(R'?000|R\s*million|Rmillion|Rm)\b/i);
  if (m) {
    const raw = m[1]!;
    if (/rmillion/i.test(raw) || /r\s*million/i.test(raw)) return "Rm";
    return raw;
  }
  // Also scan first body column for a unit banner cell ("Rmillion").
  const banner = table.cells
    .filter((c) => c.r > 0 && c.c === 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, 3)
    .map((c) => c.text.trim());
  if (banner.some((t) => /^(R'?000|R\s*million|Rmillion|Rm)$/i.test(t))) {
    return "Rm";
  }
  // Primary statements historically defaulted to Rm when unit sits in period headers.
  if (/statement of|financial position|cash flows|changes in equity/i.test(title)) {
    return "Rm";
  }
  // Dual-entity AFS: row-0 is GROUP/COMPANY but headers carry period dates.
  if (
    /\b(group|company)\b/i.test(title) &&
    /\d{4}/.test(headerText) &&
    table.num_cols >= 4
  ) {
    return "Rm";
  }
  // Equity continuations often have column headers only (Stated capital…) —
  // still Rand millions for JSE AFS primary statements.
  if (
    /stated capital|treasury shares|retained earnings|non-?\s*controlling/i.test(
      headerText,
    ) &&
    table.num_cols >= 4
  ) {
    return "Rm";
  }
  return "";
}

type Body = ExtractionResult["body"];
type BlockNode = Body[number];

function flattenBody(nodes: Body, out: BlockNode[] = []): BlockNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) flattenBody(n.children, out);
  }
  return out;
}

const LETTER_START = /dear shareholder|shareholder letter/i;
const HIGHLIGHTS = /^highlights$/i;
const DIVIDEND = /cash dividend|dividend declaration|salient dates/i;
const NOTES_START = /notes to the condensed|notes to the consolidated|notes to the financial/i;
/** AFS Directors' report — stop before committee reports / primary statements. */
const DIRECTORS_REPORT_START = /directors['']?\s*report/i;
const DIRECTORS_REPORT_STOP =
  /^(audit committee report|remuneration committee|nominations committee|independent auditor|statement of (profit or loss|financial position|changes in equity|cash flows)|notes to the)/i;
/** Accounting policies (often note 1) — stop at the next numbered note. */
const ACCOUNTING_POLICIES_START = /^(?:\d{1,2}\.\s*)?accounting policies\b/i;
const ACCOUNTING_POLICIES_STOP = /^(?:[2-9]|\d{2})\.\s+\S/;
/** Prose ends where the primary statements begin. */
const STATEMENTS_START =
  /statement of (profit or loss|financial position|changes in equity|cash flows)|condensed consolidated financial statements|notes to the/i;
/**
 * Ops band start inside a long shareholder letter — DRD packs Ergo/FWGR/ops
 * summary under these headings rather than a standalone "Review of operations".
 */
const OPS_BAND_START =
  /^(review of operations|group operational\b|operational$|ergo mining proprietary|far west gold recoveries)/i;
/** Trailing letter chrome that belongs with dividend / close, not ops. */
const LETTER_TRAILING_STOP = /^(cash dividend|dividend declaration|looking ahead|ni[eë]l\s)/i;

/**
 * Prose sections from reading-ordered body blocks — deterministic.
 * Letter runs to the first financial-statements heading; notes run from the
 * notes heading to EOF; other lexicon headings take the following prose window.
 */
export function extractProseSections(extraction: ExtractionResult): FinancialDocModel["sections"] {
  const flat = flattenBody(extraction.body);
  const sections: FinancialDocModel["sections"] = [];

  const proseBlocks = (start: number, stop: (b: BlockNode, i: number) => boolean) => {
    const blocks: { kind: "paragraph" | "heading" | "list"; text: string; src_ref: string }[] = [];
    for (let i = start; i < flat.length; i++) {
      const b = flat[i];
      if (i > start && stop(b, i)) break;
      // Section title is stored on the section; skip the opening heading node.
      if (i === start && b.type === "heading") continue;
      if (b.text && (b.type === "paragraph" || b.type === "list_item" || b.type === "heading")) {
        const kind = b.type === "heading" ? "heading" : b.type === "list_item" ? "list" : "paragraph";
        blocks.push({ kind, text: b.text, src_ref: `ext:${b.id}` });
      }
    }
    return blocks;
  };

  const letterStart = flat.findIndex((b) => b.type === "heading" && LETTER_START.test(b.text ?? ""));
  if (letterStart >= 0) {
    const blocks = proseBlocks(letterStart, (b) => b.type === "heading" && STATEMENTS_START.test(b.text ?? ""));
    if (blocks.length) {
      // Prefer a dedicated ops band when the letter swallows operational prose.
      const opsAt = blocks.findIndex(
        (b) => b.kind === "heading" && OPS_BAND_START.test((b.text ?? "").trim()),
      );
      const trailAt = blocks.findIndex(
        (b) => b.kind === "heading" && LETTER_TRAILING_STOP.test((b.text ?? "").trim()),
      );
      let letterBlocks = blocks;
      let opsBlocks: typeof blocks = [];
      if (opsAt >= 0) {
        const opsEnd = trailAt > opsAt ? trailAt : blocks.length;
        letterBlocks = blocks.slice(0, opsAt);
        opsBlocks = blocks.slice(opsAt, opsEnd);
        // Keep post-ops closing narrative (Looking Ahead / signoff) on the letter
        // when it trails the dividend stop — dividend section owns Cash Dividend.
        if (trailAt > opsAt) {
          const after = blocks.slice(trailAt).filter((b) => {
            const t = (b.text ?? "").trim();
            return !DIVIDEND.test(t) && !/^cash dividend$/i.test(t);
          });
          // Looking Ahead + CEO signoff stay with the letter when present after ops.
          const closeStart = after.findIndex(
            (b) => b.kind === "heading" && /^looking ahead/i.test((b.text ?? "").trim()),
          );
          if (closeStart >= 0) letterBlocks = [...letterBlocks, ...after.slice(closeStart)];
        }
      } else if (trailAt >= 0) {
        // No ops heading — still peel Cash Dividend out of the letter body.
        letterBlocks = blocks.slice(0, trailAt);
        const after = blocks.slice(trailAt);
        const closeStart = after.findIndex(
          (b) => b.kind === "heading" && /^looking ahead/i.test((b.text ?? "").trim()),
        );
        if (closeStart >= 0) letterBlocks = [...letterBlocks, ...after.slice(closeStart)];
      }
      if (letterBlocks.length) {
        sections.push({
          id: "doc:sec_letter",
          kind: "letter",
          title: {
            text: flat[letterStart].text ?? "Shareholder letter",
            src_ref: `ext:${flat[letterStart].id}`,
          },
          blocks: letterBlocks,
          items: [],
        });
      }
      if (opsBlocks.length) {
        sections.push({
          id: "doc:sec_reviewOfOperations",
          kind: "reviewOfOperations",
          title: {
            text: opsBlocks[0]?.text?.trim() || "Review of operations",
            src_ref: opsBlocks[0]?.src_ref ?? `ext:${flat[letterStart].id}`,
          },
          blocks: opsBlocks,
          items: [],
        });
      }
    }
  }

  const hiStart = flat.findIndex((b) => b.type === "heading" && HIGHLIGHTS.test((b.text ?? "").trim()));
  if (hiStart >= 0) {
    const blocks = proseBlocks(hiStart, (b) => b.type === "heading");
    if (blocks.length)
      sections.push({
        id: "doc:sec_highlights",
        kind: "highlights",
        title: { text: "Highlights", src_ref: `ext:${flat[hiStart].id}` },
        blocks,
        items: [],
      });
  }

  const divStart = flat.findIndex((b) => b.type === "heading" && DIVIDEND.test(b.text ?? ""));
  if (divStart >= 0) {
    const blocks = proseBlocks(divStart, (b) => b.type === "heading" && !DIVIDEND.test(b.text ?? ""));
    if (blocks.length)
      sections.push({
        id: "doc:sec_dividend",
        kind: "dividendDeclaration",
        title: { text: flat[divStart].text ?? "Cash dividend", src_ref: `ext:${flat[divStart].id}` },
        blocks,
        items: [],
      });
  }

  const notesStart = flat.findIndex((b) => b.type === "heading" && NOTES_START.test(b.text ?? ""));
  if (notesStart >= 0) {
    const blocks = proseBlocks(notesStart, () => false);
    if (blocks.length)
      sections.push({
        id: "doc:sec_notes",
        kind: "note",
        title: { text: flat[notesStart].text ?? "Notes", src_ref: `ext:${flat[notesStart].id}` },
        blocks,
        items: [],
      });
  }

  // AFS Directors' report — primary narrative when there is no shareholder letter.
  const drStart = flat.findIndex(
    (b) => b.type === "heading" && DIRECTORS_REPORT_START.test((b.text ?? "").trim()),
  );
  if (drStart >= 0) {
    const blocks = proseBlocks(
      drStart,
      (b) => b.type === "heading" && DIRECTORS_REPORT_STOP.test((b.text ?? "").trim()),
    );
    if (blocks.length)
      sections.push({
        id: "doc:sec_directorsReport",
        kind: "directorsReport",
        title: {
          text: flat[drStart].text ?? "Directors' report",
          src_ref: `ext:${flat[drStart].id}`,
        },
        blocks,
        items: [],
      });
  }

  // Accounting policies intro (note 1) — stop at note 2+; cap length for microsite density.
  const apStart = flat.findIndex(
    (b) => b.type === "heading" && ACCOUNTING_POLICIES_START.test((b.text ?? "").trim()),
  );
  if (apStart >= 0) {
    const blocks = proseBlocks(apStart, (b, i) => {
      if (b.type !== "heading") return false;
      const t = (b.text ?? "").trim();
      if (ACCOUNTING_POLICIES_STOP.test(t)) return true;
      // Soft cap: after ~45 prose nodes the dedicated page is dense enough.
      return i - apStart > 55;
    });
    if (blocks.length)
      sections.push({
        id: "doc:sec_accountingPolicies",
        kind: "accountingPolicies",
        title: {
          text: flat[apStart].text ?? "Accounting policies",
          src_ref: `ext:${flat[apStart].id}`,
        },
        blocks,
        items: [],
      });
  }

  // Lexicon-driven short sections on the cover (shareholder info, directors, …).
  const seenKinds = new Set(sections.map((s) => s.kind));
  for (let i = 0; i < flat.length; i++) {
    const b = flat[i];
    if (b.type !== "heading" || !b.text) continue;
    const { kind } = classifySectionTitle(b.text);
    if (
      kind === "other" ||
      kind === "statement" ||
      kind === "letter" ||
      kind === "highlights" ||
      kind === "dividendDeclaration" ||
      kind === "note" ||
      kind === "directorsReport" ||
      kind === "accountingPolicies" ||
      seenKinds.has(kind)
    ) {
      continue;
    }
    const blocks = proseBlocks(i, (n) => n.type === "heading");
    if (!blocks.length) continue;
    seenKinds.add(kind);
    sections.push({
      id: `doc:sec_${kind}`,
      kind,
      title: { text: b.text, src_ref: `ext:${b.id}` },
      blocks,
      items: [],
    });
  }

  return sections;
}

type SectionMarker = {
  page: number;
  title: string;
  kind: "statement" | "note" | "reviewOfOperations" | "other";
  statement_type?: StatementType;
};

function walkBlocks(nodes: BlockNode[] | undefined, visit: (b: BlockNode) => void): void {
  if (!nodes?.length) return;
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.shift()!;
    visit(n);
    if (n.children?.length) stack.push(...n.children);
  }
}

/**
 * Collect statement / notes / ops headings with page numbers so dual-entity AFS
 * tables whose row-0 is "GROUP"/"COMPANY" still route to the right statement page.
 */
function collectSectionMarkers(extraction: ExtractionResult): SectionMarker[] {
  const markers: SectionMarker[] = [];
  const seen = new Set<string>();
  const push = (title: string, page: number) => {
    const cleaned = title.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned || page < 1) return;
    const cls = classifySectionTitle(cleaned);
    let kind: SectionMarker["kind"] = "other";
    if (cls.statement_type) kind = "statement";
    else if (cls.kind === "note" || /^notes?\s+to\s+the\b/i.test(cleaned)) kind = "note";
    else if (cls.kind === "reviewOfOperations") kind = "reviewOfOperations";
    else return;
    const key = `${page}|${kind}|${cls.statement_type ?? ""}|${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    markers.push({ page, title: cleaned, kind, statement_type: cls.statement_type });
  };

  walkBlocks(extraction.body, (b) => {
    if (b.type !== "heading" || !b.text) return;
    const page = b.prov?.[0]?.page_no ?? 0;
    push(b.text, page);
  });
  for (const sec of extraction.enrichment?.sections ?? []) {
    const page = sec.page_span?.[0] ?? 0;
    push(sec.title, page);
  }
  markers.sort((a, b) => a.page - b.page || a.title.localeCompare(b.title));
  return markers;
}

function activeMarkerForPage(markers: SectionMarker[], page: number): SectionMarker | null {
  let active: SectionMarker | null = null;
  for (const m of markers) {
    if (m.page <= page) active = m;
    else break;
  }
  return active;
}

function extractionTableTitle(
  table: ExtractionTable,
  extId: string,
  markers: SectionMarker[],
): { title: string; statement_type?: StatementType; forceNote?: boolean; forceOps?: boolean } {
  const caption = table.caption_block?.trim() ?? "";
  if (caption) {
    const cls = classifySectionTitle(caption);
    if (cls.statement_type || cls.kind === "note" || cls.kind === "reviewOfOperations") {
      return {
        title: caption,
        statement_type: cls.statement_type,
        forceNote: cls.kind === "note",
        forceOps: cls.kind === "reviewOfOperations",
      };
    }
  }

  const page = table.prov?.[0]?.page_no ?? 0;
  const marker = page > 0 ? activeMarkerForPage(markers, page) : null;
  if (marker?.kind === "statement" && marker.statement_type) {
    return { title: marker.title, statement_type: marker.statement_type };
  }
  if (marker?.kind === "note") {
    return { title: marker.title, forceNote: true };
  }
  if (marker?.kind === "reviewOfOperations") {
    return { title: marker.title, forceOps: true };
  }

  const fromRows = statementTypeFromRowLabels(table);
  if (fromRows) {
    const labelTitle =
      fromRows === "financial_position"
        ? "Statement of financial position"
        : fromRows === "cash_flows"
          ? "Statement of cash flows"
          : fromRows === "changes_in_equity"
            ? "Statement of changes in equity"
            : "Statement of profit or loss and other comprehensive income";
    return { title: labelTitle, statement_type: fromRows };
  }

  if (caption && !isWeakTableTitle(caption)) return { title: caption };

  const row0 = table.cells
    .filter((c) => c.r === 0)
    .sort((a, b) => a.c - b.c)
    .map((c) => c.text.trim())
    .filter(Boolean);
  if (row0[0] && !isWeakTableTitle(row0[0])) return { title: row0[0] };

  return { title: caption || row0[0] || `Table ${extId}` };
}

export function mapToDocModel(
  extraction: ExtractionResult,
  meta: FinancialDocModel["meta"],
): FinancialDocModel {
  const tables: FinTable[] = [];
  const sections: FinancialDocModel["sections"] = [...extractProseSections(extraction)];
  const markers = collectSectionMarkers(extraction);

  let i = 0;
  for (const [extId, table] of Object.entries(extraction.tables)) {
    const cls = classifyTable(table);
    // Full-document fidelity: include every extracted table (ops, facts, notes).
    i++;
    const docId = `doc:tbl_${i}`;
    const mustAppear = true;
    tables.push(buildFinTable(table, docId, mustAppear));
    const resolved = extractionTableTitle(table, extId, markers);
    const title = resolved.title;
    const titleCls = classifySectionTitle(title);
    const noteNum = noteNumberOf(title);
    const statement_type =
      resolved.statement_type ?? titleCls.statement_type ?? cls.statement_type;
    const sectionKind =
      resolved.forceNote || noteNum != null || titleCls.kind === "note"
        ? ("note" as const)
        : resolved.forceOps || cls.table_type === "facts" || titleCls.kind === "reviewOfOperations"
          ? ("reviewOfOperations" as const)
          : cls.table_type === "sensitivity" || /segment/i.test(title) || titleCls.kind === "segments"
            ? ("segments" as const)
            : statement_type || cls.is_financial
              ? ("statement" as const)
              : ("other" as const);
    sections.push({
      id: `doc:sec_tbl_${i}`,
      kind: sectionKind,
      // Notes band must not keep a prior statement_type from nearest-heading bleed.
      statement_type: sectionKind === "statement" ? statement_type : undefined,
      note_number: noteNum ?? undefined,
      title: { text: title, src_ref: `ext:${extId}:r0c0` },
      blocks: [{ kind: "table", table_ref: docId }],
      items: [],
    });
  }

  return {
    schema_version: "docmodel/1",
    doc_model_id: `dm_${extraction.extraction_id}`,
    extraction_id: extraction.extraction_id,
    content_hash: extraction.source.sha256,
    meta,
    sections,
    tables,
    footnotes: [],
    mapping_review: [],
  };
}
