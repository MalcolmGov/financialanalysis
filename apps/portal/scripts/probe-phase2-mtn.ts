/**
 * Local Phase 2 probe — map MTN extraction → siteplan note/book evidence.
 */
import { desc, eq } from "drizzle-orm";
import type { DesignDNA, ExtractionResult } from "@rs/contracts";
import {
  buildSitePlan,
  classifyDocShape,
  mapToDocModel,
  noteNumberOf,
} from "@rs/mapper";
import { buildBlueprintV1 } from "../lib/build-blueprint";
import { getPrivate } from "../lib/blob";
import { db, schema } from "../lib/db";

const PROJECT = process.argv[2] ?? "8ed9620c-804d-4370-882d-8df8c1243f0c";

async function main() {
  const [run] = await db()
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, PROJECT))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  const arts = await db()
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.runId, run!.id));
  const extraction = JSON.parse(
    (
      await getPrivate(arts.find((a) => a.kind === "extraction_result")!.blobPath)
    ).toString("utf8"),
  ) as ExtractionResult;
  const dna = JSON.parse(
    (await getPrivate(arts.find((a) => a.kind === "design_dna")!.blobPath)).toString(
      "utf8",
    ),
  ) as DesignDNA;

  const doc = mapToDocModel(extraction, {
    company: "MTN Group Limited",
    period_label: "FY2025",
    doc_kind: "annual_audited",
    currency: "ZAR",
  });
  const noteSecs = doc.sections.filter((s) => s.kind === "note");
  const withNum = noteSecs.filter((s) => s.note_number != null);
  const nums = [...new Set(withNum.map((s) => s.note_number!))].sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        shape: classifyDocShape(doc),
        noteSections: noteSecs.length,
        noteSectionsNumbered: withNum.length,
        uniqueNoteNumbers: nums,
        sampleTitles: noteSecs.slice(0, 8).map((s) => ({
          n: s.note_number,
          t: s.title?.text?.slice(0, 80),
        })),
        sampleClassify: [
          "2 RESULTS OF OPERATIONS",
          "Notes to the Group financial statements (continued)",
        ].map((t) => ({ t, n: noteNumberOf(t) })),
      },
      null,
      2,
    ),
  );

  const bp = buildBlueprintV1({
    projectId: PROJECT,
    cycle: 1,
    blueprintVersionId: "bp_probe",
    sourcePrototypeVersionId: "proto",
    sourcePrototypeSha256: "a".repeat(64),
    dna,
  });
  const plan = buildSitePlan(doc, bp as any);
  const notePages = plan.pages.filter((p) => /notes/i.test(p.path));
  const stmtPages = plan.pages.filter(
    (p) =>
      /income-statement|balance-sheet|cash-flows|changes-in-equity/.test(p.path),
  );
  console.log(
    JSON.stringify(
      {
        pageCount: plan.pages.length,
        nav: plan.nav.map((n) => n.label),
        statementPaths: stmtPages.map((p) => p.path),
        notePaths: notePages.map((p) => {
          const region = Object.values(p.regions)[0] as { length?: number } | undefined;
          return `${p.path} (${Array.isArray(region) ? region.length : "?"} tables)`;
        }),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
