import { describe, expect, it } from "vitest";
import { CHROME_CSS, renderShareBar, renderStickyNav } from "./chrome.js";
import { auditCorporateReliability } from "./corporate-reliability.js";
import {
  buildDeliveryPackMeta,
  checkDeliveryPack,
  renderClientDeliveryReadme,
  resolveFromPage,
  siteLooksLikeDeliveryPack,
} from "./delivery-pack.js";
import { SITE_RUNTIME_JS } from "./site-runtime.js";

function padBody(s = "Investor results centre "): string {
  return s.repeat(40);
}

describe("resolveFromPage", () => {
  it("resolves same-folder and parent-folder hrefs", () => {
    expect(resolveFromPage("financials/income-statement.html", "notes.html#note-6")).toBe(
      "financials/notes.html",
    );
    expect(resolveFromPage("financials/income-statement.html", "../downloads.html")).toBe(
      "downloads.html",
    );
    expect(resolveFromPage("index.html", "financials/balance-sheet.html")).toBe(
      "financials/balance-sheet.html",
    );
  });
});

describe("delivery pack handoff artifacts", () => {
  it("renders README with entrypoint and hosting guidance", () => {
    const meta = buildDeliveryPackMeta({
      company: "DRDGOLD Limited",
      companySource: "extraction",
      periodLabel: "HY1 FY2026 — six months ended 31 December 2025",
      pages: [{ path: "index.html", title: "Home" }],
      paths: ["index.html", "README.md"],
      excelSheetNames: ["Income statement"],
      pdfBundled: true,
      brandLogo: false,
      brandBanner: false,
      gateA: "pass",
      gateB: "pass",
      reliabilityOk: true,
    });
    const readme = renderClientDeliveryReadme(meta);
    expect(readme).toContain("index.html");
    expect(readme).toMatch(/offline/i);
    expect(readme).toMatch(/static/i);
    expect(readme).toContain("assets/source.pdf");
    expect(meta.pack).toBe("client-delivery");
    expect(meta.entrypoint).toBe("index.html");
    expect(meta.hosting.offline).toMatch(/index\.html/i);
  });
});

describe("checkDeliveryPack", () => {
  it("passes a complete offline pack", () => {
    const nav = renderStickyNav(
      [
        { label: "Home", href: "index.html" },
        { label: "Downloads", href: "downloads.html" },
      ],
      "index.html",
      "DRDGOLD Limited",
    );
    const seo = `<meta property="og:title" content="DRDGOLD"><meta property="og:description" content="Results"><meta property="og:site_name" content="DRDGOLD Investor Results Centre"><script type="application/ld+json">{"@type":"Report","name":"DRDGOLD Limited"}</script>`;
    const home = `<!doctype html><html><head>${seo}<style>${CHROME_CSS}</style></head><body>${nav}<main class="reveal">${padBody()}</main>${renderShareBar()}<script src="assets/site.js"></script></body></html>`;
    const downloads = `<!doctype html><html><head>${seo.replace("Report", "WebPage")}</head><body><main><section class="downloads" data-dna-component="downloads">
<a class="dl-link" href="assets/source.pdf">PDF</a>
<a class="dl-link" href="assets/excel/financial-statements.xlsx">XLSX</a>
</section></main></body></html>`;
    const statement = `<!doctype html><html><head>${seo.replace("Report", "WebPage")}</head><body>
<div class="xls-toolbar" data-dna-component="xls-toolbar"><a href="../assets/excel/income-statement.xlsx">xls</a></div>
<main>${padBody()}</main></body></html>`;
    const meta = buildDeliveryPackMeta({
      company: "DRDGOLD Limited",
      periodLabel: "HY1 FY2026",
      pages: [
        { path: "index.html", title: "Home" },
        { path: "downloads.html", title: "Downloads" },
      ],
      paths: ["index.html", "downloads.html", "README.md"],
      excelSheetNames: ["Income"],
      pdfBundled: true,
      brandLogo: false,
      brandBanner: false,
      gateA: "pass",
      gateB: "pass",
      reliabilityOk: true,
    });
    const site = {
      files: {
        "index.html": home,
        "downloads.html": downloads,
        "financials/income-statement.html": statement,
        "assets/site.js": SITE_RUNTIME_JS,
        "README.md": renderClientDeliveryReadme(meta),
        "_meta/export.json": JSON.stringify(meta, null, 2),
      },
      binaries: {
        "assets/fonts/open-sans-latin-400-normal.woff2": new Uint8Array(64).fill(1),
        "assets/excel/financial-statements.xlsx": new Uint8Array(128).fill(2),
        "assets/excel/income-statement.xlsx": new Uint8Array(64).fill(3),
        "assets/source.pdf": new Uint8Array(64).fill(4),
      },
    };
    const findings = checkDeliveryPack(site);
    const fails = findings.filter((f) => !f.ok);
    expect(fails, JSON.stringify(fails, null, 2)).toEqual([]);
  });

  it("fails when README / export manifest missing", () => {
    const site = {
      files: {
        "index.html": `<html><head><script type="application/ld+json">{"@type":"Report"}</script><meta property="og:title" content="x"><meta property="og:description" content="y"><meta property="og:site_name" content="z"></head><body><nav class="site-nav">${padBody()}</nav><script src="assets/site.js"></script></body></html>`,
        "downloads.html": `<html><body><a href="assets/excel/financial-statements.xlsx">x</a><span>not bundled</span></body></html>`,
        "assets/site.js": SITE_RUNTIME_JS,
      },
      binaries: {
        "assets/fonts/open-sans-latin-400-normal.woff2": new Uint8Array(64).fill(1),
        "assets/excel/financial-statements.xlsx": new Uint8Array(64).fill(1),
      },
    };
    const findings = checkDeliveryPack(site);
    expect(findings.some((f) => f.code === "delivery-readme" && !f.ok)).toBe(true);
    expect(findings.some((f) => f.code === "delivery-export-meta" && !f.ok)).toBe(true);
  });
});

describe("auditCorporateReliability deliveryPack auto", () => {
  it("does not require delivery pack on minimal stubs", () => {
    expect(
      siteLooksLikeDeliveryPack({
        files: { "index.html": "<html></html>", "assets/site.js": "x" },
      }),
    ).toBe(false);
  });

  it("rolls delivery-pack failures into corporate audit when downloads present", () => {
    const nav = renderStickyNav([{ label: "Home", href: "index.html" }], "index.html", "Acme");
    const body = padBody();
    const page = `<!doctype html><html><head><style>${CHROME_CSS}</style></head><body>${nav}<main class="reveal">${body}</main>${renderShareBar()}<script src="assets/site.js"></script></body></html>`;
    const audit = auditCorporateReliability(
      {
        files: {
          "index.html": page,
          "downloads.html": `<html><body><a href="assets/excel/financial-statements.xlsx">x</a></body></html>`,
          "assets/site.js": SITE_RUNTIME_JS,
        },
        binaries: {
          "assets/fonts/open-sans-latin-400-normal.woff2": new Uint8Array(64).fill(1),
          "assets/excel/financial-statements.xlsx": new Uint8Array(64).fill(1),
        },
      },
      { deliveryPack: true, gateA: { status: "pass" }, gateB: { status: "pass" } },
    );
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code.startsWith("delivery-") && !f.ok)).toBe(true);
  });
});
