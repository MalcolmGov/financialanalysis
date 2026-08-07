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
  process.stdout.write(`Entrypoint: ${built.entrypoint}\n`);
  process.stdout.write(`Gate A: ${built.gateA.status} · Gate B: ${built.gateB.status}\n`);
  process.stdout.write(`HTML pages:\n${built.pages.map((p) => `  - ${p.path} (${p.title})`).join("\n")}\n`);
  if (htmlPaths.some((p) => p.startsWith("prototype/"))) {
    process.stdout.write("Note: prototype/ present (optional preview only)\n");
  }

  const income = built.files["financials/income-statement.html"] ?? "";
  const checks = [
    ["index.html", !!built.files["index.html"]],
    ["commentary.html", !!built.files["commentary.html"]],
    ["income-statement", income.includes("5 053.2") || income.includes("fin-table")],
    ["site-nav", income.includes("site-nav")],
    ["cur shading", income.includes("data-cur-col") || income.includes('class="cur')],
    ["notes", !!built.files["financials/notes.html"]],
    ["downloads", !!built.files["downloads.html"]],
    ["no prototype entrypoint", !built.files["prototype/index.html"] || built.entrypoint === "index.html"],
    ["gate A", built.gateA.status === "pass"],
    ["gate B", built.gateB.status === "pass"],
  ] as const;
  for (const [name, ok] of checks) {
    process.stdout.write(`${ok ? "✓" : "✗"} ${name}\n`);
  }
  if (checks.some(([, ok]) => !ok)) {
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
