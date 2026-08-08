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
    expect(canSignOffPublish(items)).toBe(true);
    expect(checklistBlockers(items)).toEqual([]);
  });
});
