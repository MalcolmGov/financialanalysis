/**
 * P0 / P5 stub — corporate IR reliability smoke against a multipage site tree
 * or zip. CI-friendly: exit 1 on any failure.
 *
 * Usage:
 *   pnpm exec tsx scripts/corporate-reliability-smoke.ts [/tmp/drd-multipage]
 *   pnpm exec tsx scripts/corporate-reliability-smoke.ts /tmp/drd-multipage.zip
 *
 * When no path is given, builds from local DRD fixtures (same as build-multipage-export).
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { DesignDNA, ExtractionResult } from "@rs/contracts";
import { auditCorporateReliability, type SiteFiles } from "@rs/render";
import { buildMultipageExport } from "../lib/build-multipage-export";

async function loadDir(dir: string): Promise<SiteFiles> {
  const files: Record<string, string> = {};
  const binaries: Record<string, Uint8Array> = {};

  async function walk(rel: string): Promise<void> {
    const abs = join(dir, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const ent of entries) {
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name === "_meta" || ent.name === "node_modules") continue;
        await walk(child);
        continue;
      }
      const buf = await fs.readFile(join(dir, child));
      if (/\.(html?|js|mjs|css|json|svg|txt|xml)$/i.test(child)) {
        files[child] = buf.toString("utf8");
      } else {
        binaries[child] = new Uint8Array(buf);
      }
    }
  }

  await walk("");
  return { files, binaries };
}

async function loadZip(zipPath: string): Promise<SiteFiles> {
  const raw = await fs.readFile(zipPath);
  const entries = unzipSync(new Uint8Array(raw));
  const files: Record<string, string> = {};
  const binaries: Record<string, Uint8Array> = {};
  for (const [path, u8] of Object.entries(entries)) {
    if (path.endsWith("/")) continue;
    if (/\.(html?|js|mjs|css|json|svg|txt|xml)$/i.test(path)) {
      files[path] = strFromU8(u8);
    } else {
      binaries[path] = u8;
    }
  }
  return { files, binaries };
}

async function buildFromFixtures(): Promise<SiteFiles> {
  const extraction = JSON.parse(
    await fs.readFile("/tmp/drd-extraction.json", "utf8"),
  ) as ExtractionResult;
  const dna = JSON.parse(await fs.readFile("/tmp/drd-dna.json", "utf8")) as DesignDNA;
  let sourcePdfBytes: Buffer | null = null;
  try {
    sourcePdfBytes = await fs.readFile("/tmp/drd-source.pdf");
  } catch {
    /* optional */
  }
  const built = buildMultipageExport({
    dna,
    extraction,
    projectId: extraction.project_id || "offline",
    company: "DRDGOLD Limited",
    periodLabel: "HY1 FY2026 — six months ended 31 December 2025",
    sourcePdfBytes,
  });
  return { files: built.files, binaries: built.binaries };
}

async function main() {
  const target = process.argv[2];
  let site: SiteFiles;
  let label: string;

  if (!target) {
    label = "fixture-build";
    site = await buildFromFixtures();
  } else if (target.endsWith(".zip")) {
    label = target;
    site = await loadZip(target);
  } else {
    label = target;
    site = await loadDir(target);
  }

  const htmlPages = Object.keys(site.files)
    .filter((p) => p.endsWith(".html") && !p.startsWith("prototype/"))
    .sort();

  process.stdout.write(`Corporate reliability smoke · ${label}\n`);
  process.stdout.write(`Pages: ${htmlPages.length}\n`);

  const { ok, findings } = auditCorporateReliability(site);
  let failed = 0;
  for (const f of findings) {
    const mark = f.ok ? "✓" : "✗";
    if (!f.ok) failed += 1;
    const loc = f.path ? ` [${f.path}]` : "";
    process.stdout.write(`${mark} ${f.code}${loc}: ${f.message}\n`);
  }

  process.stdout.write(
    `\n${ok ? "PASS" : "FAIL"} — ${findings.length - failed}/${findings.length} checks · ${htmlPages.length} pages\n`,
  );
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
