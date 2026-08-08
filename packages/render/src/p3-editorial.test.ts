import { describe, expect, it } from "vitest";
import type { ExtractionResult, FinancialDocModel, SitePlan } from "@rs/contracts";
import { renderBreadcrumb } from "./chrome.js";
import { composeCommentaryBody } from "./commentary-composer.js";
import { gateB } from "./gate-b.js";
import { composeHome, extractHomeKpis } from "./home-composer.js";
import { composeSeo, renderSeoMeta } from "./seo.js";

const DRD_HIGHLIGHTS =
  "Operating profit increased by 72% to R2 712.8 million Headline earnings increased by 99% to R1 932.4 million Interim cash dividend of 50 SA cps R1 651.3 million of capital expenditure All-in sustaining costs margin 2 of 48% Gold production decreased by 9% to 2 337 kilograms";

function docModel(): FinancialDocModel {
  return {
    schema_version: "docmodel/1",
    doc_model_id: "dm_p3",
    extraction_id: "ext_p3",
    content_hash: "c".repeat(64),
    meta: {
      company: "DRDGOLD Limited",
      period_label: "HY1 FY2026 — six months ended 31 December 2025",
      doc_kind: "interim_unaudited",
      currency: "ZAR",
    },
    sections: [
      {
        id: "doc:sec_highlights",
        kind: "highlights",
        title: { text: "Highlights", src_ref: "ext:blk-h0" },
        blocks: [
          { kind: "paragraph", text: DRD_HIGHLIGHTS, src_ref: "ext:blk-h1" },
        ],
        items: [],
      },
      {
        id: "doc:sec_letter",
        kind: "letter",
        title: { text: "Dear Shareholder", src_ref: "ext:blk-l0" },
        blocks: [
          { kind: "heading", text: "Dear Shareholder", src_ref: "ext:blk-l0" },
          { kind: "heading", text: "Overview", src_ref: "ext:blk-l1" },
          {
            kind: "paragraph",
            text: "The Group delivered a solid operating performance.",
            src_ref: "ext:blk-l2",
          },
          { kind: "heading", text: "Cash Dividend", src_ref: "ext:blk-l3" },
          {
            kind: "paragraph",
            text: "The board declared an interim cash dividend.",
            src_ref: "ext:blk-l4",
          },
        ],
        items: [],
      },
      {
        id: "doc:sec_div",
        kind: "dividendDeclaration",
        title: { text: "Dividend declaration", src_ref: "ext:blk-d0" },
        blocks: [
          {
            kind: "paragraph",
            text: "Salient dates for the interim dividend will be announced.",
            src_ref: "ext:blk-d1",
          },
        ],
        items: [],
      },
    ],
    tables: [],
    footnotes: [],
    mapping_review: [],
  } as FinancialDocModel;
}

function plan(): SitePlan {
  return {
    schema_version: "siteplan/1",
    site_plan_id: "sp_p3",
    model: "deterministic-multipage",
    nav: [
      { label: "Home", href: "index.html" },
      { label: "Commentary", href: "commentary.html" },
      { label: "Income statement", href: "financials/income-statement.html" },
      { label: "Downloads", href: "downloads.html" },
    ],
    pages: [],
  } as unknown as SitePlan;
}

describe("SeoComposer", () => {
  it("emits Report JSON-LD and rich meta on home", () => {
    const kpis = extractHomeKpis(docModel());
    const seo = composeSeo({
      path: "index.html",
      title: "Home",
      company: "DRDGOLD Limited",
      periodLabel: "HY1 FY2026 — six months ended 31 December 2025",
      docKind: "interim_unaudited",
      currency: "ZAR",
      kpis,
    });
    expect(seo.jsonLd?.["@type"]).toBe("Report");
    expect(JSON.stringify(seo.jsonLd)).toContain("DRDGOLD Limited");
    expect(seo.description).toMatch(/2 712\.8|Operating profit/i);
    expect(seo.ogTitle).toMatch(/DRDGOLD/i);
    const meta = renderSeoMeta(seo);
    expect(meta).toContain('type="application/ld+json"');
    expect(meta).toContain('"@type":"Report"');
    expect(meta).toContain('property="og:type"');
    expect(meta).toContain('property="og:locale"');
    expect(meta).toContain('rel="canonical"');
    expect(meta).toContain('name="twitter:card"');
    expect(JSON.stringify(seo.jsonLd)).toContain('"inLanguage":"en"');
    expect(JSON.stringify(seo.jsonLd)).toContain("temporalCoverage");
  });

  it("emits WebPage JSON-LD on statement pages", () => {
    const seo = composeSeo({
      path: "financials/balance-sheet.html",
      title: "Balance sheet",
      company: "DRDGOLD Limited",
      periodLabel: "HY1 FY2026",
      docKind: "interim_unaudited",
    });
    expect(seo.jsonLd?.["@type"]).toBe("WebPage");
    expect(seo.title).toContain("Balance sheet");
    expect(seo.description).toMatch(/financial statement/i);
  });

  it("does not invent KPI digits absent from source cards", () => {
    const seo = composeSeo({
      path: "index.html",
      title: "Home",
      company: "Acme Corp",
      periodLabel: "FY2025",
      kpis: [],
    });
    expect(seo.description).not.toMatch(/R5\.1|9999/);
    expect(JSON.stringify(seo.jsonLd)).not.toMatch(/R5\.1bn/);
  });
});

