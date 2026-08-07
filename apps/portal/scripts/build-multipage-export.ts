/**
 * Offline multipage export from a local extraction (+ optional DNA) JSON.
 *
 *   pnpm --filter portal exec tsx scripts/build-multipage-export.ts \
 *     /tmp/drd-extraction.json [/tmp/drd-dna.json] [/tmp/drd-multipage]
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { DesignDNA, ExtractionResult } from "@rs/contracts";
import { buildMultipageExport } from "../lib/build-multipage-export";

async function main() {
  const extractionPath = process.argv[2] ?? "/tmp/drd-extraction.json";
  const dnaPath = process.argv[3] ?? "/tmp/drd-dna.json";
  const outDir = process.argv[4] ?? "/tmp/drd-multipage";

  const extraction = JSON.parse(await fs.readFile(extractionPath, "utf8")) as ExtractionResult;
  const dna = JSON.parse(await fs.readFile(dnaPath, "utf8")) as DesignDNA;

  const built = buildMultipageExport({
    dna,
    extraction,
    projectId: extraction.project_id || "offline",
    company: "DRDGOLD Limited",
    periodLabel: "HY1 FY2026 — six months ended 31 December 2025",
  });

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  for (const path of built.paths) {
    const dest = join(outDir, path);
    await fs.mkdir(join(dest, ".."), { recursive: true });
    await fs.writeFile(dest, built.files[path]!);
  }

  const zipInput: Record<string, Uint8Array> = {};
  for (const path of built.paths) zipInput[path] = strToU8(built.files[path]!);
  const zipPath = `${outDir}.zip`;
  await fs.writeFile(zipPath, zipSync(zipInput, { level: 6 }));

  const htmlPaths = built.paths.filter((p) => p.endsWith(".html"));
  process.stdout.write(`Wrote ${built.paths.length} files → ${outDir}\n`);
  process.stdout.write(`Zip → ${zipPath}\n`);
  process.stdout.write(`HTML pages:\n${htmlPaths.map((p) => `  - ${p}`).join("\n")}\n`);

  const income = built.files["financials/income-statement.html"] ?? "";
  const checks = [
    ["index.html", !!built.files["index.html"]],
    ["commentary.html", !!built.files["commentary.html"]],
    ["income-statement", income.includes("5 053.2") || income.includes("fin-table")],
    ["site-nav", income.includes("site-nav")],
    ["cur shading", income.includes("data-cur-col") || income.includes('class="cur')],
    ["notes", !!built.files["financials/notes.html"]],
    ["downloads", !!built.files["downloads.html"]],
  ] as const;
  for (const [name, ok] of checks) {
    process.stdout.write(`${ok ? "✓" : "✗"} ${name}\n`);
  }
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
