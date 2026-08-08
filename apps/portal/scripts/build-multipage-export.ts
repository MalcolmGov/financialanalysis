/**
 * Offline multipage export from a local extraction (+ optional DNA) JSON.
 *
 *   pnpm --filter portal exec tsx scripts/build-multipage-export.ts \
 *     /tmp/drd-extraction.json [/tmp/drd-dna.json] [/tmp/drd-multipage] [/tmp/drd-source.pdf]
 *
 * Source PDF is optional. When omitted (JSON-only fixtures), Excel still ships
 * under assets/excel/; downloads.html notes that PDF was not bundled.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import type { DesignDNA, ExtractionResult } from "@rs/contracts";
import { auditCorporateReliability } from "@rs/render";
import { buildMultipageExport } from "../lib/build-multipage-export";

async function main() {
  const extractionPath = process.argv[2] ?? "/tmp/drd-extraction.json";
  const dnaPath = process.argv[3] ?? "/tmp/drd-dna.json";
  const outDir = process.argv[4] ?? "/tmp/drd-multipage";
  const pdfPath = process.argv[5] ?? "/tmp/drd-source.pdf";

  const extraction = JSON.parse(await fs.readFile(extractionPath, "utf8")) as ExtractionResult;
  const dna = JSON.parse(await fs.readFile(dnaPath, "utf8")) as DesignDNA;

  let sourcePdfBytes: Buffer | null = null;
  try {
    sourcePdfBytes = await fs.readFile(pdfPath);
  } catch {
    process.stdout.write(`Note: no source PDF at ${pdfPath} — Excel only in this smoke\n`);
  }

  const built = buildMultipageExport({
    dna,
    extraction,
    projectId: extraction.project_id || "offline",
    // Prove P1: portal slug must not win over extraction/DNA issuer.
    company: "DRD Gold 1",
    periodLabel: "HY1 FY2026 — six months ended 31 December 2025",
    sourcePdfBytes,
  });
  process.stdout.write(
    `Company: “${built.company}” (${built.companySource}) — portal slug “DRD Gold 1” ignored when issuer found\n`,
  );

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  for (const path of Object.keys(built.files)) {
    const dest = join(outDir, path);
    await fs.mkdir(join(dest, ".."), { recursive: true });
    await fs.writeFile(dest, built.files[path]!);
  }
  for (const path of Object.keys(built.binaries)) {
    const dest = join(outDir, path);
    await fs.mkdir(join(dest, ".."), { recursive: true });
    await fs.writeFile(dest, built.binaries[path]!);
  }

  const zipInput: Record<string, Uint8Array> = {};
  for (const path of Object.keys(built.files)) zipInput[path] = strToU8(built.files[path]!);
  for (const path of Object.keys(built.binaries)) zipInput[path] = built.binaries[path]!;
  const zipPath = `${outDir}.zip`;
  await fs.writeFile(zipPath, zipSync(zipInput, { level: 6 }));

  const htmlPaths = built.paths.filter((p) => p.endsWith(".html"));
  process.stdout.write(`Wrote ${built.paths.length} files → ${outDir}\n`);
  process.stdout.write(`Zip → ${zipPath}\n`);
  process.stdout.write(`Entrypoint: ${built.entrypoint}\n`);
  process.stdout.write(`Gate A: ${built.gateA.status} · Gate B: ${built.gateB.status}\n`);
  process.stdout.write(`Excel sheets: ${built.excelSheetNames.join(", ") || "(none)"}\n`);
  process.stdout.write(`PDF bundled: ${built.pdfBundled}\n`);
  process.stdout.write(`HTML pages:\n${built.pages.map((p) => `  - ${p.path} (${p.title})`).join("\n")}\n`);
  if (htmlPaths.some((p) => p.startsWith("prototype/"))) {
    process.stdout.write("Note: prototype/ present (optional preview only)\n");
  }

  const income = built.files["financials/income-statement.html"] ?? "";
  const bs = built.files["financials/balance-sheet.html"] ?? "";
  const cf = built.files["financials/cash-flows.html"] ?? "";
  const notes = built.files["financials/notes.html"] ?? "";
  const home = built.files["index.html"] ?? "";
  const downloads = built.files["downloads.html"] ?? "";
  const siteJs = built.files["assets/site.js"] ?? "";
  const workbook = built.binaries["assets/excel/financial-statements.xlsx"];
  const zipEntries = unzipSync(new Uint8Array(await fs.readFile(zipPath)));
  const zipPaths = Object.keys(zipEntries).sort();

  // Spot-check workbook XML contains a known IS total from HTML.
  let workbookHasRevenue = false;
  if (workbook) {
    try {
      const inner = unzipSync(workbook);
      const sheetXml = strFromU8(inner["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
      workbookHasRevenue =
        sheetXml.includes("5 053.2") ||
        Object.values(inner).some((u8) => strFromU8(u8).includes("5 053.2"));
    } catch {
      workbookHasRevenue = false;
    }
  }

  const checks = [
    ["index.html", !!built.files["index.html"]],
    ["commentary.html", !!built.files["commentary.html"]],
    ["income-statement", income.includes("5 053.2") || income.includes("fin-table")],
    ["site-nav", income.includes("site-nav") && income.includes("nav-dd")],
    ["breadcrumb", bs.includes("breadcrumb")],
    ["prev/next", bs.includes("page-pager")],
    ["site footer", home.includes("site-footer") && bs.includes("site-footer__brand")],
    ["nav brand", home.includes("nav-brand") && home.includes("nav-brand__name")],
    // P1 — legal name in chrome (not portal project slug)
    ["legal company resolved", /DRDGOLD/i.test(built.company) && built.companySource !== "project"],
    ["no project slug in nav", !/DRD Gold 1/i.test(home.match(/nav-brand__name[^>]*>([^<]*)/)?.[1] ?? "")],
    ["no project slug in hero", !/<h1[^>]*>DRD Gold 1</i.test(home) && /<h1[^>]*>[^<]*DRDGOLD/i.test(home)],
    ["no project slug in footer", !/site-footer__brand[^>]*>DRD Gold 1/i.test(home)],
    ["no project slug in OG", !/og:title" content="[^"]*DRD Gold 1/i.test(home)],
    ["page hero", bs.includes("page-hero") && bs.includes("page-hero__eyebrow")],
    ["cur shading IS", income.includes("data-cur-col") && income.includes(" cur")],
    ["cur shading BS", bs.includes('data-cur-col="3"') || /data-cur-col="3"/.test(bs)],
    ["cur shading CF", cf.includes("data-cur-col")],
    ["row taxonomy", /class="r-(section|line|subtotal|total)/.test(bs)],
    ["grp/bd borders", bs.includes("bd-tan") && bs.includes("bd-blue") && bs.includes("grp-top")],
    ["table hover CSS", income.includes("tbody tr:hover") || home.includes("tbody tr:hover")],
    ["statement unit", bs.includes("statement-unit") && bs.includes("colgroup")],
    ["stacked headers", bs.includes("h-fig") && bs.includes("h-fig__date")],
    ["note links", bs.includes('class="note-ref"') && bs.includes("notes.html#note-")],
    ["note anchors", /id="note-\d+"/.test(notes)],
    // P2 — statement IR design system
    ["rs-statement-ir CSS", bs.includes("/* rs-statement-ir */") && income.includes("/* rs-statement-ir */")],
    ["print statement CSS", bs.includes("@media print") && bs.includes("print-color-adjust")],
    ["IR skin all statements", [bs, income, cf].every((h) => h.includes("rs-statement-ir") && h.includes("data-cur-col"))],
    ["gold top rule", /border-top:2px solid var\(--dna-brand/.test(bs)],
    ["zebra/hover IR", bs.includes("tbody tr:hover") && (bs.includes("#DCE3E7") || bs.includes("r-line:nth-child"))],
    ["notes", !!built.files["financials/notes.html"]],
    ["downloads", !!built.files["downloads.html"]],
    ["no prototype entrypoint", !built.files["prototype/index.html"] || built.entrypoint === "index.html"],
    // P2 — SiteRuntime
    ["assets/site.js", siteJs.includes("data-countup") && siteJs.includes("user-mark") && siteJs.includes("data-nav-toggle")],
    ["runtime script tag", home.includes("assets/site.js") && bs.includes("../assets/site.js")],
    ["mobile nav", home.includes("data-nav-toggle") && home.includes('id="nav-mobile"')],
    ["selection tooltip", home.includes("share-tooltip") && home.includes("sel-share-mark")],
    ["KPI count-up", home.includes("data-countup") && home.includes("kpi-card")],
    ["reveal hooks", home.includes("class=\"kpi-card reveal\"") || home.includes("kpi-card reveal")],
    // P3 — editorial home / commentary / SEO
    ["home hero lede", home.includes("home-lede") && home.includes("home-cta__primary")],
    ["home explore desc", home.includes("explore-desc") && home.includes("Explore the report")],
    ["home highlights band", home.includes("highlights-band") || home.includes('data-dna-component="highlights"')],
    ["home KPI band", home.includes('data-dna-component="kpi-band"') || home.includes("kpi-band")],
    ["home listing chips", home.includes("home-meta__chip") && home.includes("ISIN:")],
    ["commentary sections", (built.files["commentary.html"] ?? "").includes("commentary-section") && (built.files["commentary.html"] ?? "").includes('id="letter"')],
    ["commentary toc", (built.files["commentary.html"] ?? "").includes("commentary-toc") || (built.files["commentary.html"] ?? "").includes("commentary-section")],
    ["SEO JSON-LD Report", home.includes("application/ld+json") && home.includes('"@type":"Report"')],
    ["SEO OG tags", home.includes('property="og:type"') && home.includes('property="og:site_name"')],
    ["SEO canonical", home.includes('rel="canonical"')],
    // Fonts
    ["self-hosted fonts CSS", home.includes("/* rs-fonts */") && home.includes("@font-face")],
    ["font binaries", !!built.binaries["assets/fonts/open-sans-latin-400-normal.woff2"]],
    // P4 — Excel + PDF downloads
    ["xlsx workbook binary", !!workbook && workbook.byteLength > 100],
    ["xlsx per-statement", !!built.binaries["assets/excel/income-statement.xlsx"] && !!built.binaries["assets/excel/balance-sheet.xlsx"]],
    ["xlsx sheet names", built.excelSheetNames.length >= 4],
    ["xlsx values match", workbookHasRevenue],
    ["downloads xlsx link", downloads.includes('href="assets/excel/financial-statements.xlsx"') && !downloads.includes("Coming soon")],
    [
      "xls-toolbar",
      income.includes('data-dna-component="xls-toolbar"') && income.includes("income-statement.xlsx"),
    ],
    [
      "pdf in zip or documented skip",
      built.pdfBundled
        ? zipPaths.includes("assets/source.pdf") && downloads.includes('href="assets/source.pdf"')
        : downloads.includes("not available at export time") || downloads.includes("not bundled"),
    ],
    ["zip has excel", zipPaths.includes("assets/excel/financial-statements.xlsx")],
    ["gate A", built.gateA.status === "pass"],
    ["gate B", built.gateB.status === "pass"],
    // P0 — reliability / preview truth
    ["rs-motion PE CSS", home.includes("html.rs-motion") && home.includes(".reveal")],
    ["reveal default visible", /(?:^|})\s*\.reveal,\s*\.kpi-card\{[^}]*opacity\s*:\s*1/.test(home.replace(/\s+/g, "")) || home.includes(".reveal,.kpi-card{opacity:1")],
    ["brand onerror", home.includes("data-brand-img") ? home.includes("onerror=") : home.includes("nav-brand__name")],
  ] as const;

  const reliability = auditCorporateReliability({
    files: built.files,
    binaries: built.binaries,
  });
  for (const [name, ok] of checks) {
    process.stdout.write(`${ok ? "✓" : "✗"} ${name}\n`);
  }
  process.stdout.write(`\nCorporate reliability audit:\n`);
  for (const f of reliability.findings) {
    process.stdout.write(`${f.ok ? "✓" : "✗"} ${f.code}${f.path ? ` [${f.path}]` : ""}: ${f.message}\n`);
  }
  if (checks.some(([, ok]) => !ok) || !reliability.ok) {
    if (built.gateB.status !== "pass") {
      const byReason = new Map<string, number>();
      for (const f of built.gateB.failures) {
        byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
      }
      process.stdout.write(`Gate B detail: ${JSON.stringify(Object.fromEntries(byReason))}\n`);
      for (const f of built.gateB.failures.slice(0, 12)) {
        process.stdout.write(
          `  [${f.reason}] ${f.page} tok=${JSON.stringify(f.token).slice(0, 100)} src=${f.data_src}\n`,
        );
      }
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