describe("HomeComposer", () => {
  it("builds one-composition hero with brand, results headline, KPI stage", () => {
    const home = composeHome(plan(), docModel());
    expect(home.kpis.length).toBeGreaterThanOrEqual(5);
    expect(home.heroHtml).toContain("home-hero");
    expect(home.heroHtml).toContain("home-hero--composition");
    expect(home.heroHtml).toContain("home-hero--atmosphere");
    expect(home.heroHtml).toContain("home-hero__atmosphere");
    expect(home.heroHtml).toContain("home-hero__mast");
    expect(home.heroHtml).toContain("home-hero__rule");
    expect(home.heroHtml).toContain("home-hero__company");
    expect(home.heroHtml).toContain("DRDGOLD Limited");
    // Brand is company wordmark; H1 is the results/period headline.
    expect(home.heroHtml).toMatch(/<h1[^>]*>HY1 FY2026/);
    expect(home.heroHtml).toContain("home-lede");
    expect(home.heroHtml).toContain("The Group delivered a solid operating performance.");
    expect(home.heroHtml).not.toContain("Investor results centre");
    expect(home.heroHtml).toContain("Condensed Consolidated Unaudited Interim Results");
    expect(home.heroHtml).toContain("downloads.html");
    // KPI band lives in the first-viewport composition, not body filler.
    expect(home.heroHtml).toContain('data-dna-component="kpi-band"');
    expect(home.heroHtml).toContain("home-hero__stage");
    expect(home.heroHtml).toContain("Financial highlights");
    expect(home.heroHtml).toContain("kpi-title");
    expect(home.heroHtml).toContain("Operating Profit");
    expect(home.heroHtml).toContain("kpi-delta");
    expect(home.heroHtml).toContain("data-countup");
    expect(home.heroHtml).toContain("2 712.8");
    expect(home.bodyHtml).not.toContain('data-dna-component="kpi-band"');
    expect(home.bodyHtml).toContain("highlights-band");
    expect(home.bodyHtml).toContain("highlight-card");
    expect(home.bodyHtml).toContain("highlight-card__value");
    expect(home.bodyHtml).toContain("highlight-card__delta");
    expect(home.bodyHtml).toContain("Operating Profit");
    expect(home.bodyHtml).toContain("2 712.8");
    expect(home.bodyHtml).not.toContain("highlight-item");
    expect(home.bodyHtml).toContain("explore-desc");
    expect(home.bodyHtml).toContain("Explore the report");
    expect(home.bodyHtml).toContain("Shareholder letter");
    // Explore blurbs must not invent statement figures
    expect(home.bodyHtml).not.toMatch(/R2\.3bn|R428/);
  });

  it("pulls listing chips from extraction cover text when not in DocModel", () => {
    const extraction = {
      body: [
        {
          id: "blk-0012",
          type: "paragraph",
          text: "JSE and A2X share code: DRD NYSE trading symbol: DRD ISIN: ZAE000058723",
          children: [],
        },
      ],
      furniture: [],
    } as unknown as ExtractionResult;
    const home = composeHome(plan(), docModel(), { extraction });
    expect(home.heroHtml).toContain("home-meta__chip");
    expect(home.heroHtml).toContain("JSE and A2X share code: DRD");
    expect(home.heroHtml).toContain("ISIN: ZAE000058723");
    expect(home.heroHtml).toContain("data-allow-number");
    // Substring chips must not carry data-src (Gate B verbatim rule).
    expect(home.heroHtml).not.toMatch(/home-meta__chip"[^>]*data-src=/);
  });

  it("wires real brand assets into hero when provided", () => {
    const home = composeHome(plan(), docModel(), {
      brandAssets: {
        logo: "assets/brand/logo.png",
        logoKind: "raster",
        banner: "assets/brand/banner.jpg",
        bannerKind: "strip",
      },
    });
    expect(home.heroHtml).toContain("home-hero--photo");
    expect(home.heroHtml).toContain("home-hero--strip");
    // Class on <header> is photo/strip; atmosphere class only appears in onerror fallback.
    expect(home.heroHtml).toMatch(
      /<header class="home-hero home-hero--composition home-hero--photo home-hero--strip"/,
    );
    expect(home.heroHtml).not.toMatch(/<header class="[^"]*home-hero--atmosphere/);
    expect(home.heroHtml).toContain("home-hero__atmosphere");
    expect(home.heroHtml).toContain('src="assets/brand/banner.jpg"');
    expect(home.heroHtml).toContain('data-banner-kind="strip"');
    expect(home.heroHtml).toContain("data-banner-img");
    expect(home.heroHtml).toContain("onerror=");
    expect(home.heroHtml).toContain("home-hero__logo--raster");
    expect(home.heroHtml).toContain('src="assets/brand/logo.png"');
  });

  it("allow-lists digits in company identity chrome for Gate B", () => {
    const dm = docModel();
    dm.meta.company = "DRD Gold 1";
    // Drop letter/highlights so the hero has no data-src lede/KPIs against empty extraction.
    dm.sections = dm.sections.filter(
      (s) => s.kind !== "letter" && s.kind !== "highlights" && s.kind !== "dividendDeclaration",
    );
    const home = composeHome(plan(), dm);
    expect(home.heroHtml).toMatch(
      /<p class="home-hero__company"[^>]*data-allow-number[^>]*>DRD Gold 1<\/p>/,
    );
    const crumb = renderBreadcrumb("commentary.html", "Commentary", "DRD Gold 1");
    expect(crumb).toContain('data-allow-number');
    expect(crumb).toContain("DRD Gold 1");
    const html = `<!doctype html><html><body>${home.heroHtml}${crumb}<p>Source PDF for <span data-allow-number>DRD Gold 1</span>.</p></body></html>`;
    const emptyExtraction = { tables: {}, blocks: {}, body: [], furniture: [] } as unknown as ExtractionResult;
    const b = gateB({ "index.html": html }, { extraction: emptyExtraction, docModel: dm });
    expect(b.status).toBe("pass");
    expect(b.failures).toEqual([]);
  });

  it("falls back to dividend highlight lede when letter prose is absent", () => {
    const dm = docModel();
    dm.sections = dm.sections.filter((s) => s.kind !== "letter");
    const home = composeHome(plan(), dm);
    expect(home.heroHtml).toContain("Interim cash dividend of 50 SA cps");
    expect(home.heroHtml).not.toContain("Investor results centre");
  });

  it("prefers cover period phrase over thin project FY label", () => {
    const dm = docModel();
    dm.meta.period_label = "FY2025";
    const extraction = {
      body: [
        {
          id: "blk-cover",
          type: "paragraph",
          text: "Condensed consolidated unaudited interim results for the six months ended 31 December 2025",
          children: [],
        },
      ],
      furniture: [],
    } as unknown as ExtractionResult;
    const home = composeHome(plan(), dm, { extraction });
    expect(home.heroHtml).toMatch(/<h1[^>]*>for the six months ended 31 December 2025<\/h1>/i);
    expect(home.heroHtml).not.toMatch(/<h1[^>]*>FY2025<\/h1>/);
  });
});

