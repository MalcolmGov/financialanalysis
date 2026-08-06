import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@rs/contracts";
import { extractProseSections, mapToDocModel } from "./docmodel.js";

type Block = ExtractionResult["body"][number];
function heading(id: string, page: number, text: string): Block {
  return { id, type: "heading", level: 1, text, prov: [{ page_no: page, bbox: { l: 0, t: 0, r: 1, b: 1 } }], children: [] };
}
function para(id: string, page: number, text: string): Block {
  return { id, type: "paragraph", text, prov: [{ page_no: page, bbox: { l: 0, t: 0, r: 1, b: 1 } }], children: [] };
}

function extraction(): ExtractionResult {
  return {
    schema_version: "1.0", extraction_id: "e", org_id: "o", project_id: "p",
    source: { blob_path: "s.pdf", sha256: "a".repeat(64), size_bytes: 1, page_count: 4, pdf_meta: { title: "", producer: "Workiva", created: "", modified: "" } },
    engine: { docling_version: "2.x", backend: "docling_default", table_mode: "accurate", ocr_applied: false, ocr_engine: null },
    pages: [],
    body: [
      heading("h-hi", 1, "Highlights"),
      para("p-hi", 1, "Operating profit increased by 72% to R2 712.8 million"),
      heading("h-share", 1, "Shareholder information"),
      heading("h-letter", 2, "Dear Shareholder"),
      heading("h-ov", 2, "Overview"),
      para("p-l1", 2, "We are pleased to report that our operating performance is tracking guidance."),
      para("p-l2", 2, "The main actor during the period was the gold price."),
      heading("h-safety", 3, "Safety"),
      para("p-l3", 3, "HY1 FY2026 was fatality-free."),
      heading("h-stmt", 5, "Statement of Profit or Loss and Other Comprehensive Income"),
      para("p-post", 5, "Revenue was strong."), // must NOT be part of the letter
    ],
    furniture: [], tables: {}, figures: [], warnings: [],
    enrichment: { sections: [], key_figures: [], numeric_annotations: {} },
  } as ExtractionResult;
}

describe("extractProseSections", () => {
  it("captures the shareholder letter from its heading to the first statement", () => {
    const secs = extractProseSections(extraction());
    const letter = secs.find((s) => s.kind === "letter");
    expect(letter).toBeTruthy();
    expect(letter!.title?.text).toBe("Dear Shareholder");
    const texts = letter!.blocks.map((b) => b.text);
    // includes letter paragraphs across pages 2-3, excludes the post-statement paragraph
    expect(texts).toContain("We are pleased to report that our operating performance is tracking guidance.");
    expect(texts).toContain("HY1 FY2026 was fatality-free.");
    expect(texts).not.toContain("Revenue was strong.");
  });

  it("captures the highlights section", () => {
    const secs = extractProseSections(extraction());
    const hi = secs.find((s) => s.kind === "highlights");
    expect(hi).toBeTruthy();
    expect(hi!.blocks[0].text).toContain("Operating profit increased by 72%");
  });

  it("mapToDocModel includes the prose sections (letter now populated for the studio)", () => {
    const dm = mapToDocModel(extraction(), { company: "X", period_label: "HY1", doc_kind: "interim_unaudited", currency: "ZAR" });
    expect(dm.sections.some((s) => s.kind === "letter")).toBe(true);
    expect(dm.sections.some((s) => s.kind === "highlights")).toBe(true);
  });
});
