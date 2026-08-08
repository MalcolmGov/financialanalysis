/**
 * One-shot: pull a site-draft prefix from private blob and run corporate
 * reliability audit. Not a CI entrypoint — use corporate-reliability-smoke.ts.
 */
import { getPrivate } from "../lib/blob";
import { auditCorporateReliability, visibleTextBytes } from "@rs/render";

const prefix =
  process.argv[2] ?? "runs/a1483bb1-d4a0-4ab1-9eb8-0d368d9e7fa8/site-draft/v6";

const pages = [
  "index.html",
  "commentary.html",
  "administration.html",
  "downloads.html",
  "financials/income-statement.html",
  "financials/balance-sheet.html",
  "financials/changes-in-equity.html",
  "financials/cash-flows.html",
  "financials/notes.html",
  "statements/index.html",
];

async function main() {
  const files: Record<string, string> = {};
  const binaries: Record<string, Uint8Array> = {};

  for (const p of pages) {
    const buf = await getPrivate(`${prefix}/${p}`);
    const html = buf.toString("utf8");
    files[p] = html;
    const reveals = (html.match(/\breveal\b/g) || []).length;
    console.log(
      `PAGE ${p} bytes=${buf.length} vis=${visibleTextBytes(html)} rs-motion=${html.includes("html.rs-motion")} onerror=${html.includes("onerror=")} reveal~=${reveals}`,
    );
  }

  const must = ["assets/site.js", "assets/fonts/open-sans-latin-400-normal.woff2"];
  for (const a of must) {
    const buf = await getPrivate(`${prefix}/${a}`);
    if (a.endsWith(".js")) files[a] = buf.toString("utf8");
    else binaries[a] = new Uint8Array(buf);
    console.log(`ASSET 200 ${a} bytes=${buf.length}`);
  }

  const home = files["index.html"]!;
  const brandRefs = [
    ...home.matchAll(/(?:src|href)="((?:\.\.\/)*assets\/brand\/[^"]+)"/g),
  ].map((m) => m[1]!.replace(/^(?:\.\.\/)+/, ""));
  console.log("brand refs", brandRefs);
  for (const rel of new Set(brandRefs)) {
    try {
      const buf = await getPrivate(`${prefix}/${rel}`);
      binaries[rel] = new Uint8Array(buf);
      console.log(`ASSET 200 ${rel} bytes=${buf.length}`);
    } catch {
      console.log(`ASSET FAIL ${rel}`);
    }
  }

  // Collect font + other asset hrefs from all pages
  for (const [path, html] of Object.entries(files)) {
    const refs = [
      ...html.matchAll(/(?:src|href)="((?:\.\.\/)*assets\/[^"]+)"/g),
    ].map((m) => m[1]!.replace(/^(?:\.\.\/)+/, ""));
    for (const rel of refs) {
      if (files[rel] || binaries[rel]) continue;
      if (rel.endsWith(".html")) continue;
      try {
        const buf = await getPrivate(`${prefix}/${rel}`);
        if (/\.(js|css|svg|json)$/i.test(rel)) files[rel] = buf.toString("utf8");
        else binaries[rel] = new Uint8Array(buf);
        console.log(`ASSET 200 ${rel} bytes=${buf.length} (from ${path})`);
      } catch {
        console.log(`ASSET FAIL ${rel} (from ${path})`);
      }
    }
  }

  const audit = auditCorporateReliability({ files, binaries });
  for (const f of audit.findings) {
    console.log(
      `${f.ok ? "✓" : "✗"} ${f.code}${f.path ? ` [${f.path}]` : ""}: ${f.message}`,
    );
  }
  console.log(audit.ok ? "\nAUDIT PASS" : "\nAUDIT FAIL");
  console.log(
    JSON.stringify(
      {
        prefix,
        pages: pages.length,
        brandLogo: brandRefs.some((r) => /logo/i.test(r)),
        brandBanner: brandRefs.some((r) => /banner|photo|strip/i.test(r)),
        ok: audit.ok,
      },
      null,
      2,
    ),
  );
  process.exit(audit.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
