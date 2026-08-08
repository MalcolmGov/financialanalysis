/**
 * P5 — authenticated preview-path vis_text CI.
 *
 * Fetches every multipage draft page through the same `/api/blob/...` URL the
 * console iframe uses, measures visible text (not raw HTML bytes), and checks
 * critical assets return 200. Would have failed the blank-home crisis when
 * pages looked full on disk but empty in preview.
 *
 * Usage:
 *   PORTAL_URL=https://portal-production-518a.up.railway.app \
 *   PORTAL_EMAIL=… PORTAL_PASSWORD=… \
 *     pnpm exec tsx scripts/preview-vis-text-smoke.ts [projectId]
 *
 * Defaults: DRD Gold 1 project + env credentials when set.
 *
 * Offline alternative (no portal session): use smoke:corporate-reliability on a
 * local tree/zip — same vis_text floors without the authenticated path.
 */
import {
  auditCorporateReliability,
  checkPreviewVisText,
  visibleTextBytes,
  type SiteFiles,
} from "@rs/render";

const PROJECT_ID = process.argv[2] ?? "444cd443-97cc-4b9c-b0f6-eef4f65c2f98";
const PORTAL_URL = (process.env.PORTAL_URL ?? "https://portal-production-518a.up.railway.app").replace(
  /\/$/,
  "",
);
const EMAIL = process.env.PORTAL_EMAIL ?? process.env.OPERATOR_EMAIL ?? "";
const PASSWORD = process.env.PORTAL_PASSWORD ?? process.env.OPERATOR_PASSWORD ?? "";

const REQUIRED_ASSETS = [
  "assets/site.js",
  "assets/fonts/open-sans-latin-400-normal.woff2",
] as const;

type CookieJar = Map<string, string>;

function parseSetCookie(header: string | null, jar: CookieJar): void {
  if (!header) return;
  // undici may join multiple Set-Cookie with comma — split carefully on ", <name>="
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
    throw new Error(
      "PORTAL_EMAIL and PORTAL_PASSWORD (or OPERATOR_*) required for preview-path smoke",
    );
  }

  const csrfRes = await portalFetch("/api/auth/csrf", jar);
  if (!csrfRes.ok) throw new Error(`csrf ${csrfRes.status}`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfToken) throw new Error("no csrfToken from /api/auth/csrf");

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

  // Auth.js returns 200 JSON or 302 on success depending on version/json flag.
  if (loginRes.status >= 400) {
    const text = await loginRes.text().catch(() => "");
    throw new Error(`sign-in failed ${loginRes.status}: ${text.slice(0, 200)}`);
  }

  const sessionRes = await portalFetch("/api/auth/session", jar);
  const session = (await sessionRes.json().catch(() => null)) as { user?: { email?: string } } | null;
  if (!session?.user?.email) {
    throw new Error("sign-in produced no session — check credentials / OPERATOR_EMAILS allowlist");
  }
  process.stdout.write(`Signed in as ${session.user.email}\n`);
}

function toApiBlobPath(previewUrl: string): string {
  // previewUrl is `/api/blob/runs/.../index.html` (may include ?v=)
  const u = previewUrl.startsWith("http") ? new URL(previewUrl) : new URL(previewUrl, PORTAL_URL);
  return `${u.pathname}${u.search}`;
}

