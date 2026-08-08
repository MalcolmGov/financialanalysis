/**
 * P0 / P5 / P6 — corporate IR reliability gates for multipage HTML.
 * Fail closed on blank pages, unguarded opacity:0 reveal, missing assets,
 * missing brand text fallback, project-slug leakage into chrome, Gate A/B,
 * preview-path vis_text floors, or incomplete client delivery packs.
 */

import type { GateAResult } from "./gate-a.js";
import type { GateBResult } from "./gate-b.js";
import {
  checkDeliveryPack,
  siteLooksLikeDeliveryPack,
} from "./delivery-pack.js";
import {
  extractChromeIdentityText,
  looksLikeProjectSlug,
} from "./legal-company.js";
import {
  checkStatementIrFidelity,
  isStatementFinancialPage,
} from "./statement-fidelity.js";

export interface ReliabilityFinding {
  ok: boolean;
  code: string;
  message: string;
  path?: string;
}

export interface SiteFiles {
  /** Text files keyed by relative path (HTML/JS/CSS/JSON). */
  files: Record<string, string>;
  /** Optional binaries (fonts, images, xlsx, pdf). */
  binaries?: Record<string, Uint8Array>;
}

/** Minimum visible text bytes (tags/scripts/styles stripped) per HTML page. */
export const MIN_VISIBLE_TEXT_BYTES = 280;

/** Home / commentary carry denser editorial — slightly higher floor. */
export const MIN_VISIBLE_TEXT_BYTES_EDITORIAL = 420;

/** Alias used by preview/iframe CI reporting. */
export const MIN_PREVIEW_VIS_TEXT_BYTES = MIN_VISIBLE_TEXT_BYTES;
export const MIN_PREVIEW_VIS_TEXT_BYTES_EDITORIAL = MIN_VISIBLE_TEXT_BYTES_EDITORIAL;

const REQUIRED_ASSETS = [
  "assets/site.js",
  "assets/fonts/open-sans-latin-400-normal.woff2",
] as const;

/** Strip tags/scripts/styles and measure remaining text payload. */
export function visibleTextBytes(html: string): number {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Buffer.byteLength(stripped, "utf8");
}

function extractStyleBlocks(htmlOrCss: string): string {
  if (!/<style\b/i.test(htmlOrCss) && !/<html\b/i.test(htmlOrCss)) {
    return htmlOrCss;
  }
  const blocks: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlOrCss))) blocks.push(m[1] ?? "");
  return blocks.join("\n");
}

/**
 * Fail if .reveal / .kpi-card are hidden with opacity:0 without html.rs-motion.
 * Share-toast and decorative opacity are ignored.
 */
export function checkRevealProgressiveEnhancement(htmlOrCss: string): ReliabilityFinding {
  const css = extractStyleBlocks(htmlOrCss).replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css))) {
    const selectors = m[1] ?? "";
    const body = m[2] ?? "";
    if (!/opacity\s*:\s*0\b/.test(body)) continue;
    if (!/\.(?:reveal|kpi-card)\b/.test(selectors)) continue;
    const parts = selectors.split(",");
    for (const part of parts) {
      if (!/\.(?:reveal|kpi-card)\b/.test(part)) continue;
      if (!/html\.rs-motion\b/.test(part)) {
        return {
          ok: false,
          code: "reveal-opacity-unguarded",
          message: `Content hide uses opacity:0 without html.rs-motion guard: ${part.trim().slice(0, 120)}`,
        };
      }
    }
  }
  // Positive signal: progressive arm must exist when reveal/kpi motion is present.
  if (
    /\.(?:reveal|kpi-card)\b/.test(css) &&
    /opacity\s*:\s*0\b/.test(css) &&
    !/html\.rs-motion\b/.test(css)
  ) {
    return {
      ok: false,
      code: "reveal-opacity-unguarded",
      message: "opacity:0 present near reveal/kpi but html.rs-motion guard missing",
    };
  }
  return {
    ok: true,
    code: "reveal-pe",
    message: "Reveal/KPI opacity:0 is gated by html.rs-motion (or absent)",
  };
}

export function checkPageMinContent(
  html: string,
  path: string,
  minBytes?: number,
): ReliabilityFinding {
  const editorial = /(?:^|\/)(index|commentary)\.html$/i.test(path);
  const floor = minBytes ?? (editorial ? MIN_VISIBLE_TEXT_BYTES_EDITORIAL : MIN_VISIBLE_TEXT_BYTES);
  const bytes = visibleTextBytes(html);
  if (bytes < floor) {
    return {
      ok: false,
      code: "min-content-bytes",
      path,
      message: `${path}: visible text ${bytes}B < ${floor}B (blank/near-blank)`,
    };
  }
  return {
    ok: true,
    code: "min-content-bytes",
    path,
    message: `${path}: visible text ${bytes}B ≥ ${floor}B`,
  };
}