describe("CommentaryComposer", () => {
  it("sections letter and dividend with TOC hierarchy", () => {
    const html = composeCommentaryBody(docModel());
    expect(html).toContain('id="letter"');
    expect(html).toContain('id="dividend"');
    expect(html).toContain("commentary-toc");
    expect(html).toContain("commentary-toc__n");
    expect(html).toContain("Letter to shareholders");
    expect(html).toContain("Dividend declaration");
    expect(html).toContain("Overview");
    expect(html).toContain('data-src="ext:blk-l2"');
    expect(html).toContain("The Group delivered a solid operating performance.");
    expect(html).toContain("prose-lead");
    expect(html).toContain("commentary-section");
    expect(html).not.toMatch(/commentary-section[^>]*\breveal\b/);
  });

  it("surfaces Review of operations when ops prose is nested in the letter", () => {
    const dm = docModel();
    const letter = dm.sections.find((s) => s.kind === "letter")!;
    letter.blocks = [
      { kind: "heading", text: "Overview", src_ref: "ext:blk-l1" },
      {
        kind: "paragraph",
        text: "The Group delivered a solid operating performance.",
        src_ref: "ext:blk-l2",
      },
      {
        kind: "heading",
        text: "Group Operational, Financial and ESG Performance Summary",
        src_ref: "ext:blk-ops0",
      },
      {
        kind: "paragraph",
        text: "Gold production at Ergo was 9% lower at 1 683kg.",
        src_ref: "ext:blk-ops1",
      },
      { kind: "heading", text: "Cash Dividend", src_ref: "ext:blk-l3" },
      {
        kind: "paragraph",
        text: "The board declared an interim cash dividend.",
        src_ref: "ext:blk-l4",
      },
    ];
    const html = composeCommentaryBody(dm);
    expect(html).toContain('id="operations"');
    expect(html).toContain("Review of operations");
    expect(html).toContain("Gold production at Ergo was 9% lower at 1 683kg.");
    expect(html).toMatch(/commentary-toc__link[^>]*>[\s\S]*Review of operations/);
  });

  it("mounts ops KPI tables under Review of operations", () => {
    const tableHtml =
      '<section data-dna-component="statement-table" class="statement-table"><table class="fin-table"><tbody><tr><td>Cash operating costs</td><td class="cell-unit">R per kg</td><td class="cell-num"><span class="num" data-src="ext:t_ops:r1c2">980 042</span></td></tr></tbody></table></section>';
    const html = composeCommentaryBody(docModel(), { opsTablesHtml: [tableHtml] });
    expect(html).toContain('id="operations"');
    expect(html).toContain("commentary-ops-tables");
    expect(html).toContain("980 042");
    expect(html).toMatch(
      /id="operations"[\s\S]*commentary-ops-tables[\s\S]*980 042/,
    );
  });
});
