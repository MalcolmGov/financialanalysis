import { deflateRawSync } from "node:zlib";
import type { FinancialDocModel, FinTable, StatementType } from "@rs/contracts";

/**
 * ExcelExporter — FinTables → multi-sheet + per-statement XLSX binaries.
 * Cell values are the FinTable `raw` strings verbatim (no invented figures,
 * no numeric reinterpretation that would drop thin-space grouping).
 */

export interface ExcelSheetSpec {
  /** Excel sheet tab name (≤31 chars). */
  name: string;
  /** Stable file slug for per-statement workbooks. */
  slug: string;
  table: FinTable;
  statementType?: StatementType;
}

export interface ExcelExportResult {
  /** Path → XLSX bytes (e.g. assets/excel/financial-statements.xlsx). */
  files: Record<string, Uint8Array>;
  /** Sheet names in the multi-sheet workbook (order). */
  workbookSheetNames: string[];
  /** Per-statement relative hrefs for downloads / toolbars. */
  statementFiles: Array<{ label: string; href: string; slug: string }>;
  workbookHref: string;
}

const STATEMENT_META: Record<
  StatementType,
  { sheet: string; slug: string; label: string }
> = {
  pnl_oci: {
    sheet: "Income statement",
    slug: "income-statement",
    label: "Income statement",
  },
  financial_position: {
    sheet: "Financial position",
    slug: "balance-sheet",
    label: "Statement of financial position",
  },
  changes_in_equity: {
    sheet: "Changes in equity",
    slug: "changes-in-equity",
    label: "Changes in equity",
  },
  cash_flows: {
    sheet: "Cash flows",
    slug: "cash-flows",
    label: "Cash flows",
  },
};

