import { deflateRawSync } from "node:zlib";
import type { FinancialDocModel, FinTable, StatementType } from "@rs/contracts";
import { classifyStatementRow } from "./row-taxonomy.js";

/**
 * ExcelExporter — FinTables → multi-sheet + per-statement XLSX binaries.
 * Cell values are the FinTable `raw` strings verbatim (no invented figures,
 * no numeric reinterpretation that would drop thin-space grouping).
 * Presentation: IR title card + company/period brand row, header fill,
 * column widths, freeze panes, row-role bold, current-period shade.
 */

export interface ExcelSheetSpec {
  /** Excel sheet tab name (≤31 chars). */
  name: string;
  /** Stable file slug for per-statement workbooks. */
  slug: string;
  table: FinTable;
  statementType?: StatementType;
  /** Full IR title for the presentation card row (not invented numbers). */
  title?: string;
}

export interface ExcelWorkbookMeta {
  company?: string;
  periodLabel?: string;
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
  { sheet: string; slug: string; label: string; title: string }
> = {
  pnl_oci: {
    sheet: "Income Statement",
    slug: "income-statement",
    label: "Income statement",
    title: "Condensed Consolidated Statement of Profit or Loss and OCI",
  },
  financial_position: {
    sheet: "Balance Sheet",
    slug: "balance-sheet",
    label: "Statement of financial position",
    title: "Condensed Consolidated Statement of Financial Position",
  },
  changes_in_equity: {
    sheet: "Changes in Equity",
    slug: "changes-in-equity",
    label: "Changes in equity",
    title: "Condensed Consolidated Statement of Changes in Equity",
  },
  cash_flows: {
    sheet: "Cash Flows",
    slug: "cash-flows",
    label: "Cash flows",
    title: "Condensed Consolidated Statement of Cash Flows",
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

const OPS_SHEET = "Review of Operations";
const OPS_SLUG = "review-of-operations";
const OPS_TITLE = "Review of Operations";

/** Collect statement (+ ops + optional note) sheets from the DocModel. */
export function collectExcelSheets(docModel: FinancialDocModel): ExcelSheetSpec[] {
  const tableById = new Map(docModel.tables.map((t) => [t.id, t]));
  const byType: Partial<Record<StatementType, FinTable[]>> = {};
  const opsTables: FinTable[] = [];
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
      } else if (sec.kind === "reviewOfOperations") {
        seen.add(table.id);
        opsTables.push(table);
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
        title: idx === 0 ? meta.title : `${meta.title} (${idx + 1})`,
      });
    });
  }

  // Review of Operations — named sheet(s) after primary statements, before notes.
  opsTables.forEach((table, idx) => {
    const sheetBase = idx === 0 ? OPS_SHEET : `${OPS_SHEET} ${idx + 1}`;
    const slug = idx === 0 ? OPS_SLUG : `${OPS_SLUG}-${idx + 1}`;
    sheets.push({
      name: sanitizeSheetName(sheetBase, usedNames),
      slug,
      table,
      title: idx === 0 ? OPS_TITLE : `${OPS_TITLE} (${idx + 1})`,
    });
  });

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

/**
 * Style indexes:
 * 0 default, 1 header, 2 section, 3 subtotal, 4 total, 5 number, 6 numberCur,
 * 7 title, 8 brand, 9 unitNote.
 */
const STYLE = {
  default: 0,
  header: 1,
  section: 2,
  subtotal: 3,
  total: 4,
  number: 5,
  numberCur: 6,
  title: 7,
  brand: 8,
  unitNote: 9,
} as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF1B2A3A"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="FF1B2A3A"/><name val="Arial"/><family val="2"/></font>
    <font><sz val="9"/><color rgb="FF58595A"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF64748B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F7F7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F8FA"/></patternFill></fill>
  </fills>
  <borders count="6">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF64748B"/></bottom><diagonal/></border>
    <border><left/><right/><top style="medium"><color rgb="FF1B2A3A"/></top><bottom style="medium"><color rgb="FF243B53"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF6C6C6C"/></left><right style="thin"><color rgb="FF6C6C6C"/></right><top style="thin"><color rgb="FF6C6C6C"/></top><bottom style="thin"><color rgb="FF6C6C6C"/></bottom><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FFBAC4CA"/></top><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="medium"><color rgb="FF243B53"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="bottom" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="4" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="3" fillId="6" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="5" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