/**
 * P5 — iframe / preview vis_text gate.
 * Same floor as min-content, but coded for preview-path CI reporting so a full
 * HTML byte count can never be confused with “content visible in the iframe”.
 */
export function checkPreviewVisText(
  html: string,
  path: string,
  minBytes?: number,
): ReliabilityFinding {
  const editorial = /(?:^|\/)(index|commentary)\.html$/i.test(path);
  const floor =
    minBytes ??
    (editorial ? MIN_PREVIEW_VIS_TEXT_BYTES_EDITORIAL : MIN_PREVIEW_VIS_TEXT_BYTES);
  const bytes = visibleTextBytes(html);
  if (bytes < floor) {
    return {
      ok: false,
      code: "preview-vis-text",
      path,
      message: `${path}: preview vis_text ${bytes}B < ${floor}B (would look blank in iframe)`,
    };
  }
  return {
    ok: true,
    code: "preview-vis-text",
    path,
    message: `${path}: preview vis_text ${bytes}B ≥ ${floor}B`,
  };
}

/**
 * Catch the blank-home crisis class: content hidden by default CSS / baked
 * rs-motion without JS having a chance to reveal. Complements PE opacity guard.
 */
export function checkNoJsContentVisible(html: string, path: string): ReliabilityFinding {
  // Baked html.rs-motion on the document element would hide .reveal/.kpi-card
  // until JS adds .is-visible — iframe looks blank if site.js/CSP fails.
  const htmlOpen = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  if (/\brs-motion\b/.test(htmlOpen)) {
    return {
      ok: false,
      code: "iframe-blank-risk",
      path,
      message: `${path}: <html> bakes rs-motion — reveal/KPI would stay opacity:0 without runtime`,
    };
  }

  const pe = checkRevealProgressiveEnhancement(html);
  if (!pe.ok) {
    return {
      ok: false,
      code: "iframe-blank-risk",
      path,
      message: `${path}: ${pe.message}`,
    };
  }

  // Default visible rule must exist when reveal/kpi motion CSS is present.
  const css = extractStyleBlocks(html).replace(/\/\*[\s\S]*?\*\//g, "");
  const hasRevealMotion =
    /\.(?:reveal|kpi-card)\b/.test(css) && /opacity\s*:\s*0\b/.test(css);
  if (hasRevealMotion) {
    const defaultVisible =
      /\.reveal\s*,\s*\.kpi-card\s*\{[^}]*opacity\s*:\s*1/.test(css.replace(/\s+/g, " ")) ||
      /\.reveal\s*\{[^}]*opacity\s*:\s*1/.test(css) ||
      /\.kpi-card\s*\{[^}]*opacity\s*:\s*1/.test(css);
    if (!defaultVisible) {
      return {
        ok: false,
        code: "iframe-blank-risk",
        path,
        message: `${path}: reveal/kpi opacity:0 present without default opacity:1 (no-JS blank)`,
      };
    }
  }

  return {
    ok: true,
    code: "iframe-blank-risk",
    path,
    message: `${path}: no-JS / iframe blank-risk checks clear`,
  };
}

/** Gate A/B hard findings for the corporate readiness rollup. */
export function checkGateStatuses(opts: {
  gateA?: GateAResult | { status: string };
  gateB?: GateBResult | { status: string };
}): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  if (opts.gateA) {
    const pass = opts.gateA.status === "pass";
    findings.push({
      ok: pass,
      code: "gate-a",
      message: pass
        ? "Gate A pass (referential + coverage)"
        : `Gate A ${opts.gateA.status}`,
    });
  }
  if (opts.gateB) {
    const pass = opts.gateB.status === "pass";
    const detail =
      !pass && "failures" in opts.gateB && Array.isArray(opts.gateB.failures)
        ? ` (${opts.gateB.failures.length} DOM audit failures)`
        : "";
    findings.push({
      ok: pass,
      code: "gate-b",
      message: pass
        ? "Gate B pass (DOM number audit)"
        : `Gate B ${opts.gateB.status}${detail}`,
    });
  }
  return findings;
}