const STATEMENT_ORDER: StatementType[] = [
  "pnl_oci",
  "financial_position",
  "changes_in_equity",
  "cash_flows",
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
  if (base.length > 31) base = base.slice(0, 31).trim();
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${i}`;
    candidate = (base.slice(0, Math.max(1, 31 - suffix.length)) + suffix).trim();
    i++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Collect statement (+ optional note) sheets from the DocModel. */
export function collectExcelSheets(docModel: FinancialDocModel): ExcelSheetSpec[] {
  const tableById = new Map(docModel.tables.map((t) => [t.id, t]));
  const byType: Partial<Record<StatementType, FinTable[]>> = {};
  const noteTables: Array<{ table: FinTable; note?: number; title?: string }> = [];
  const seen = new Set<string>();

  for (const sec of docModel.sections) {
    for (const b of sec.blocks) {
      if (b.kind !== "table" || !b.table_ref) continue;
      const table = tableById.get(b.table_ref);
      if (!table || seen.has(table.id)) continue;
      if (sec.statement_type) {
        seen.add(table.id);
        (byType[sec.statement_type] ??= []).push(table);
      } else if (sec.kind === "note" || sec.kind === "cashReconciliation") {
        seen.add(table.id);
        if (sec.kind === "cashReconciliation") {
          (byType.cash_flows ??= []).push(table);
        } else {
          noteTables.push({
            table,
            note: sec.note_number,
            title: sec.title?.text,
          });
        }
      }
    }
  }

  // Fallback: classify unassigned must-appear / statement tables by title cues
  // already reflected in section statement_type when present; otherwise attach
  // leftover statement tables in table order under pnl as last resort is avoided —
  // only include tables with known statement_type or note kind.
  for (const t of docModel.tables) {
    if (seen.has(t.id)) continue;
    if (t.table_type === "note") {
      seen.add(t.id);
      noteTables.push({ table: t });
    }
  }

  const usedNames = new Set<string>();
  const sheets: ExcelSheetSpec[] = [];

  for (const st of STATEMENT_ORDER) {
    const tables = byType[st] ?? [];
    const meta = STATEMENT_META[st];
    tables.forEach((table, idx) => {
      const sheetBase = idx === 0 ? meta.sheet : `${meta.sheet} ${idx + 1}`;
      const slug = idx === 0 ? meta.slug : `${meta.slug}-${idx + 1}`;
      sheets.push({
        name: sanitizeSheetName(sheetBase, usedNames),
        slug,
        table,
        statementType: st,
      });
    });
  }

  // Notes as appropriate — cap to keep workbook IR-readable
  for (const n of noteTables.slice(0, 8)) {
    const label =
      n.note != null
        ? `Note ${n.note}`
        : n.title?.replace(/^(\d{1,2})\.\s+/, "Note $1 — ").slice(0, 31) || "Notes";
    sheets.push({
      name: sanitizeSheetName(label, usedNames),
      slug: n.note != null ? `note-${n.note}` : `note-${sheets.length + 1}`,
      table: n.table,
    });
  }

  // If DocModel only has tables without section links (tests), export all statement tables.
  if (sheets.length === 0 && docModel.tables.length) {
    docModel.tables.forEach((table, i) => {
      const st = docModel.sections.find((s) =>
        s.blocks.some((b) => b.kind === "table" && b.table_ref === table.id),
      )?.statement_type;
      const meta = st ? STATEMENT_META[st] : null;
      sheets.push({
        name: sanitizeSheetName(meta?.sheet ?? `Table ${i + 1}`, usedNames),
        slug: meta?.slug ?? `table-${i + 1}`,
        table,
        statementType: st,
      });
    });
  }

  return sheets;
}

function sheetXml(table: FinTable): string {
  const rows: string[] = [];
  let r = 1;
  for (const headerRow of table.header_matrix) {
    let c = 0;
    const cells: string[] = [];
    for (const h of headerRow) {
      const ref = `${colLetter(c)}${r}`;
      const text = escapeXml(h.raw);
      cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`);
      c += Math.max(1, h.col_span ?? 1);
    }
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
    r++;
  }
  for (const row of table.rows) {
    const cells = row.cells.map((cell, c) => {
      const ref = `${colLetter(c)}${r}`;
      const text = escapeXml(cell.raw);
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    });
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
    r++;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function workbookXml(sheetNames: string[]): string {
  const sheets = sheetNames
    .map(
      (name, i) =>
        `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(count: number): string {
  const rels = Array.from({ length: count }, (_, i) => {
    return `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function contentTypesXml(count: number): string {
  const overrides = Array.from({ length: count }, (_, i) => {
    return `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/** CRC-32 (ISO 3309 / ZIP). */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** Build a ZIP (deflated entries) from path → UTF-8 / binary contents. */
export function zipDeflated(files: Record<string, string | Uint8Array>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, raw] of Object.entries(files)) {
    const data = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const localOffset = offset;
    locals.push(local, compressed);
    offset += local.length + compressed.length;

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...locals, centralDir, end]));
}

/** Build an XLSX workbook from sheet specs (verbatim FinTable cells). */
export function buildWorkbookXlsx(sheets: ExcelSheetSpec[]): Uint8Array {
  if (!sheets.length) {
    throw new Error("buildWorkbookXlsx: no sheets");
  }
  const names = sheets.map((s) => s.name);
  const files: Record<string, string> = {
    "[Content_Types].xml": contentTypesXml(sheets.length),
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(names),
    "xl/_rels/workbook.xml.rels": workbookRelsXml(sheets.length),
  };
  sheets.forEach((spec, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(spec.table);
  });
  return zipDeflated(files);
}

export const WORKBOOK_HREF = "assets/excel/financial-statements.xlsx";
export const SOURCE_PDF_HREF = "assets/source.pdf";

/**
 * Export multi-sheet workbook + per-statement (and notes) XLSX files.
 * Paths are relative to the multipage zip root.
 */
export function exportExcelFromDocModel(docModel: FinancialDocModel): ExcelExportResult {
  const sheets = collectExcelSheets(docModel);
  const files: Record<string, Uint8Array> = {};
  const workbookSheetNames = sheets.map((s) => s.name);

  if (sheets.length) {
    files[WORKBOOK_HREF] = buildWorkbookXlsx(sheets);
  }

  // Per-statement single-sheet workbooks (first table per statement type).
  const statementFiles: Array<{ label: string; href: string; slug: string }> = [];
  const seenSlug = new Set<string>();
  for (const st of STATEMENT_ORDER) {
    const first = sheets.find((s) => s.statementType === st);
    if (!first) continue;
    if (seenSlug.has(first.slug)) continue;
    seenSlug.add(first.slug);
    const href = `assets/excel/${first.slug}.xlsx`;
    files[href] = buildWorkbookXlsx([first]);
    statementFiles.push({
      label: STATEMENT_META[st].label,
      href,
      slug: first.slug,
    });
  }

  const noteSheets = sheets.filter((s) => !s.statementType);
  if (noteSheets.length) {
    const href = "assets/excel/notes.xlsx";
    files[href] = buildWorkbookXlsx(noteSheets);
    statementFiles.push({ label: "Notes", href, slug: "notes" });
  }

  return {
    files,
    workbookSheetNames,
    statementFiles,
    workbookHref: WORKBOOK_HREF,
  };
}

/** Relative href from a page path to an assets/… file. */
export function assetHrefFromPage(pagePath: string, assetPath: string): string {
  const depth = pagePath.split("/").filter(Boolean).length - 1;
  const prefix = depth > 0 ? "../".repeat(depth) : "";
  return prefix + assetPath;
}

/** Map financials/*.html → per-statement excel slug. */
export function statementExcelSlugForPage(pagePath: string): string | null {
  if (pagePath === "financials/income-statement.html") return "income-statement";
  if (pagePath === "financials/balance-sheet.html") return "balance-sheet";
  if (pagePath === "financials/changes-in-equity.html") return "changes-in-equity";
  if (pagePath === "financials/cash-flows.html") return "cash-flows";
  if (pagePath === "financials/notes.html") return "notes";
  return null;
}