function inlineStrCell(ref: string, raw: string, style: number): string {
  const text = escapeXml(raw);
  const sAttr = style > 0 ? ` s="${style}"` : "";
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function measureCols(table: FinTable): number[] {
  const widths: number[] = [];
  const consider = (col: number, text: string) => {
    const len = Math.min(48, Math.max(4, text.length + 2));
    widths[col] = Math.max(widths[col] ?? 8, len);
  };
  for (const headerRow of table.header_matrix) {
    let c = 0;
    for (const h of headerRow) {
      consider(c, h.raw);
      c += Math.max(1, h.col_span ?? 1);
    }
  }
  for (const row of table.rows) {
    row.cells.forEach((cell, c) => consider(c, cell.raw));
  }
  if (!widths.length) widths.push(12);
  // Label column wider; numeric columns capped.
  widths[0] = Math.max(widths[0] ?? 28, 28);
  for (let i = 1; i < widths.length; i++) {
    widths[i] = Math.min(widths[i] ?? 14, 18);
  }
  return widths;
}

function rowHasNumber(row: FinTable["rows"][number]): boolean {
  return row.cells.some((c) => c.kind === "number" && c.raw.trim() !== "");
}

/** Latest-year column (0-based) — mirrors renderer current-period shading. */
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

function sheetXml(
  table: FinTable,
  opts: { title?: string; company?: string; periodLabel?: string } = {},
): string {
  const rows: string[] = [];
  let r = 1;
  const widths = measureCols(table);
  const colCount = Math.max(1, widths.length);
  const unit = table.unit_context?.default?.trim();

  // Presentation card: title + company/period brand (metadata only — no invented figures).
  if (opts.title?.trim()) {
    rows.push(
      `<row r="${r}" ht="28" customHeight="1">${inlineStrCell(`A${r}`, opts.title.trim(), STYLE.title)}</row>`,
    );
    r++;
  }
  const brandBits = [opts.company?.trim(), opts.periodLabel?.trim()].filter(Boolean);
  if (brandBits.length) {
    rows.push(
      `<row r="${r}" ht="18" customHeight="1">${inlineStrCell(`A${r}`, brandBits.join(" · "), STYLE.brand)}</row>`,
    );
    r++;
  }
  if (unit) {
    rows.push(
      `<row r="${r}">${inlineStrCell(`A${r}`, `Figures in ${unit}`, STYLE.unitNote)}</row>`,
    );
    r++;
  }
  const prefaceRows = r - 1;

  const headerCount = table.header_matrix.length;
  const curCol = findCurrentPeriodCol(table);
  for (const headerRow of table.header_matrix) {
    let c = 0;
    const cells: string[] = [];
    for (const h of headerRow) {
      const ref = `${colLetter(c)}${r}`;
      cells.push(inlineStrCell(ref, h.raw, STYLE.header));
      c += Math.max(1, h.col_span ?? 1);
    }
    rows.push(`<row r="${r}" ht="30" customHeight="1">${cells.join("")}</row>`);
    r++;
  }
  for (const row of table.rows) {
    const label = row.cells[0]?.raw ?? "";
    const role = classifyStatementRow(label, rowHasNumber(row));
    const roleStyle =
      role === "section"
        ? STYLE.section
        : role === "subtotal"
          ? STYLE.subtotal
          : role === "total"
            ? STYLE.total
            : STYLE.default;
    const cells = row.cells.map((cell, c) => {
      const ref = `${colLetter(c)}${r}`;
      const isCur = curCol != null && c === curCol;
      const style: number =
        roleStyle !== STYLE.default
          ? roleStyle
          : cell.kind === "number" || c > 0
            ? isCur
              ? STYLE.numberCur
              : STYLE.number
            : STYLE.default;
      return inlineStrCell(ref, cell.raw, style);
    });
    const ht = role === "total" ? ' ht="20" customHeight="1"' : "";
    rows.push(`<row r="${r}"${ht}>${cells.join("")}</row>`);
    r++;
  }

  widths[0] = Math.max(widths[0] ?? 40, 40);
  const colsXml = `<cols>${widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("")}</cols>`;
  const freezeRow = Math.max(1, prefaceRows + headerCount);
  const views = `<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  const dim = `A1:${colLetter(Math.max(0, colCount - 1))}${Math.max(1, r - 1)}`;
  const headerFooter = opts.company
    ? `<headerFooter><oddHeader>&amp;L${escapeXml(opts.company)}${opts.periodLabel ? ` — ${escapeXml(opts.periodLabel)}` : ""}&amp;RInterim results</oddHeader></headerFooter>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}${colsXml}<dimension ref="${dim}"/><sheetData>${rows.join("")}</sheetData><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${headerFooter}<pageSetup orientation="landscape" fitToPage="1" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function workbookXml(sheetNames: string[]): string {
  const sheets = sheetNames
    .map(
      (name, i) =>
        `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(count: number): string {
  const sheetRels = Array.from({ length: count }, (_, i) => {
    return `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  }).join("");
  const stylesRel = `<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}${stylesRel}</Relationships>`;
}

function contentTypesXml(count: number): string {
  const overrides = Array.from({ length: count }, (_, i) => {
    return `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`;
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
export function buildWorkbookXlsx(
  sheets: ExcelSheetSpec[],
  meta: ExcelWorkbookMeta = {},
): Uint8Array {
  if (!sheets.length) {
    throw new Error("buildWorkbookXlsx: no sheets");
  }
  const names = sheets.map((s) => s.name);
  const files: Record<string, string> = {
    "[Content_Types].xml": contentTypesXml(sheets.length),
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(names),
    "xl/_rels/workbook.xml.rels": workbookRelsXml(sheets.length),
    "xl/styles.xml": STYLES_XML,
  };
  sheets.forEach((spec, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(spec.table, {
      title: spec.title ?? (spec.statementType ? STATEMENT_META[spec.statementType].title : spec.name),
      company: meta.company,
      periodLabel: meta.periodLabel,
    });
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
  const meta: ExcelWorkbookMeta = {
    company: docModel.meta.company,
    periodLabel: docModel.meta.period_label,
  };

  if (sheets.length) {
    files[WORKBOOK_HREF] = buildWorkbookXlsx(sheets, meta);
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
    files[href] = buildWorkbookXlsx([first], meta);
    statementFiles.push({
      label: STATEMENT_META[st].label,
      href,
      slug: first.slug,
    });
  }

  const opsSheets = sheets.filter((s) => s.slug === OPS_SLUG || s.slug.startsWith(`${OPS_SLUG}-`));
  if (opsSheets.length) {
    const href = `assets/excel/${OPS_SLUG}.xlsx`;
    files[href] = buildWorkbookXlsx(opsSheets, meta);
    statementFiles.push({ label: OPS_TITLE, href, slug: OPS_SLUG });
  }

  const noteSheets = sheets.filter(
    (s) => !s.statementType && !(s.slug === OPS_SLUG || s.slug.startsWith(`${OPS_SLUG}-`)),
  );
  if (noteSheets.length) {
    const href = "assets/excel/notes.xlsx";
    files[href] = buildWorkbookXlsx(noteSheets, meta);
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
