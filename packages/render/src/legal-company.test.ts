import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DesignDNA, ExtractionResult } from "@rs/contracts";
import {
  extractChromeIdentityText,
  looksLikeProjectSlug,
  resolveLegalCompanyName,
} from "./legal-company.js";
import { renderSeoHead, renderSiteFooter, renderStickyNav } from "./chrome.js";
import { checkLegalCompanyChrome } from "./corporate-reliability.js";

describe("looksLikeProjectSlug", () => {
  it("flags trailing-digit portal titles", () => {
    expect(looksLikeProjectSlug("DRD Gold 1")).toBe(true);
    expect(looksLikeProjectSlug("Acme Demo 2")).toBe(true);
  });

  it("allows legal / trading names including digits", () => {
    expect(looksLikeProjectSlug("DRDGOLD")).toBe(false);
    expect(looksLikeProjectSlug("DRDGOLD Limited")).toBe(false);
    expect(looksLikeProjectSlug("3M")).toBe(false);
    expect(looksLikeProjectSlug("Universal Music Group")).toBe(false);
    expect(looksLikeProjectSlug("six months ended 31 December 2025")).toBe(false);
    expect(looksLikeProjectSlug("HY1 FY2026")).toBe(false);
  });
});

describe("resolveLegalCompanyName", () => {
  it("prefers extraction issuer over project slug", () => {
    let extraction: ExtractionResult | null = null;
    let dna: DesignDNA | null = null;
    try {
      extraction = JSON.parse(readFileSync("/tmp/drd-extraction.json", "utf8"));
      dna = JSON.parse(readFileSync("/tmp/drd-dna.json", "utf8"));
    } catch {
      // Offline CI without fixtures — use a minimal stub.
      extraction = {
        schema_version: "1.0",
        extraction_id: "e",
        org_id: "o",
        project_id: "p",
        source: {
          blob_path: "x",
          sha256: "a".repeat(64),
          size_bytes: 1,
          page_count: 1,
          pdf_meta: { title: "", producer: "", created: "", modified: "" },
        },
        engine: {
          docling_version: "1",
          backend: "t",
          table_mode: "fast",
          ocr_applied: false,
          ocr_engine: null,
        },
        pages: [],
        body: [
          {
            id: "blk-0011",
            type: "heading",
            text: "DRDGOLD Limited",
            prov: [],
            children: [],
          },
        ],
        furniture: [],
        tables: {},
        figures: {},
        warnings: [],
        enrichment: {
          sections: [
            {
              id: "sec",
              title: "DRDGOLD Limited",
              level: 1,
              page_span: [1, 1],
              block_ids: [],
            },
          ],
          key_figures: [],
          numeric_annotations: {},
        },
      };
      dna = null;
    }

    const r = resolveLegalCompanyName({
      extraction,
      dna,
      projectCompanyName: "DRD Gold 1",
    });
    expect(r.company).toMatch(/DRDGOLD/i);
    expect(r.company).not.toMatch(/DRD Gold 1/i);
    expect(r.ignoredProjectSlug).toBe("DRD Gold 1");
    expect(["extraction-heading", "extraction-enrichment", "extraction-alias", "dna-motif"]).toContain(
      r.source,
    );
  });

  it("falls back to non-slug project name", () => {
    const r = resolveLegalCompanyName({
      projectCompanyName: "Acme Mining Limited",
    });
    expect(r.company).toBe("Acme Mining Limited");
    expect(r.source).toBe("project");
  });
});

describe("checkLegalCompanyChrome", () => {
  it("passes DRDGOLD chrome and fails project slug leakage", () => {
    const nav = renderStickyNav([{ label: "Home", href: "index.html" }], "index.html", "DRDGOLD Limited");
    const footer = renderSiteFooter("DRDGOLD Limited", "HY1 FY2026");
    const head = renderSeoHead(
      { path: "index.html", title: "Home", company: "DRDGOLD Limited", periodLabel: "HY1" },
      "",
    );
    const good = `<!doctype html><html><head>${head}</head><body>${nav}<main class="home-hero"><h1 data-allow-number>DRDGOLD Limited</h1></main>${footer}</body></html>`;
    const ok = checkLegalCompanyChrome(good, "index.html", {
      expectedLegalName: "DRDGOLD",
      forbiddenProjectTitles: ["DRD Gold 1"],
    });
    expect(ok.every((f) => f.ok)).toBe(true);

    const badNav = renderStickyNav([{ label: "Home", href: "index.html" }], "index.html", "DRD Gold 1");
    const bad = good.replace(nav, badNav).replace(/DRDGOLD Limited/g, "DRD Gold 1");
    const fail = checkLegalCompanyChrome(bad, "index.html", {
      expectedLegalName: "DRDGOLD",
      forbiddenProjectTitles: ["DRD Gold 1"],
    });
    expect(fail.some((f) => !f.ok && f.code === "project-slug-in-chrome")).toBe(true);
    expect(extractChromeIdentityText(bad)).toMatch(/DRD Gold 1/);
  });
});
