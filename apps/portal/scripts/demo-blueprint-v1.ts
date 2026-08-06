/**
 * Verifies the NEW step-6/7/8 wiring end-to-end against REAL DRDGOLD data —
 * not a hand-built fixture blueprint (unlike demo-full.ts's `blueprint()`
 * helper). Exercises exactly the logic steps.ts's extractBlueprint/mapContent/
 * runQa now use: buildBlueprintV1 -> mapToDocModel -> buildSitePlan ->
 * renderSitePlan -> gateA -> gateB -> conformanceLint.
 *
 * Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/demo-blueprint-v1.ts
 */
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Blueprint as BlueprintSchema, type DesignDNA, type ExtractionResult } from "@rs/contracts";
import { conformanceLint, gateA, gateB, renderSitePlan, type ResolveContext } from "@rs/render";
import { mapToDocModel, buildSitePlan } from "@rs/mapper";
import { analyzeVision } from "../lib/vision";
import { reconcileDna } from "../lib/reconcile";
import { buildBlueprintV1 } from "../lib/build-blueprint";

const DIR =
  "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad/full-run";
const OUT =
  "/private/tmp/claude-501/-Users-malcolmgovender-Projects-Automation-tool/c553c9e2-94ee-48b1-b8b5-30ca10b34aca/scratchpad";

const meta = { company: "DRDGOLD Limited", period_label: "HY1 FY2026", doc_kind: "interim_unaudited" as const, currency: "ZAR" };

async function main() {
  const extraction = JSON.parse(await fs.readFile(join(DIR, "extraction.json"), "utf8")) as ExtractionResult;
  const probe = JSON.parse(await fs.readFile(join(DIR, "probe-dna.json"), "utf8")) as DesignDNA;
  const pageFiles = (await fs.readdir(join(DIR, "pages"))).filter((f) => f.endsWith(".png")).sort();
  const pages = await Promise.all(pageFiles.map((f) => fs.readFile(join(DIR, "pages", f))));
  process.stdout.write(`REAL extraction: ${extraction.pages.length} pages, ${Object.keys(extraction.tables).length} tables\n`);

  process.stdout.write("Vision + reconcile (real DNA, not a fixture)…\n");
  const { vision } = await analyzeVision(pages);
  const dna = await reconcileDna(probe, vision);
  process.stdout.write(`  DNA confidence ${dna.confidence.overall}; brand=${dna.palette.roles.brand?.hex}\n`);

  process.stdout.write("buildBlueprintV1 (the new step-6 logic)…\n");
  const draft = buildBlueprintV1({
    dna,
    blueprintVersionId: randomUUID(),
    projectId: "drd-verify",
    cycle: 1,
    sourcePrototypeVersionId: randomUUID(),
    sourcePrototypeSha256: "a".repeat(64),
  });
  const blueprint = BlueprintSchema.parse({ ...draft, checksum: "b".repeat(64) });
  process.stdout.write(`  blueprint valid per @rs/contracts zod schema — ${blueprint.components.length} component(s), ${blueprint.a11y.approved_text_pairs.length} contrast pair(s) computed\n`);
  for (const p of blueprint.a11y.approved_text_pairs) {
    process.stdout.write(`    contrast ${p.fg} on ${p.bg} = ${p.ratio} (WCAG AA text needs >= 4.5)\n`);
  }

  process.stdout.write("mapToDocModel + buildSitePlan (the new step-7 logic)…\n");
  const docModel = mapToDocModel(extraction, meta);
  const plan = buildSitePlan(docModel, blueprint);
  process.stdout.write(`  site plan: ${plan.pages.length} page(s), blueprint_checksum matches: ${plan.blueprint_checksum === blueprint.checksum}\n`);

  process.stdout.write("renderSitePlan + gateA + gateB + conformanceLint (the new step-8 logic)…\n");
  const ctx: ResolveContext = { extraction, docModel };
  const a = gateA(plan, ctx);
  const { files } = renderSitePlan(plan, blueprint, ctx);
  const b = gateB(files, ctx);
  let lintErrors = 0;
  for (const [page, html] of Object.entries(files)) {
    const lint = conformanceLint(html, dna);
    if (!lint.passed) {
      lintErrors += lint.errors.length;
      for (const e of lint.errors) process.stdout.write(`    LINT FAIL [${page}] ${e.rule}: ${e.detail}\n`);
    }
  }

  process.stdout.write(`\n=== RESULT ===\n`);
  process.stdout.write(`Gate A (referential+coverage): ${a.status} — ${a.coverage.placed}/${a.coverage.must_appear_cells} must-appear cells placed, ${a.dangling_refs.length} dangling refs\n`);
  process.stdout.write(`Gate B (DOM number audit):     ${b.status} — ${b.matched}/${b.numeric_tokens_found} numeric tokens verbatim-matched, ${b.failures.length} failures\n`);
  process.stdout.write(`Conformance lint:              ${lintErrors === 0 ? "pass" : "fail"} — ${lintErrors} error(s)\n`);
  if (b.failures.length) for (const f of b.failures.slice(0, 5)) process.stdout.write(`    - ${f.reason} "${f.token}" vs "${f.source_raw}" @ ${f.data_src}\n`);
  if (a.dangling_refs.length) for (const r of a.dangling_refs.slice(0, 5)) process.stdout.write(`    - dangling: ${r}\n`);

  const overallPass = a.status === "pass" && b.status === "pass" && lintErrors === 0;
  process.stdout.write(`\nOVERALL: ${overallPass ? "PASS — steps 6/7/8 wiring produces a real, gate-passing blueprint+siteplan from real DRDGOLD data" : "FAIL — see failures above"}\n`);

  await fs.writeFile(join(OUT, "blueprint-v1-verify.json"), JSON.stringify(blueprint, null, 2));
  if (!overallPass) process.exit(1);
}

main().catch((e) => {
  console.error("\ndemo-blueprint-v1 failed:", e);
  process.exit(1);
});
