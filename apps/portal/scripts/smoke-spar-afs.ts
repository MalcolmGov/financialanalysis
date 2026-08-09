/**
 * Offline Spar AFS structure smoke (commentary + IA + dual-entity tables).
 *
 *   pnpm exec tsx scripts/smoke-spar-afs.ts [/tmp/spar_extraction.json] [/tmp/drd-dna.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { DesignDNA, ExtractionResult } from "@rs/contracts";
import { buildSitePlan, mapToDocModel } from "@rs/mapper";
import {
  enrichMultiPageFiles,
  gateA,
  gateB,
  renderSitePlan,
  type ResolveContext,
} from "@rs/render";
import { buildBlueprintV1 } from "../lib/build-blueprint";

const extractionPath = process.argv[2] ?? "/tmp/spar_extraction.json";
const dnaPath = process.argv[3] ?? "/tmp/drd-dna.json";

const extraction = JSON.parse(readFileSync(extractionPath, "utf8")) as ExtractionResult;
const dna = JSON.parse(readFileSync(dnaPath, "utf8")) as DesignDNA;

const bp = {
  ...buildBlueprintV1({
    dna,
    blueprintVersionId: "bp_smoke_spar",
    projectId: extraction.project_id || "spar-smoke",
    cycle: 1,
    sourcePrototypeVersionId: "proto_smoke",
    sourcePrototypeSha256: "a".repeat(64),
  }),
  checksum: "a".repeat(64),
};

const dm = mapToDocModel(extraction, {
  company: "The SPAR Group Limited",
  period_label: "for the year ended 26 September 2025",
  doc_kind: "afs",
  currency: "ZAR",
});

console.log(
  "sections",
  dm.sections.map((s) => `${s.kind}:${s.blocks.length}`).join(", "),
);

const plan = buildSitePlan(dm, bp);
console.log("nav", plan.nav.map((n) => `${n.label}->${n.href}`).join(" | "));
console.log("pages", plan.pages.map((p) => p.path).join(", "));

const ctx: ResolveContext = { extraction, docModel: dm };
const { files } = renderSitePlan(plan, bp, ctx);
const enriched = enrichMultiPageFiles(files, plan, dm, {}, { extraction });

const commentary = enriched["commentary.html"] ?? "";
const dr = enriched["directors-report.html"] ?? "";
const ap = enriched["financials/accounting-policies.html"] ?? "";
const income = enriched["financials/income-statement.html"] ?? "";
const bs = enriched["financials/balance-sheet.html"] ?? "";

const checks = {
  noOldPlaceholder: !commentary.includes(
    "Commentary will appear when the extraction includes a shareholder letter.",
  ),
  commentaryDirectors: /Directors['']?\s*report/i.test(commentary),
  commentaryWarehousing: /warehousing/i.test(commentary),
  directorsPage: dr.length > 0 && /warehousing/i.test(dr),
  apPage: ap.length > 0 && /IFRS|accounting policies/i.test(ap),
  incomeDualEntity: income.includes('data-density="dual-entity"') && income.includes("h-entity"),
  incomeSoftLabel: /Gross profit<br\s*\/?>/i.test(income),
  incomeDualAmt: /14 144\.8[\s\S]*?<br/.test(income),
  bsDualEntity: bs.includes('data-density="dual-entity"'),
  bsNoAutoHyphen: /hyphens:none/.test(bs),
};

for (const [k, v] of Object.entries(checks)) {
  console.log(`${v ? "PASS" : "FAIL"} ${k}`);
}

const a = gateA(plan, ctx);
const b = gateB(enriched, ctx);
console.log(`Gate A: ${a.status} · Gate B: ${b.status}`);
if (a.status !== "pass") console.log("A failures", JSON.stringify(a).slice(0, 400));
if (b.status !== "pass") console.log("B failures", b.failures?.slice(0, 5));

const out = "/tmp/spar-multipage-v3";
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/commentary.html`, commentary);
writeFileSync(`${out}/directors-report.html`, dr);
writeFileSync(`${out}/accounting-policies.html`, ap);
writeFileSync(`${out}/income-statement.html`, income);
writeFileSync(`${out}/balance-sheet.html`, bs);
console.log(`Wrote samples → ${out}`);

const failed = Object.values(checks).some((v) => !v) || a.status !== "pass" || b.status !== "pass";
process.exit(failed ? 1 : 0);
