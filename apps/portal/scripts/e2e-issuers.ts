/**
 * Authenticated production E2E for DRD / Spar / MTN.
 *
 *   PORTAL_URL=… PORTAL_EMAIL=… PORTAL_PASSWORD=… \
 *     pnpm exec tsx scripts/e2e-issuers.ts
 */
import {
  auditCorporateReliability,
  checkPreviewVisText,
  visibleTextBytes,
  type SiteFiles,
} from "@rs/render";

const PORTAL_URL = (process.env.PORTAL_URL ?? "https://portal-production-518a.up.railway.app").replace(
  /\/$/,
  "",
);
const EMAIL = process.env.PORTAL_EMAIL ?? process.env.OPERATOR_EMAIL ?? "";
const PASSWORD = process.env.PORTAL_PASSWORD ?? process.env.OPERATOR_PASSWORD ?? "";

type IssuerSpec = {
  label: string;
  projectId: string;
  expectDraft?: number;
  expectTheme: "classic" | "editorial" | "statutory";
  expectLegalName: string;
  forbidTitles: string[];
  minPages: number;
  maxPages?: number;
  navHints: RegExp[];
  expectGroupCompany?: boolean;
  expectNoteGroups?: boolean;
  expectBrandContrast?: boolean;
};

const ISSUERS: IssuerSpec[] = [
  {
    label: "DRD",
    projectId: "444cd443-97cc-4b9c-b0f6-eef4f65c2f98",
    expectDraft: 44,
    expectTheme: "classic",
    expectLegalName: "DRDGOLD",
    forbidTitles: ["DRD Gold 1"],
    minPages: 9,
    maxPages: 12,
    navHints: [/commentary\.html/i, /financials\/income-statement\.html/i, /financials\/notes\.html/i],
  },
  {
    label: "Spar",
    projectId: "7947eb5f-d836-43b4-8779-8bfdcf164471",
    expectDraft: 33,
    expectTheme: "statutory",
    expectLegalName: "SPAR",
    forbidTitles: [],
    minPages: 14,
    navHints: [
      /directors-report\.html/i,
      /auditors-report\.html/i,
      /accounting-policies\.html/i,
      /financials\/notes/i,
    ],
    expectNoteGroups: true,
  },
  {
    label: "MTN",
    projectId: "8ed9620c-804d-4370-882d-8df8c1243f0c",
    expectDraft: 10,
    expectTheme: "statutory",
    expectLegalName: "MTN",
    forbidTitles: ["Group financial statements"],
    minPages: 18,
    navHints: [
      /directors-report\.html/i,
      /auditors-report\.html/i,
      /financials\/group\//i,
      /financials\/company\//i,
    ],
    expectGroupCompany: true,
    expectNoteGroups: true,
    expectBrandContrast: true,
  },
];

const REQUIRED_ASSETS = [
  "assets/site.js",
  "assets/fonts/open-sans-latin-400-normal.woff2",
] as const;

type CookieJar = Map<string, string>;

function parseSetCookie(header: string | null, jar: CookieJar): void {
  if (!header) return;
  const parts = header.split(/,(?=\s*[^;=]+=)/);
  for (const part of parts) {
    const nv = part.split(";")[0]?.trim();
    if (!nv) continue;
    const eq = nv.indexOf("=");
    if (eq <= 0) continue;
    jar.set(nv.slice(0, eq), nv.slice(eq + 1));
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function portalFetch(
  path: string,
  jar: CookieJar,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookies = cookieHeader(jar);
  if (cookies) headers.set("cookie", cookies);
  const res = await fetch(`${PORTAL_URL}${path}`, { ...init, headers, redirect: "manual" });
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) {
    for (const c of getSetCookie) parseSetCookie(c, jar);
  } else {
    parseSetCookie(res.headers.get("set-cookie"), jar);
  }
  return res;
}

async function signIn(jar: CookieJar): Promise<void> {
  if (!EMAIL || !PASSWORD) {
    throw new Error("PORTAL_EMAIL and PORTAL_PASSWORD required");
  }
  const csrfRes = await portalFetch("/api/auth/csrf", jar);
  if (!csrfRes.ok) throw new Error(`csrf ${csrfRes.status}`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfToken) throw new Error("no csrfToken");

  const body = new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password: PASSWORD,
    callbackUrl: `${PORTAL_URL}/`,
    json: "true",
  });
  const loginRes = await portalFetch("/api/auth/callback/credentials", jar, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (loginRes.status >= 400) {
    throw new Error(`sign-in failed ${loginRes.status}`);
  }
  const session = (await (await portalFetch("/api/auth/session", jar)).json()) as {
    user?: { email?: string };
  } | null;
  if (!session?.user?.email) throw new Error("no session");
  process.stdout.write(`Signed in as ${session.user.email}\n`);
}