export function checkAssetPresence(site: SiteFiles): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  const keys = new Set([
    ...Object.keys(site.files),
    ...Object.keys(site.binaries ?? {}),
  ]);
  for (const asset of REQUIRED_ASSETS) {
    const present = keys.has(asset);
    const body = site.files[asset];
    const bin = site.binaries?.[asset];
    const nonEmpty =
      present &&
      ((typeof body === "string" && body.length > 32) ||
        (bin != null && bin.byteLength > 32));
    findings.push({
      ok: !!nonEmpty,
      code: "asset-presence",
      path: asset,
      message: nonEmpty
        ? `${asset}: present`
        : `${asset}: missing or empty`,
    });
  }
  // site.js must arm progressive motion
  const siteJs = site.files["assets/site.js"] ?? "";
  if (siteJs && !siteJs.includes("rs-motion")) {
    findings.push({
      ok: false,
      code: "runtime-rs-motion",
      path: "assets/site.js",
      message: "assets/site.js missing rs-motion arming",
    });
  } else if (siteJs) {
    findings.push({
      ok: true,
      code: "runtime-rs-motion",
      path: "assets/site.js",
      message: "assets/site.js arms html.rs-motion",
    });
  }
  return findings;
}

/**
 * P4 — share/mark/mobile-nav runtime chrome must be present and wired.
 * Content remains visible without JS; this only asserts the enhancement surface.
 */
export function checkRuntimeShareChrome(site: SiteFiles): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  const siteJs = site.files["assets/site.js"] ?? "";
  const home =
    site.files["index.html"] ??
    site.files[Object.keys(site.files).find((p) => p.endsWith("/index.html")) ?? ""] ??
    "";

  const runtimeNeeds = [
    ["rs-motion", "arms html.rs-motion"],
    ["localStorage", "persists highlights"],
    ["rs-marks-", "marks storage key"],
    ["showToast", "toast feedback"],
    ["initEscape", "Escape closes overlays"],
    ["closeMobileNav", "mobile nav close"],
    ["sel-share-email", "selection email action"],
    ["data-share", "page share bar hooks"],
    ["data-countup", "KPI count-up"],
  ] as const;

  if (!siteJs) {
    findings.push({
      ok: false,
      code: "runtime-share",
      path: "assets/site.js",
      message: "assets/site.js missing",
    });
    return findings;
  }

  const missingRuntime = runtimeNeeds.filter(([needle]) => !siteJs.includes(needle)).map(([n]) => n);
  findings.push({
    ok: missingRuntime.length === 0,
    code: "runtime-share",
    path: "assets/site.js",
    message:
      missingRuntime.length === 0
        ? "site.js share/mark/nav/toast/Escape surface present"
        : `site.js missing runtime polish: ${missingRuntime.join(", ")}`,
  });

  // Lean budget — polish quality, not WW-scale bloat (WW ~21KB).
  const jsBytes = Buffer.byteLength(siteJs, "utf8");
  findings.push({
    ok: jsBytes > 2_000 && jsBytes < 24_000,
    code: "runtime-lean",
    path: "assets/site.js",
    message:
      jsBytes > 2_000 && jsBytes < 24_000
        ? `site.js lean (${jsBytes}B < 24KB)`
        : `site.js size out of band: ${jsBytes}B (expect 2–24KB)`,
  });

  if (home) {
    const chromeNeeds = [
      ["share-tooltip", "selection tip host"],
      ["sel-share-copy", "selection Copy"],
      ["sel-share-mark", "selection Highlight"],
      ["sel-share-linkedin", "selection LinkedIn"],
      ["sel-share-email", "selection Email"],
      ['data-share="copy"', "share Copy"],
      ['data-share="linkedin"', "share LinkedIn"],
      ['data-share="email"', "share Email"],
      ["share-toast", "toast host"],
      ["data-nav-toggle", "mobile nav toggle"],
      ['id="nav-mobile"', "mobile nav panel"],
    ] as const;
    const missingChrome = chromeNeeds.filter(([n]) => !home.includes(n)).map(([, label]) => label);
    findings.push({
      ok: missingChrome.length === 0,
      code: "runtime-share-chrome",
      path: "index.html",
      message:
        missingChrome.length === 0
          ? "home share/mark/nav chrome present"
          : `home missing share chrome: ${missingChrome.join(", ")}`,
    });

    const peNav =
      /html:not\(\.rs-motion\)\s*\.nav-mobile/.test(home) ||
      /html:not\(\.rs-motion\)\s*\.nav-mobile\{/.test(home);
    findings.push({
      ok: peNav,
      code: "runtime-nav-pe",
      path: "index.html",
      message: peNav
        ? "mobile nav visible without JS (html:not(.rs-motion) guard)"
        : "mobile nav missing no-JS progressive fallback CSS",
    });
  }

  return findings;
}

