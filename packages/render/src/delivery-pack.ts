/**
 * P6 — client delivery pack gates + handoff artifacts.
 * Offline zip must open from index.html with working relative assets,
 * downloads (PDF/XLSX), SEO, and a short client README / export manifest.
 */

import type { ReliabilityFinding, SiteFiles } from "./corporate-reliability.js";
import { SOURCE_PDF_HREF, WORKBOOK_HREF } from "./excel-exporter.js";

export interface DeliveryPackMeta {
  schema_version: "multipage-export/1";
  pack: "client-delivery";
  entrypoint: "index.html";
  mode: "multipage";
  company: string;
  company_source?: string;
  period_label: string;
  created_at: string;
  pages: Array<{ path: string; title: string }>;
  files: string[];
  excel_sheets: string[];
  pdf_bundled: boolean;
  brand_logo: boolean;
  brand_banner: boolean;
  gate_a: string;
  gate_b: string;
  corporate_reliability: string;
  prototype_bundled: boolean;
  hosting: {
    offline: string;
    static_host: string;
  };
  notes: string[];
}

export interface DeliveryPackBuildInput {
  company: string;
  companySource?: string;
  periodLabel: string;
  pages: Array<{ path: string; title: string }>;
  paths: string[];
  excelSheetNames: string[];
  pdfBundled: boolean;
  brandLogo: boolean;
  brandBanner: boolean;
  gateA: string;
  gateB: string;
  reliabilityOk: boolean;
  prototypeBundled?: boolean;
  createdAt?: string;
}

/** Client-facing handoff README written into the zip root. */
export function renderClientDeliveryReadme(meta: DeliveryPackMeta): string {
  const pdfLine = meta.pdf_bundled
    ? `- Source PDF at \`${SOURCE_PDF_HREF}\``
    : `- Source PDF not bundled in this pack (re-export from the portal after upload)`;
  const brandLine =
    meta.brand_logo || meta.brand_banner
      ? `- Brand assets under \`assets/brand/\` (logo=${meta.brand_logo ? "yes" : "no"}, banner=${meta.brand_banner ? "yes" : "no"})`
      : `- Brand text wordmark in chrome (no logo/banner binary in this pack)`;
  const protoLine = meta.prototype_bundled
    ? `- Optional \`prototype/\` preview is legacy only — not the product entrypoint`
    : `- No \`prototype/\` preview bundled`;

  return `# ${meta.company || "Investor Results"} — Client Delivery Pack

Static multipage investor-results microsite for offline review or static hosting.

## What's included

- Multipage IR site — open **\`index.html\`** (product entrypoint)
- Runtime: \`assets/site.js\` (progressive enhancement; content visible without JS)
- Self-hosted fonts under \`assets/fonts/\`
- Excel workbooks under \`assets/excel/\` (full workbook + per-statement)
${pdfLine}
${brandLine}
- Machine-readable manifest: \`_meta/export.json\`
${protoLine}

**Issuer:** ${meta.company || "(see pages)"}  
**Period:** ${meta.period_label || "(see pages)"}  
**Pages:** ${meta.pages.length} · **Gate A/B:** ${meta.gate_a}/${meta.gate_b}

## Open offline

1. Unzip this archive to a folder.
2. Open \`index.html\` in Chrome, Safari, or Edge (double-click or File → Open).
3. Use the site nav — all links and downloads are relative to this folder.

## Host on a static server

Upload the **unzipped folder** as the site root (S3/CloudFront, Netlify, nginx, Azure static website, etc.).

- Default document must be \`index.html\`
- No Node/server runtime required
- Keep relative paths intact (do not flatten \`financials/\` or \`assets/\`)

## Downloads

- Full workbook: \`${WORKBOOK_HREF}\`
- Per-statement \`.xlsx\` files alongside the workbook
${meta.pdf_bundled ? `- Source results PDF: \`${SOURCE_PDF_HREF}\`` : "- PDF: not in this zip — see downloads page note"}

