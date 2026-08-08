/**
 * P5 — corporate IR readiness smoke against a multipage site tree or zip.
 * CI-friendly: exit 1 on any failure.
 *
 * Covers: preview vis_text floors, PE/opacity guard, iframe blank-risk,
 * assets, brand fallback, legal name / slug, statement IR fidelity,
 * runtime share chrome, and Gate A/B when building from fixtures.
 *
 * Usage:
 *   pnpm smoke:corporate-reliability
 *   pnpm smoke:corporate-reliability /tmp/drd-multipage
 *   pnpm smoke:corporate-reliability /tmp/drd-multipage.zip
 *   pnpm smoke:corporate-reliability --expect=DRDGOLD --forbid=DRD Gold 1 /tmp/drd-multipage
 *
 * Live authenticated iframe path (portal session):
 *   pnpm smoke:preview-vis-text
 *
 * When no path is given, builds from local DRD fixtures (same as build-multipage-export).
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { DesignDNA, ExtractionResult } from "@rs/contracts";
import {
  auditCorporateReliability,
  resolveLegalCompanyName,
  type SiteFiles,
} from "@rs/render";
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

async function buildFromFixtures(): Promise<{
  site: SiteFiles;
  expectedLegalName: string;
  forbiddenProjectTitles: string[];
  gateA: { status: string };
  gateB: { status: string };
  reliabilityOk: boolean;
}> {
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
  // Pass portal project slug on purpose — P1 must resolve to legal issuer.
  const built = buildMultipageExport({
    dna,
    extraction,
    projectId: extraction.project_id || "offline",
    company: "DRD Gold 1",
    periodLabel: "HY1 FY2026 — six months ended 31 December 2025",
    sourcePdfBytes,
  });
  const legal = resolveLegalCompanyName({
    extraction,
    dna,
    projectCompanyName: "DRD Gold 1",
  });
  process.stdout.write(
    `Resolved company: “${built.company}” (${built.companySource}); precheck “${legal.company}”\n`,
  );
  process.stdout.write(
    `Gate A: ${built.gateA.status} · Gate B: ${built.gateB.status} · reliability: ${built.reliability.ok ? "pass" : "fail"}\n`,
  );
  return {
    site: { files: built.files, binaries: built.binaries },
    expectedLegalName: built.company,
    forbiddenProjectTitles: ["DRD Gold 1"],
    gateA: { status: built.gateA.status },
    gateB: { status: built.gateB.status },
    reliabilityOk: built.reliability.ok,
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const target = args[0];
  let site: SiteFiles;
  let label: string;
  let expectedLegalName: string | undefined;
  let forbiddenProjectTitles: string[] | undefined;
  let gateA: { status: string } | undefined;
  let gateB: { status: string } | undefined;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--expect=")) expectedLegalName = arg.slice("--expect=".length);
    if (arg.startsWith("--forbid=")) {
      forbiddenProjectTitles = (forbiddenProjectTitles ?? []).concat(arg.slice("--forbid=".length));
    }
  }

  if (!target || target.startsWith("--")) {
    label = "fixture-build";
    const built = await buildFromFixtures();
    site = built.site;
    expectedLegalName = expectedLegalName ?? built.expectedLegalName;
    forbiddenProjectTitles = forbiddenProjectTitles ?? built.forbiddenProjectTitles;
    gateA = built.gateA;
    gateB = built.gateB;
  } else if (target.endsWith(".zip")) {
    label = target;
    site = await loadZip(target);
    if (!expectedLegalName && !forbiddenProjectTitles) {
      forbiddenProjectTitles = ["DRD Gold 1"];
      expectedLegalName = "DRDGOLD";
    }
  } else {
    label = target;
    site = await loadDir(target);
    if (!expectedLegalName && !forbiddenProjectTitles) {
      forbiddenProjectTitles = ["DRD Gold 1"];
      expectedLegalName = "DRDGOLD";
    }
  }

  const htmlPages = Object.keys(site.files)
    .filter((p) => p.endsWith(".html") && !p.startsWith("prototype/"))
    .sort();

  process.stdout.write(`P5 corporate readiness smoke · ${label}\n`);
  process.stdout.write(`Pages: ${htmlPages.length}\n`);
  if (expectedLegalName) process.stdout.write(`Expect legal name: ${expectedLegalName}\n`);
  if (forbiddenProjectTitles?.length) {
    process.stdout.write(`Forbid in chrome: ${forbiddenProjectTitles.join(" | ")}\n`);
  }

  const { ok, findings } = auditCorporateReliability(site, {
    expectedLegalName,
    forbiddenProjectTitles,
    gateA,
    gateB,
  });
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