/** Logo img OK, or intentional text wordmark — never neither. */
export function checkBrandFallback(html: string, path = "index.html"): ReliabilityFinding {
  const hasTextMark = /class="[^"]*nav-brand__name[^"]*"/.test(html) || /nav-brand__name/.test(html);
  const hasLogo = /data-brand-img/.test(html);
  const hasOnerror = hasLogo && /onerror=/.test(html) && /data-brand-img/.test(html);
  if (!hasTextMark && !hasLogo) {
    return {
      ok: false,
      code: "brand-fallback",
      path,
      message: `${path}: no logo and no nav-brand__name text fallback`,
    };
  }
  if (hasLogo && !hasTextMark) {
    return {
      ok: false,
      code: "brand-fallback",
      path,
      message: `${path}: logo present without text wordmark fallback`,
    };
  }
  if (hasLogo && !hasOnerror) {
    return {
      ok: false,
      code: "brand-img-onerror",
      path,
      message: `${path}: brand img missing inline onerror fallback`,
    };
  }
  return {
    ok: true,
    code: "brand-fallback",
    path,
    message: hasLogo
      ? `${path}: logo + text fallback + onerror`
      : `${path}: text wordmark fallback (no logo)`,
  };
}

/** Relative asset hrefs in HTML that must resolve inside the site tree. */
export function checkRelativeAssetLinks(
  html: string,
  path: string,
  available: Set<string>,
): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  const depth = path.includes("/") ? path.split("/").filter(Boolean).length - 1 : 0;
  const basePrefix = depth > 0 ? "../".repeat(depth) : "";
  const hrefRe = /(?:src|href)="((?:\.\/|\.\.\/)?assets\/[^"#?]+)"/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = hrefRe.exec(html))) {
    const raw = m[1]!;
    if (seen.has(raw)) continue;
    seen.add(raw);
    let resolved = raw.replace(/^\.\//, "");
    if (basePrefix && resolved.startsWith(basePrefix)) {
      resolved = resolved.slice(basePrefix.length);
    } else {
      // From financials/foo.html, ../assets/x → assets/x
      while (resolved.startsWith("../")) resolved = resolved.slice(3);
    }
    if (!available.has(resolved)) {
      findings.push({
        ok: false,
        code: "broken-asset-href",
        path,
        message: `${path}: href/src ${raw} → ${resolved} missing from site tree`,
      });
    }
  }
  return findings;
}

export interface CorporateReliabilityOptions {
  /** Legal / trading name that must appear in identity chrome (nav/footer/hero/OG). */
  expectedLegalName?: string;
  /** Project titles / slugs that must not appear in identity chrome. */
  forbiddenProjectTitles?: string[];
  /** Gate A result — included in the corporate readiness rollup when provided. */
  gateA?: GateAResult | { status: string };
  /** Gate B result — included in the corporate readiness rollup when provided. */
  gateB?: GateBResult | { status: string };
  /**
   * When true (default), emit preview-vis-text findings per page in addition to
   * min-content-bytes. Turn off only for narrowly scoped unit fixtures.
   */
  previewVisText?: boolean;
  /**
   * P6 — assert offline delivery-pack completeness (README, export.json, xlsx/pdf,
   * SEO, entrypoint). Default: auto when the tree looks like a full multipage pack.
   * Pass true from buildMultipageExport; false for minimal unit stubs.
   */
  deliveryPack?: boolean;
}