## Integrity

Figures are provenance-bound from the extraction. Do not hand-edit statement cells; re-export from Results Studio after source changes. Corporate readiness gates (including this delivery pack) passed at build time.

---
Generated for client delivery · schema ${meta.schema_version}
`;
}

/** Build the `_meta/export.json` payload for draft + signed-off zips. */
export function buildDeliveryPackMeta(input: DeliveryPackBuildInput): DeliveryPackMeta {
  return {
    schema_version: "multipage-export/1",
    pack: "client-delivery",
    entrypoint: "index.html",
    mode: "multipage",
    company: input.company,
    company_source: input.companySource,
    period_label: input.periodLabel,
    created_at: input.createdAt ?? new Date().toISOString(),
    pages: input.pages,
    files: input.paths,
    excel_sheets: input.excelSheetNames,
    pdf_bundled: input.pdfBundled,
    brand_logo: input.brandLogo,
    brand_banner: input.brandBanner,
    gate_a: input.gateA,
    gate_b: input.gateB,
    corporate_reliability: input.reliabilityOk ? "pass" : "fail",
    prototype_bundled: Boolean(input.prototypeBundled),
    hosting: {
      offline: "Unzip and open index.html in a modern browser",
      static_host:
        "Upload the unzipped folder as a static site root; default document index.html; no server runtime",
    },
    notes: [
      "Product entrypoint is index.html — never prototype/",
      "Excel and PDF (when bundled) are linked from downloads.html with relative hrefs",
      "site.js is progressive enhancement only; content must render without JS",
    ],
  };
}

function keysOf(site: SiteFiles): Set<string> {
  return new Set([...Object.keys(site.files), ...Object.keys(site.binaries ?? {})]);
}

/** Resolve a relative href against the page path (posix-ish, zip tree). */
export function resolveFromPage(pagePath: string, href: string): string {
  const target = href.replace(/^\.\//, "").split("#")[0]!.split("?")[0]!;
  if (!target) return pagePath;
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const pageDir = pagePath.includes("/")
    ? pagePath.slice(0, pagePath.lastIndexOf("/") + 1)
    : "";
  const parts = `${pageDir}${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** Relative .html nav/pager links must resolve inside the zip tree. */
export function checkInternalHtmlLinks(
  html: string,
  path: string,
  available: Set<string>,
): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  // Ignore <link rel="canonical"> — metadata, not navigation (may be site-root path).
  const htmlNoCanonical = html.replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "");
  const hrefRe = /href="((?:\.\/|\.\.\/)?(?!https?:|mailto:|tel:|#)[^"]+\.html(?:#[^"]*)?)"/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(htmlNoCanonical))) {
    const raw = m[1]!;
    const resolved = resolveFromPage(path, raw);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!available.has(resolved)) {
      findings.push({
        ok: false,
        code: "broken-html-href",
        path,
        message: `${path}: href ${raw} → ${resolved} missing from site tree`,
      });
    }
  }
  if (findings.length === 0 && seen.size > 0) {
    findings.push({
      ok: true,
      code: "internal-html-hrefs",
      path,
      message: `${path}: ${seen.size} internal .html href(s) resolve`,
    });
  }
  return findings;
}

/**
 * P6 delivery-pack completeness for offline client zip / draft tree.
 * Call when the site is a full multipage export (downloads + excel).
 */
