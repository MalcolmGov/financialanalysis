import type { FinancialDocModel, SitePlan } from "@rs/contracts";
import { describe, expect, it } from "vitest";
import { CHROME_CSS } from "./chrome.js";
import { applyDownloadArtifacts } from "./enrich.js";

function stubDoc(docKind: FinancialDocModel["meta"]["doc_kind"]): FinancialDocModel {
  return {
    schema_version: "financial-doc-model/1",
    doc_model_id: "dm_downloads_test",
    meta: {
      company: "MTN Group Limited",
      period_label: "for the year ended 31 December 2025",
      doc_kind: docKind,
      currency: "ZAR",
      units: "million",
      reporting_framework: "IFRS",
    },
    sections: [],
    tables: [],
    facts: [],
    entities: [],
  } as FinancialDocModel;
}

const stubPlan = {
  schema_version: "siteplan/1",
  site_plan_id: "sp_downloads_test",
  doc_model_id: "dm_downloads_test",
  pages: [{ path: "downloads.html", title: "Downloads", template: "bp:tpl_prose", regions: {}, downloads: [] }],
  nav: [{ label: "Downloads", href: "downloads.html" }],
} as SitePlan;

describe("downloads page CTAs", () => {
  it("renders explicit Download CTAs with file-type cues and hrefs", () => {
    const files = applyDownloadArtifacts(
      {
        "downloads.html": `<main><div class="prose-body"><section class="downloads" data-dna-component="downloads">old</section></div></main>`,
      },
      stubPlan,
      stubDoc("annual_audited"),
      {
        pdfBundled: true,
        excel: {
          workbookHref: "assets/excel/financial-statements.xlsx",
          workbookSheetNames: ["Income", "Position"],
          statementFiles: [
            {
              label: "Income statement",
              href: "assets/excel/income-statement.xlsx",
              slug: "income-statement",
            },
          ],
        },
      },
    );
    const html = files["downloads.html"]!;
    expect(html).toContain('class="downloads__cta"');
    expect(html).toMatch(/>\s*Download\s*</);
    expect(html).toContain('class="downloads__kind">PDF<');
    expect(html).toContain('class="downloads__kind">XLSX<');
    expect(html).toContain('href="assets/source.pdf"');
    expect(html).toContain('href="assets/excel/financial-statements.xlsx"');
    expect(html).toContain('href="assets/excel/income-statement.xlsx"');
    expect(html).toContain("Full results PDF");
    expect(html).toContain("Financial statements (Excel)");
    expect(html).toContain("Income statement (Excel)");
    expect(html).toMatch(/download(?:=|>|\s)/i);
  });

  it("uses annual PDF copy for annual_audited (not interim)", () => {
    const files = applyDownloadArtifacts(
      {
        "downloads.html": `<main><div class="prose-body"><section class="downloads" data-dna-component="downloads">old</section></div></main>`,
      },
      stubPlan,
      stubDoc("annual_audited"),
      { pdfBundled: true },
    );
    const html = files["downloads.html"]!;
    expect(html).toMatch(/Annual financial statements PDF/i);
    expect(html).not.toMatch(/interim results booklet/i);
  });

  it("keeps interim PDF copy for interim doc kinds", () => {
    const files = applyDownloadArtifacts(
      {
        "downloads.html": `<main><div class="prose-body"><section class="downloads" data-dna-component="downloads">old</section></div></main>`,
      },
      stubPlan,
      stubDoc("interim_unaudited"),
      { pdfBundled: true },
    );
    expect(files["downloads.html"]).toMatch(/Interim results booklet/i);
  });

  it("ships brand-accent Download CTA styles in chrome CSS", () => {
    expect(CHROME_CSS).toContain(".downloads__cta");
    expect(CHROME_CSS).toContain(".downloads__row");
    expect(CHROME_CSS).toMatch(
      /\[data-bright-brand="1"\][\s\S]*\.downloads__cta/,
    );
  });
});