/** Normalize for chrome presence checks (case/spacing; Limited optional). */
function normalizeBrandToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\blimited\b/g, "")
    .replace(/\bltd\.?\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Assert legal name is present in chrome identity regions, and that project
 * slugs (e.g. "DRD Gold 1") never leak into nav / hero / footer / OG / title.
 */
export function checkLegalCompanyChrome(
  html: string,
  path: string,
  opts: CorporateReliabilityOptions = {},
): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  const identity = extractChromeIdentityText(html);
  const identityLower = identity.toLowerCase();
  const identityNorm = normalizeBrandToken(identity);

  if (opts.expectedLegalName?.trim()) {
    const expected = opts.expectedLegalName.trim();
    const expNorm = normalizeBrandToken(expected);
    const present =
      identityLower.includes(expected.toLowerCase()) ||
      (expNorm.length >= 3 && identityNorm.includes(expNorm));
    findings.push({
      ok: present,
      code: "legal-name-present",
      path,
      message: present
        ? `${path}: legal name “${expected}” present in chrome`
        : `${path}: legal name “${expected}” missing from nav/hero/footer/OG/title`,
    });
  }

  for (const raw of opts.forbiddenProjectTitles ?? []) {
    const f = raw.trim();
    if (!f) continue;
    if (identityLower.includes(f.toLowerCase())) {
      findings.push({
        ok: false,
        code: "project-slug-in-chrome",
        path,
        message: `${path}: forbidden project title in chrome: “${f}”`,
      });
    }
  }

  // Scan identity segments (split on · | —) for slug-shaped labels.
  const slugHits: string[] = [];
  for (const line of identity.split("\n")) {
    for (const part of line.split(/[·|—–]/)) {
      const t = part.trim();
      if (t && looksLikeProjectSlug(t)) slugHits.push(t);
    }
  }
  if (slugHits.length) {
    findings.push({
      ok: false,
      code: "project-slug-in-chrome",
      path,
      message: `${path}: project slug pattern leaked into chrome: “${slugHits[0]!.slice(0, 80)}”`,
    });
  } else if (!(opts.forbiddenProjectTitles ?? []).some((f) => identityLower.includes(f.trim().toLowerCase()))) {
    findings.push({
      ok: true,
      code: "project-slug-in-chrome",
      path,
      message: `${path}: no project-slug patterns in identity chrome`,
    });
  }

  return findings;
}

export function auditCorporateReliability(
  site: SiteFiles,
  opts: CorporateReliabilityOptions = {},
): {
  ok: boolean;
  findings: ReliabilityFinding[];
} {
  const findings: ReliabilityFinding[] = [];
  const wantPreviewVis = opts.previewVisText !== false;
  const htmlPaths = Object.keys(site.files)
    .filter((p) => p.endsWith(".html") && !p.startsWith("prototype/"))
    .sort();

  if (htmlPaths.length === 0) {
    findings.push({
      ok: false,
      code: "no-pages",
      message: "No HTML pages in site tree",
    });
    return { ok: false, findings };
  }

  findings.push(...checkGateStatuses({ gateA: opts.gateA, gateB: opts.gateB }));
  findings.push(...checkAssetPresence(site));

  const available = new Set([
    ...Object.keys(site.files),
    ...Object.keys(site.binaries ?? {}),
  ]);

  let peChecked = false;
  for (const path of htmlPaths) {
    const html = site.files[path]!;
    findings.push(checkPageMinContent(html, path));
    if (wantPreviewVis) {
      findings.push(checkPreviewVisText(html, path));
    }
    if (!peChecked || path === "index.html") {
      findings.push({
        ...checkRevealProgressiveEnhancement(html),
        path,
      });
      findings.push(checkNoJsContentVisible(html, path));
      peChecked = true;
    }
    if (path === "index.html" || path.endsWith("/index.html")) {
      findings.push(checkBrandFallback(html, path));
    }
    // Naming gates on home + a statement page + commentary when present
    if (
      path === "index.html" ||
      path.endsWith("/index.html") ||
      path === "commentary.html" ||
      /financials\/balance-sheet\.html$/i.test(path)
    ) {
      findings.push(...checkLegalCompanyChrome(html, path, opts));
    }
    // P2 — statement IR fidelity on BS/IS/CF/equity pages
    if (isStatementFinancialPage(path)) {
      findings.push(...checkStatementIrFidelity(html, path));
    }
    findings.push(...checkRelativeAssetLinks(html, path, available));
  }

  // Site-wide PE check on chrome CSS embedded in any page is enough; also scan site.js.
  const siteJs = site.files["assets/site.js"];
  if (siteJs) {
    findings.push({
      ok: siteJs.includes("rs-motion") && siteJs.includes("initBrandImages"),
      code: "runtime-brand-init",
      path: "assets/site.js",
      message: siteJs.includes("initBrandImages")
        ? "site.js initializes brand image fallback"
        : "site.js missing brand image fallback init",
    });
  }

  findings.push(...checkRuntimeShareChrome(site));

  // P6 — client delivery pack (offline zip / handoff)
  const wantDelivery =
    opts.deliveryPack === true ||
    (opts.deliveryPack !== false && siteLooksLikeDeliveryPack(site));
  if (wantDelivery) {
    findings.push(...checkDeliveryPack(site));
  }

  const ok = findings.every((f) => f.ok);
  return { ok, findings };
}

/** Format failing findings for throw / CLI exit messages. */
export function formatReliabilityFailures(findings: ReliabilityFinding[]): string {
  return findings
    .filter((f) => !f.ok)
    .map((f) => `${f.code}${f.path ? ` [${f.path}]` : ""}: ${f.message}`)
    .join("\n");
}