export function checkDeliveryPack(site: SiteFiles): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  const keys = keysOf(site);
  const home = site.files["index.html"] ?? "";
  const downloads = site.files["downloads.html"] ?? "";
  const readme = site.files["README.md"] ?? "";
  const exportMetaRaw = site.files["_meta/export.json"] ?? "";

  // 1. Entrypoint
  findings.push({
    ok: Boolean(home && home.length > 200),
    code: "delivery-entrypoint",
    path: "index.html",
    message: home
      ? "index.html present as product entrypoint"
      : "index.html missing — offline zip has no entrypoint",
  });

  // 2. prototype/ must not be the product entry
  const proto = site.files["prototype/index.html"];
  const protoIsProduct =
    Boolean(proto) &&
    (!home ||
      (!home.includes("site-nav") && !home.includes("data-dna-component")));
  findings.push({
    ok: !protoIsProduct,
    code: "delivery-no-prototype-entry",
    message: proto
      ? protoIsProduct
        ? "prototype/ appears to be the product entry — multipage index.html required"
        : "prototype/ present as optional legacy preview only"
      : "no prototype/ bundled (multipage-only pack)",
  });

  // 3. Core runtime + fonts
  for (const asset of [
    "assets/site.js",
    "assets/fonts/open-sans-latin-400-normal.woff2",
  ] as const) {
    const present = keys.has(asset);
    findings.push({
      ok: present,
      code: "delivery-asset",
      path: asset,
      message: present ? `${asset}: present` : `${asset}: missing from delivery pack`,
    });
  }

  // 4. Excel workbook + downloads links
  const workbookPresent = keys.has(WORKBOOK_HREF);
  findings.push({
    ok: workbookPresent,
    code: "delivery-xlsx",
    path: WORKBOOK_HREF,
    message: workbookPresent
      ? "financial-statements.xlsx present"
      : "Excel workbook missing from delivery pack",
  });
  const downloadsXlsx =
    downloads.includes(`href="${WORKBOOK_HREF}"`) ||
    downloads.includes(`href="./${WORKBOOK_HREF}"`);
  findings.push({
    ok: downloadsXlsx && !/Coming soon/i.test(downloads),
    code: "delivery-downloads-xlsx",
    path: "downloads.html",
    message: downloadsXlsx
      ? "downloads.html links to Excel workbook"
      : "downloads.html missing working Excel href",
  });

  // 5. PDF bundled or documented skip
  const pdfPresent = keys.has(SOURCE_PDF_HREF);
  const pdfLinked =
    downloads.includes(`href="${SOURCE_PDF_HREF}"`) ||
    downloads.includes(`href="./${SOURCE_PDF_HREF}"`);
  const pdfDocumentedSkip =
    /not available at export time/i.test(downloads) ||
    /not bundled/i.test(downloads);
  findings.push({
    ok: pdfPresent ? pdfLinked : pdfDocumentedSkip,
    code: "delivery-pdf",
    path: pdfPresent ? SOURCE_PDF_HREF : "downloads.html",
    message: pdfPresent
      ? pdfLinked
        ? "source.pdf bundled and linked from downloads"
        : "source.pdf present but not linked from downloads.html"
      : pdfDocumentedSkip
        ? "PDF omitted and documented on downloads page"
        : "PDF missing and downloads page does not document the skip",
  });

  // 6. Statement Excel toolbars when statement pages exist
  const statementPages = Object.keys(site.files).filter(
    (p) =>
      /^financials\/(income-statement|balance-sheet|cash-flows|changes-in-equity)\.html$/i.test(
        p,
      ),
  );
  if (statementPages.length && workbookPresent) {
    const missingToolbar = statementPages.filter(
      (p) => !/data-dna-component="xls-toolbar"/.test(site.files[p] ?? ""),
    );
    findings.push({
      ok: missingToolbar.length === 0,
      code: "delivery-xls-toolbar",
      message:
        missingToolbar.length === 0
          ? `xls-toolbar present on ${statementPages.length} statement page(s)`
          : `xls-toolbar missing on: ${missingToolbar.join(", ")}`,
    });
  }

  // 7. Brand binaries present → referenced (when available)
  const logoPath = [...keys].find((k) => /^assets\/brand\/logo\./i.test(k));
  const bannerPath = [...keys].find((k) => /^assets\/brand\/banner\./i.test(k));
  if (logoPath) {
    findings.push({
      ok: home.includes("assets/brand/logo") || home.includes(logoPath),
      code: "delivery-brand-logo",
      path: logoPath,
      message: home.includes("assets/brand/logo")
        ? "logo binary referenced from home"
        : `logo ${logoPath} present but not referenced on home`,
    });
  }
  if (bannerPath) {
    findings.push({
      ok: home.includes("assets/brand/banner") || home.includes(bannerPath),
      code: "delivery-brand-banner",
      path: bannerPath,
      message: home.includes("assets/brand/banner")
        ? "banner binary referenced from home"
        : `banner ${bannerPath} present but not referenced on home`,
    });
  }

  // 8. SEO / OG / JSON-LD polish
  const hasReportLd =
    home.includes("application/ld+json") && home.includes('"@type":"Report"');
  const hasOg =
    home.includes('property="og:title"') &&
    home.includes('property="og:description"') &&
    home.includes('property="og:site_name"');
  findings.push({
    ok: hasReportLd,
    code: "delivery-seo-report",
    path: "index.html",
    message: hasReportLd
      ? "home JSON-LD Report present"
      : "home missing schema.org Report JSON-LD",
  });
  findings.push({
    ok: hasOg,
    code: "delivery-seo-og",
    path: "index.html",
    message: hasOg
      ? "home OG title/description/site_name present"
      : "home missing OG tags for delivery",
  });

  const samplePage =
    site.files["financials/balance-sheet.html"] ??
    site.files["commentary.html"] ??
    "";
  if (samplePage) {
    const webPageLd =
      samplePage.includes("application/ld+json") &&
      samplePage.includes('"@type":"WebPage"');
    findings.push({
      ok: webPageLd,
      code: "delivery-seo-webpage",
      path: site.files["financials/balance-sheet.html"]
        ? "financials/balance-sheet.html"
        : "commentary.html",
      message: webPageLd
        ? "inner page JSON-LD WebPage present"
        : "inner page missing WebPage JSON-LD",
    });
  }

  // 9. Handoff notes
  const hasReadme =
    readme.length > 80 &&
    /index\.html/i.test(readme) &&
    (/offline/i.test(readme) || /host/i.test(readme));
  findings.push({
    ok: hasReadme,
    code: "delivery-readme",
    path: "README.md",
    message: hasReadme
      ? "README.md handoff notes present"
      : "README.md missing or incomplete (need index.html + offline/host guidance)",
  });

  let metaOk = false;
  let metaMessage = "_meta/export.json missing";
  if (exportMetaRaw) {
    try {
      const meta = JSON.parse(exportMetaRaw) as Partial<DeliveryPackMeta>;
      metaOk =
        meta.entrypoint === "index.html" &&
        meta.pack === "client-delivery" &&
        Boolean(meta.hosting?.offline || meta.hosting?.static_host);
      metaMessage = metaOk
        ? "_meta/export.json delivery manifest present"
        : "_meta/export.json present but missing entrypoint/pack/hosting fields";
    } catch {
      metaOk = false;
      metaMessage = "_meta/export.json is not valid JSON";
    }
  }
  findings.push({
    ok: metaOk,
    code: "delivery-export-meta",
    path: "_meta/export.json",
    message: metaMessage,
  });

  // 10. Internal HTML hrefs on home + downloads + one statement
  const linkPaths = ["index.html", "downloads.html", ...statementPages.slice(0, 1)].filter(
    (p) => site.files[p],
  );
  for (const p of linkPaths) {
    findings.push(...checkInternalHtmlLinks(site.files[p]!, p, keys));
  }

  return findings;
}

/** True when the site tree looks like a full multipage delivery (not a unit stub). */
export function siteLooksLikeDeliveryPack(site: SiteFiles): boolean {
  return Boolean(
    site.files["downloads.html"] ||
      site.files["README.md"] ||
      Object.keys(site.binaries ?? {}).some((p) => p.endsWith(".xlsx")),
  );
}
