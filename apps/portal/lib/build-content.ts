import type { ExtractionResult, FinancialDocModel } from "@rs/contracts";
import type { ContentSample, ContentSection, ContentTable } from "./studio";

/**
 * Build the studio ContentSample from the mapped FinancialDocModel.
 * Full-document mode: every mapped table (complete rows) and every prose
 * section are included so the microsite can cover the whole PDF.
 */

/** The raw "Highlights" prose (for the KPI enricher), or "" if absent. */
export function highlightsText(docModel: FinancialDocModel): string {
  const hi = docModel.sections.find((s) => s.kind === "highlights");
  return (hi?.blocks ?? [])
    .filter((b) => b.text)
    .map((b) => b.text as string)
    .join(" ");
}

function finTableToContent(
  docModel: FinancialDocModel,
  stmt: FinancialDocModel["tables"][number],
): ContentTable {
  const headers = stmt.header_matrix.at(-1)?.map((h) => h.raw) ?? [];
  const rows = stmt.rows.map((r) => r.cells.map((c) => c.raw));
  const caption =
    docModel.sections.find((s) => s.blocks.some((b) => b.table_ref === stmt.id))?.title?.text ??
    headers[0] ??
    "Financial table";
  const page =
    // best-effort: parse from src_table / leave undefined
    undefined;
  return {
    id: stmt.id,
    caption,
    headers,
    rows,
    table_type: stmt.table_type,
    must_appear: stmt.must_appear,
    page,
  };
}

function proseSection(
  docModel: FinancialDocModel,
  kind: FinancialDocModel["sections"][number]["kind"],
  id: string,
): ContentSection | null {
  const sec = docModel.sections.find((s) => s.kind === kind);
  if (!sec) return null;
  const paragraphs = (sec.blocks ?? [])
    .filter((b) => b.text && (b.kind === "paragraph" || b.kind === "list" || b.kind === "heading"))
    .map((b) => b.text as string);
  if (!paragraphs.length && !(sec.blocks ?? []).some((b) => b.kind === "table")) return null;
  return {
    id,
    kind,
    heading: sec.title?.text ?? kind,
    paragraphs,
  };
}

export function buildContentSample(
  docModel: FinancialDocModel,
  extraction: ExtractionResult,
  opts?: { kpis?: { label: string; value: string }[] },
): ContentSample {
  // Prefer caller-supplied (AI-segmented, verbatim-validated) KPIs; fall back to
  // the extraction's key_figures enrichment. Soft cap only when enrichment is huge.
  const kpis =
    opts?.kpis && opts.kpis.length > 0
      ? opts.kpis.slice(0, 12)
      : extraction.enrichment.key_figures.slice(0, 12).map((k) => ({ label: k.label, value: k.value_raw }));

  // ALL mapped tables, full rows — statements, notes, ops, segments, facts.
  const tables = docModel.tables.map((t) => finTableToContent(docModel, t));

  // Prefer P&L / first statement as the primary chart source (backward compat `table`).
  const primary =
    docModel.tables.find((t) => t.table_type === "statement") ??
    docModel.tables.find((t) => t.must_appear) ??
    docModel.tables[0];
  const table = primary
    ? finTableToContent(docModel, primary)
    : { id: "none", caption: "Financial statement", headers: [] as string[], rows: [] as string[][] };

  const chartRows = table.rows.filter((r) => r.length >= 3).slice(0, 6);
  const chart = {
    title: "Group performance (Rm)",
    categories: chartRows.map((r) => r[0]),
    series:
      table.headers.length >= 3
        ? [
            { label: table.headers[1] || "Current", values: chartRows.map((r) => r[1]) },
            { label: table.headers[2] || "Prior", values: chartRows.map((r) => r[2]) },
          ]
        : [],
  };

  const letterSection = docModel.sections.find((s) => s.kind === "letter");
  const letter = {
    heading: letterSection?.title?.text ?? "Shareholder letter",
    paragraphs: (letterSection?.blocks ?? [])
      .filter((b) => b.text)
      .map((b) => b.text as string),
  };

  const dividend = docModel.sections
    .find((s) => s.kind === "dividendDeclaration")
    ?.blocks.filter((b) => b.text)
    .map((b) => b.text as string);

  const sections: ContentSection[] = [];
  for (const kind of [
    "highlights",
    "reviewOfOperations",
    "shareholderInfo",
    "directors",
    "forwardLooking",
    "contacts",
    "note",
    "segments",
  ] as const) {
    if (kind === "note") {
      // Collapse all note sections into one content section with headings inline.
      const notes = docModel.sections.filter((s) => s.kind === "note");
      if (notes.length) {
        const paragraphs: string[] = [];
        for (const n of notes) {
          if (n.title?.text) paragraphs.push(n.title.text);
          for (const b of n.blocks ?? []) {
            if (b.text) paragraphs.push(b.text);
          }
        }
        sections.push({
          id: "notes",
          kind: "note",
          heading: "Notes to the financial statements",
          paragraphs,
        });
      }
      continue;
    }
    const s = proseSection(docModel, kind, kind);
    if (s) sections.push(s);
  }

  return {
    company: docModel.meta.company,
    period: docModel.meta.period_label,
    kpis,
    table: { caption: table.caption, headers: table.headers, rows: table.rows },
    tables,
    chart,
    letter,
    sections,
    ...(dividend && dividend.length ? { dividend } : {}),
  };
}

/** Truncate a paragraph for the LLM brief (layout context only). */
function briefPara(p: string, max = 220): string {
  const t = p.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Slim ContentSample for Opus shell generation: KPIs + chart + table/section
 * captions and ids only. Full rows stay out of the prompt — ensureContentCoverage
 * injects them after generation from the full ContentSample.
 */
export function buildStudioBrief(content: ContentSample): ContentSample {
  const tables = (content.tables ?? []).map((t) => ({
    id: t.id,
    caption: t.caption,
    headers: t.headers.slice(0, 6),
    rows: [] as string[][],
    table_type: t.table_type,
    must_appear: t.must_appear,
    page: t.page,
  }));

  return {
    company: content.company,
    period: content.period,
    kpis: content.kpis,
    table: {
      caption: content.table.caption,
      headers: content.table.headers,
      rows: [],
    },
    tables,
    chart: content.chart,
    letter: {
      heading: content.letter.heading,
      paragraphs: content.letter.paragraphs.slice(0, 3).map((p) => briefPara(p)),
    },
    sections: (content.sections ?? []).map((s) => ({
      id: s.id,
      kind: s.kind,
      heading: s.heading,
      paragraphs: s.paragraphs.slice(0, 2).map((p) => briefPara(p, 160)),
    })),
    ...(content.dividend?.length
      ? { dividend: content.dividend.slice(0, 4).map((d) => briefPara(d, 120)) }
      : {}),
  };
}
