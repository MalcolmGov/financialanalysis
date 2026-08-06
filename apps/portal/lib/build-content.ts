import type { ExtractionResult, FinancialDocModel } from "@rs/contracts";
import type { ContentSample } from "./studio";

/**
 * Build the studio's ContentSample from the mapped FinancialDocModel (+ the
 * extraction, for the shareholder-letter prose and cover highlights). All
 * values are carried VERBATIM — the studio must reproduce them exactly; the
 * final exported numbers still flow through the ref-only, gate-verified path.
 */
/** The raw "Highlights" prose (for the KPI enricher), or "" if absent. */
export function highlightsText(docModel: FinancialDocModel): string {
  const hi = docModel.sections.find((s) => s.kind === "highlights");
  return (hi?.blocks ?? [])
    .filter((b) => b.text)
    .map((b) => b.text as string)
    .join(" ");
}

export function buildContentSample(
  docModel: FinancialDocModel,
  extraction: ExtractionResult,
  opts?: { kpis?: { label: string; value: string }[] },
): ContentSample {
  // Prefer caller-supplied (AI-segmented, verbatim-validated) KPIs; fall back to
  // the extraction's key_figures enrichment.
  const kpis =
    opts?.kpis && opts.kpis.length > 0
      ? opts.kpis.slice(0, 6)
      : extraction.enrichment.key_figures.slice(0, 6).map((k) => ({ label: k.label, value: k.value_raw }));

  // Prefer the P&L statement table; else the first must-appear financial table.
  const stmt =
    docModel.tables.find((t) => t.table_type === "statement") ??
    docModel.tables.find((t) => t.must_appear) ??
    docModel.tables[0];

  const headers = stmt ? stmt.header_matrix.at(-1)?.map((h) => h.raw) ?? [] : [];
  const rows = stmt
    ? stmt.rows.slice(0, 8).map((r) => r.cells.filter((c) => c.kind !== "noteRef").map((c) => c.raw))
    : [];
  const caption = stmt
    ? docModel.sections.find((s) => s.blocks.some((b) => b.table_ref === stmt.id))?.title?.text ??
      "Financial statement"
    : "Financial statement";

  // Chart from the first two numeric columns of the statement's first rows.
  const chartRows = rows.filter((r) => r.length >= 3).slice(0, 3);
  const chart = {
    title: "Group performance (Rm)",
    categories: chartRows.map((r) => r[0]),
    series:
      headers.length >= 3
        ? [
            { label: headers[1] || "Current", values: chartRows.map((r) => r[1]) },
            { label: headers[2] || "Prior", values: chartRows.map((r) => r[2]) },
          ]
        : [],
  };

  const letterSection = docModel.sections.find((s) => s.kind === "letter");
  const letter = {
    heading: letterSection?.title?.text ?? "Shareholder letter",
    paragraphs: (letterSection?.blocks ?? [])
      .filter((b) => b.kind === "paragraph" && b.text)
      .slice(0, 4)
      .map((b) => b.text as string),
  };

  const dividend = docModel.sections
    .find((s) => s.kind === "dividendDeclaration")
    ?.blocks.filter((b) => b.text)
    .map((b) => b.text as string)
    .slice(0, 6);

  return {
    company: docModel.meta.company,
    period: docModel.meta.period_label,
    kpis,
    table: { caption, headers, rows },
    chart,
    letter,
    ...(dividend && dividend.length ? { dividend } : {}),
  };
}
