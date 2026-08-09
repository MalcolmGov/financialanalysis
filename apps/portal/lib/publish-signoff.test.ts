import { describe, expect, it } from "vitest";
import {
  buildPublishChecklist,
  canSignOffPublish,
  checklistBlockers,
} from "./publish-signoff";

describe("publish readiness checklist", () => {
  it("blocks sign-off when reliability or gates fail", () => {
    const items = buildPublishChecklist({
      projectId: "p",
      draftId: "d",
      draftVersion: 1,
      gateA: "fail",
      gateB: "pass",
      corporateReliability: "fail",
      company: "DRDGOLD Limited",
      brandLogo: false,
      brandBanner: false,
      pages: [{ path: "index.html" }, { path: "downloads.html" }],
      files: ["index.html", "downloads.html", "README.md", "_meta/export.json", "assets/workbook.xlsx"],
    });
    expect(canSignOffPublish(items)).toBe(false);
    expect(checklistBlockers(items).length).toBeGreaterThan(0);
  });

  it("allows sign-off when critical gates pass (logo optional warn)", () => {
    const items = buildPublishChecklist({
      projectId: "p",
      draftId: "d",
      draftVersion: 14,
      gateA: "pass",
      gateB: "pass",
      corporateReliability: "pass",
      company: "DRDGOLD Limited",
      brandLogo: false,
      brandBanner: false,
      pages: [
        { path: "index.html" },
        { path: "commentary.html" },
        { path: "financials/balance-sheet.html" },
        { path: "downloads.html" },
      ],
      files: [
        "index.html",
        "README.md",
        "_meta/export.json",
        "assets/workbook.xlsx",
        "assets/source.pdf",
      ],
      pdfBundled: true,
      excelPresent: true,
    });
    expect(items.find((i) => i.id === "logo_or_fallback")?.status).toBe("warn");
    expect(items.find((i) => i.id === "brand_contrast")?.status).toBe("pass");
    expect(canSignOffPublish(items)).toBe(true);
    expect(checklistBlockers(items)).toEqual([]);
  });

  it("passes bright-brand contrast when chrome is remapped (MTN yellow)", () => {
    const items = buildPublishChecklist({
      projectId: "mtn",
      draftId: "d",
      draftVersion: 1,
      gateA: "pass",
      gateB: "pass",
      corporateReliability: "pass",
      company: "MTN Group Limited",
      brandLogo: true,
      brandBanner: false,
      clientLogo: true,
      brandHex: "#FFCB05",
      mastheadHex: "#FFCB05",
      dnaRoles: {
        brand: { hex: "#FFCB05" },
        "masthead-bg": { hex: "#FFCB05" },
        paper: { hex: "#FFFFFF" },
        ink: { hex: "#111111" },
      },
      pages: [
        { path: "index.html" },
        { path: "commentary.html" },
        { path: "financials/group/income-statement.html" },
        { path: "downloads.html" },
      ],
      files: [
        "index.html",
        "README.md",
        "_meta/export.json",
        "assets/workbook.xlsx",
        "assets/source.pdf",
      ],
      pdfBundled: true,
      excelPresent: true,
    });
    const contrast = items.find((i) => i.id === "brand_contrast");
    expect(contrast?.status).toBe("pass");
    expect(contrast?.detail).toMatch(/remapped|Bright brand/i);
    expect(canSignOffPublish(items)).toBe(true);
  });
});