function toApiBlobPath(previewUrl: string): string {
  const u = previewUrl.startsWith("http")
    ? new URL(previewUrl)
    : new URL(previewUrl, PORTAL_URL);
  return `${u.pathname}${u.search}`;
}

type Check = { ok: boolean; code: string; message: string };

function check(ok: boolean, code: string, message: string): Check {
  return { ok, code, message };
}

async function runIssuer(jar: CookieJar, spec: IssuerSpec): Promise<{ pass: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  const fail = (code: string, message: string) => {
    checks.push(check(false, code, message));
  };
  const pass = (code: string, message: string) => {
    checks.push(check(true, code, message));
  };

  process.stdout.write(`\n═══ ${spec.label} (${spec.projectId}) ═══\n`);

  const siteRes = await portalFetch(`/api/projects/${spec.projectId}/site`, jar);
  if (!siteRes.ok) {
    fail("site-meta", `GET /site → ${siteRes.status}`);
    return { pass: false, checks };
  }
  const site = (await siteRes.json()) as {
    version?: number;
    prefix?: string;
    gateA?: string | null;
    gateB?: string | null;
    corporateReliability?: string | null;
    company?: string | null;
    brandLogo?: boolean | null;
    brandBanner?: boolean | null;
    pages?: Array<{ path: string; title: string; previewUrl: string }>;
  };

  const dnaRes = await portalFetch(`/api/projects/${spec.projectId}/dna`, jar);
  const dna = dnaRes.ok
    ? ((await dnaRes.json()) as { themeId?: string; suggestedThemeId?: string })
    : {};

  const signRes = await portalFetch(`/api/projects/${spec.projectId}/publish-signoff`, jar);
  const signoff = signRes.ok
    ? ((await signRes.json()) as {
        checklist?: Array<{ id: string; status: string; label?: string; detail?: string }>;
        canSignOff?: boolean;
        blockers?: string[];
      })
    : {};

  const pages = site.pages ?? [];
  const paths = pages.map((p) => p.path);

  // 1. Site draft meta
  if (site.gateA === "pass") pass("gate-a", `Gate A=${site.gateA}`);
  else fail("gate-a", `Gate A=${site.gateA ?? "—"}`);
  if (site.gateB === "pass") pass("gate-b", `Gate B=${site.gateB}`);
  else fail("gate-b", `Gate B=${site.gateB ?? "—"}`);
  if (site.corporateReliability === "pass") {
    pass("corporate-reliability", `corporateReliability=${site.corporateReliability}`);
  } else {
    fail("corporate-reliability", `corporateReliability=${site.corporateReliability ?? "—"}`);
  }
  if (spec.expectDraft != null && site.version === spec.expectDraft) {
    pass("draft-version", `draft v${site.version}`);
  } else if (spec.expectDraft != null) {
    fail("draft-version", `expected v${spec.expectDraft}, got v${site.version}`);
  } else {
    pass("draft-version", `draft v${site.version}`);
  }
  const themeId = dna.themeId ?? "—";
  if (themeId === spec.expectTheme) pass("theme-id", `theme_id=${themeId}`);
  else fail("theme-id", `expected theme ${spec.expectTheme}, got ${themeId}`);
  if (pages.length >= spec.minPages && (spec.maxPages == null || pages.length <= spec.maxPages)) {
    pass("page-count", `${pages.length} pages (min ${spec.minPages})`);
  } else {
    fail(
      "page-count",
      `${pages.length} pages (expected ≥${spec.minPages}${spec.maxPages != null ? ` ≤${spec.maxPages}` : ""})`,
    );
  }
  process.stdout.write(
    `Meta: v${site.version} · Gate A=${site.gateA} · Gate B=${site.gateB} · reliability=${site.corporateReliability} · theme=${themeId} · pages=${pages.length} · company=${site.company}\n`,
  );

  // 2–3. Pages + assets
  const files: Record<string, string> = {};
  const binaries: Record<string, Uint8Array> = {};

  for (const page of pages) {
    const res = await portalFetch(toApiBlobPath(page.previewUrl), jar);
    const buf = Buffer.from(await res.arrayBuffer());
    const html = buf.toString("utf8");
    if (!res.ok) {
      fail(`page-http:${page.path}`, `HTTP ${res.status}`);
      continue;
    }
    files[page.path] = html;
    const vis = visibleTextBytes(html);
    const vt = checkPreviewVisText(html, page.path);
    if (vt.ok) pass(`preview-vis-text:${page.path}`, `vis_text=${vis}B`);
    else fail(`preview-vis-text:${page.path}`, `vis_text=${vis}B — ${vt.message ?? "below floor"}`);

    // Blank commentary placeholder
    if (
      /commentary\.html$/i.test(page.path) &&
      /Commentary will appear when the extraction includes a shareholder letter/i.test(html)
    ) {
      fail(`blank-commentary:${page.path}`, "empty shareholder-letter placeholder");
    }

    // Theme attribute on html
    if (/index\.html$/i.test(page.path)) {
      const m = html.match(/data-theme="([^"]+)"/);
      const htmlTheme = m?.[1] ?? "—";
      if (htmlTheme === spec.expectTheme) {
        pass("html-data-theme", `index data-theme=${htmlTheme}`);
      } else {
        fail("html-data-theme", `index data-theme=${htmlTheme}, expected ${spec.expectTheme}`);
      }
    }

    // MTN yellow: masthead/shading must not be raw high-luminance yellow as text bg
    if (spec.expectBrandContrast && /index\.html$/i.test(page.path)) {
      const yellowOnMasthead = /--dna-(?:masthead|shading|header)\s*:\s*#(?:ffcb04|FFCB05|ffcc00)/i.test(
        html,
      );
      const remapped =
        /--dna-masthead:\s*#(?!ffcb04|FFCB05|ffcc00)/i.test(html) ||
        /--dna-brand-text:\s*#(?:0|1|2)/i.test(html) ||
        /--rs-on-brand:\s*#(?:0|1|2)/i.test(html) ||
        /color:\s*#(?:0[0-9a-f]{5}|1[0-9a-f]{5}|2[0-3][0-9a-f]{4})/i.test(html);
      if (!yellowOnMasthead || remapped) {
        pass(
          "brand-contrast-html",
          yellowOnMasthead
            ? "raw yellow present but dark ink / remap also present"
            : "masthead not raw MTN yellow",
        );
      } else {
        fail("brand-contrast-html", "MTN yellow may be raw on masthead/text");
      }
    }
  }

  const blobApiPath = (rel: string): string => {
    const prefix = site.prefix;
    if (!prefix) throw new Error("missing prefix");
    return `/api/blob/${[...prefix.split("/"), ...rel.split("/")]
      .map((s) => encodeURIComponent(s))
      .join("/")}`;
  };

  if (site.prefix) {
    const assetRefs = new Set<string>(REQUIRED_ASSETS);
    for (const html of Object.values(files)) {
      for (const m of html.matchAll(/(?:src|href)="((?:\.\.\/)*assets\/[^"#?]+)"/gi)) {
        assetRefs.add(m[1]!.replace(/^(?:\.\.\/)+/, "").replace(/^\.\//, ""));
      }
    }
    for (const rel of [...assetRefs].sort()) {
      const res = await portalFetch(blobApiPath(rel), jar);
      const body = new Uint8Array(await res.arrayBuffer());
      const ok = res.ok && body.byteLength > 32;
      if (ok) {
        if (/\.(js|mjs|css|svg|json|html?)$/i.test(rel)) {
          files[rel] = Buffer.from(body).toString("utf8");
        } else {
          binaries[rel] = body;
        }
        pass(`asset:${rel}`, `HTTP ${res.status} bytes=${body.byteLength}`);
      } else {
        fail(`asset:${rel}`, `HTTP ${res.status} bytes=${body.byteLength}`);
      }
    }
    for (const rel of ["README.md", "_meta/export.json"] as const) {
      const res = await portalFetch(blobApiPath(rel), jar);
      if (res.ok) {
        files[rel] = Buffer.from(await res.arrayBuffer()).toString("utf8");
        pass(`sidecar:${rel}`, "present");
      } else {
        fail(`sidecar:${rel}`, `HTTP ${res.status}`);
      }
    }
  }

  // 4. Nav / sitemap hints
  for (const re of spec.navHints) {
    const hit = paths.some((p) => re.test(p));
    if (hit) pass(`nav:${re}`, "present");
    else fail(`nav:${re}`, `missing path matching ${re}`);
  }
  if (spec.expectNoteGroups) {
    const groups = paths.filter((p) =>
      /financials\/(?:(?:group|company)\/)?notes-(?:\d+(?:-\d+)?|part-\d+)\.html$/i.test(p),
    );
    if (groups.length >= 1) pass("note-groups", `${groups.length} note group page(s)`);
    else fail("note-groups", "expected note group pages");
  }
  if (spec.expectGroupCompany) {
    const g = paths.some((p) => /financials\/group\//i.test(p));
    const c = paths.some((p) => /financials\/company\//i.test(p));
    if (g && c) pass("group-company-books", "Group· + Company· present");
    else fail("group-company-books", `group=${g} company=${c}`);
  }

  // Nav labels from home
  const home = files["index.html"] ?? "";
  const navLinks = [...home.matchAll(/href="([^"]+\.html)"/gi)].map((m) => m[1]!);
  process.stdout.write(`Nav sample (${navLinks.length} hrefs on home): ${navLinks.slice(0, 12).join(" | ")}\n`);
  process.stdout.write(`Pages: ${paths.join(", ")}\n`);

  // 5–6. Publish checklist
  const checklist = signoff.checklist ?? [];
  if (checklist.length === 0) {
    fail("publish-checklist", `GET publish-signoff → ${signRes.status}; no checklist`);
  } else {
    const criticalFails = checklist.filter((i) => i.status === "fail");
    for (const item of checklist) {
      const mark = item.status === "fail" ? "fail" : "pass";
      if (item.status === "fail") {
        fail(`checklist:${item.id}`, `${item.label ?? item.id}: ${item.detail ?? item.status}`);
      } else {
        pass(`checklist:${item.id}`, `${item.status}${item.detail ? ` — ${item.detail}` : ""}`);
      }
      void mark;
    }
    if (spec.expectBrandContrast) {
      const bc = checklist.find((i) => i.id === "brand_contrast" || /contrast/i.test(i.id));
      if (!bc) fail("brand_contrast", "checklist missing brand_contrast");
      else if (bc.status === "fail") fail("brand_contrast", bc.detail ?? "fail");
      else pass("brand_contrast", `${bc.status}`);
    }
    if (criticalFails.length === 0) pass("checklist-critical", "no fail items");
    else fail("checklist-critical", `${criticalFails.length} fail item(s)`);
  }

  // Corporate reliability from fetched bytes
  const siteFiles: SiteFiles = { files, binaries };
  const audit = auditCorporateReliability(siteFiles, {
    expectedLegalName: spec.expectLegalName,
    forbiddenProjectTitles: spec.forbidTitles.length ? spec.forbidTitles : undefined,
    gateA: site.gateA ? { status: site.gateA } : undefined,
    gateB: site.gateB ? { status: site.gateB } : undefined,
  });
  for (const f of audit.findings) {
    if (f.ok) pass(`reliability:${f.code}${f.path ? `:${f.path}` : ""}`, f.message);
    else fail(`reliability:${f.code}${f.path ? `:${f.path}` : ""}`, f.message);
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    if (!c.ok) process.stdout.write(`✗ ${c.code}: ${c.message}\n`);
  }
  process.stdout.write(
    `${failed.length === 0 ? "PASS" : "FAIL"} — ${spec.label} · ${checks.length - failed.length}/${checks.length} checks · draft v${site.version}\n`,
  );
  return { pass: failed.length === 0, checks };
}

async function main() {
  const jar: CookieJar = new Map();
  process.stdout.write(`E2E issuers · ${PORTAL_URL}\n`);
  await signIn(jar);

  const results: Array<{ label: string; pass: boolean; fails: Check[] }> = [];
  for (const spec of ISSUERS) {
    const r = await runIssuer(jar, spec);
    results.push({
      label: spec.label,
      pass: r.pass,
      fails: r.checks.filter((c) => !c.ok),
    });
  }

  process.stdout.write("\n════════ SUMMARY ════════\n");
  for (const r of results) {
    process.stdout.write(
      `${r.pass ? "PASS" : "FAIL"} ${r.label}${r.fails.length ? ` (${r.fails.length} failures)` : ""}\n`,
    );
    for (const f of r.fails.slice(0, 30)) {
      process.stdout.write(`  - ${f.code}: ${f.message}\n`);
    }
  }
  if (results.some((r) => !r.pass)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