async function main() {
  const jar: CookieJar = new Map();
  process.stdout.write(`P5 preview vis_text smoke · ${PORTAL_URL}\n`);
  process.stdout.write(`Project: ${PROJECT_ID}\n`);

  await signIn(jar);

  const siteRes = await portalFetch(`/api/projects/${PROJECT_ID}/site`, jar);
  if (!siteRes.ok) {
    throw new Error(`GET /api/projects/${PROJECT_ID}/site → ${siteRes.status}`);
  }
  const site = (await siteRes.json()) as {
    version?: number;
    prefix?: string;
    gateA?: string | null;
    gateB?: string | null;
    pages?: Array<{ path: string; title: string; previewUrl: string }>;
  };

  const pages = site.pages ?? [];
  if (!pages.length) throw new Error("site draft has no pages");
  process.stdout.write(
    `Draft v${site.version ?? "?"} · prefix=${site.prefix ?? "?"} · Gate A=${site.gateA ?? "—"} · Gate B=${site.gateB ?? "—"} · ${pages.length} pages\n`,
  );

  const files: Record<string, string> = {};
  const binaries: Record<string, Uint8Array> = {};
  let failed = 0;

  for (const page of pages) {
    const apiPath = toApiBlobPath(page.previewUrl);
    const res = await portalFetch(apiPath, jar);
    const buf = Buffer.from(await res.arrayBuffer());
    const html = buf.toString("utf8");
    if (!res.ok) {
      process.stdout.write(`✗ preview-http [${page.path}]: HTTP ${res.status}\n`);
      failed += 1;
      continue;
    }
    files[page.path] = html;
    const vis = visibleTextBytes(html);
    const check = checkPreviewVisText(html, page.path);
    process.stdout.write(
      `${check.ok ? "✓" : "✗"} preview-vis-text [${page.path}]: HTTP ${res.status} bytes=${buf.length} vis_text=${vis}B\n`,
    );
    if (!check.ok) failed += 1;
  }

  const blobApiPath = (rel: string): string => {
    const prefix = site.prefix;
    if (!prefix) throw new Error("site draft missing prefix");
    return `/api/blob/${[...prefix.split("/"), ...rel.split("/")]
      .map((s) => encodeURIComponent(s))
      .join("/")}`;
  };

  const fetchAsset = async (rel: string): Promise<boolean> => {
    const res = await portalFetch(blobApiPath(rel), jar);
    const body = new Uint8Array(await res.arrayBuffer());
    const ok = res.ok && body.byteLength > 32;
    if (ok) {
      if (/\.(js|mjs|css|svg|json|html?)$/i.test(rel)) {
        files[rel] = Buffer.from(body).toString("utf8");
      } else {
        binaries[rel] = body;
      }
    }
    process.stdout.write(
      `${ok ? "✓" : "✗"} preview-asset-200 [${rel}]: HTTP ${res.status} bytes=${body.byteLength}\n`,
    );
    return ok;
  };

  // Asset 200s via the same authenticated preview path (iframe subresources).
  if (site.prefix) {
    for (const asset of REQUIRED_ASSETS) {
      if (!(await fetchAsset(asset))) failed += 1;
    }
    const home = files["index.html"] ?? "";
    const brandRefs = [
      ...home.matchAll(/(?:src|href)="((?:\.\.\/)*assets\/brand\/[^"]+)"/g),
    ].map((m) => m[1]!.replace(/^(?:\.\.\/)+/, ""));
    for (const rel of new Set(brandRefs)) {
      if (!(await fetchAsset(rel))) failed += 1;
    }
  }

  const siteFiles: SiteFiles = { files, binaries };
  const audit = auditCorporateReliability(siteFiles, {
    expectedLegalName: "DRDGOLD",
    forbiddenProjectTitles: ["DRD Gold 1"],
    gateA: site.gateA ? { status: site.gateA } : undefined,
    gateB: site.gateB ? { status: site.gateB } : undefined,
  });

  process.stdout.write("\nCorporate reliability rollup (from preview-fetched bytes):\n");
  for (const f of audit.findings) {
    if (!f.ok) failed += 1;
    process.stdout.write(
      `${f.ok ? "✓" : "✗"} ${f.code}${f.path ? ` [${f.path}]` : ""}: ${f.message}\n`,
    );
  }

  const ok = failed === 0 && audit.ok;
  process.stdout.write(
    `\n${ok ? "PASS" : "FAIL"} — preview vis_text CI · ${pages.length} pages · draft v${site.version ?? "?"}\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
