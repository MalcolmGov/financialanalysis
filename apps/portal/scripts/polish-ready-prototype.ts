/**
 * One-off: load a project's latest ready placeholder, apply polishPrototypeHtml,
 * reassemble with brand assets, and insert a new ready prototype version.
 *
 * Usage:
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... npx tsx scripts/polish-ready-prototype.ts [projectId]
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getPrivate, putPrivate } from "../lib/blob";
import { resolveAssetUris } from "../lib/brand-assets";
import { db, schema } from "../lib/db";
import { polishPrototypeHtml } from "../lib/polish-prototype";
import { assembleAssets } from "../lib/studio";

const PROJECT_ID = process.argv[2] ?? "92851da1-762d-4d83-9223-f690159a1e69";

async function main() {
  const [parent] = await db()
    .select()
    .from(schema.prototypeVersions)
    .where(
      and(
        eq(schema.prototypeVersions.projectId, PROJECT_ID),
        eq(schema.prototypeVersions.status, "ready"),
      ),
    )
    .orderBy(desc(schema.prototypeVersions.versionNumber))
    .limit(1);
  if (!parent) throw new Error(`no ready prototype for ${PROJECT_ID}`);

  // Blob keys are `runs/<pipelineRuns.id>/…` — not the WDK workflow run id.
  const runIdFromBlob = parent.assembledHtmlBlobKey.match(/^runs\/([^/]+)\//)?.[1];
  const [pipelineRun] = await db()
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, PROJECT_ID))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  const runId = runIdFromBlob ?? pipelineRun?.id;
  if (!runId) throw new Error(`could not resolve pipeline run for ${PROJECT_ID}`);

  const placeholderRaw = (await getPrivate(parent.placeholderHtmlBlobKey)).toString("utf8");
  const polished = polishPrototypeHtml(placeholderRaw);
  if (!polished.includes('data-rs-readable="1"')) {
    throw new Error("polish did not inject data-rs-readable style");
  }

  const runArtifacts = await db()
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.runId, runId));
  const brandRow = [...runArtifacts].reverse().find((a) => a.kind === "brand_assets");
  const extractionRow = [...runArtifacts].reverse().find((a) => a.kind === "extraction_result");
  const brandJson = brandRow
    ? JSON.parse((await getPrivate(brandRow.blobPath)).toString("utf8"))
    : null;
  const extractionJson = extractionRow
    ? JSON.parse((await getPrivate(extractionRow.blobPath)).toString("utf8"))
    : null;
  const { uris } = await resolveAssetUris({
    projectId: PROJECT_ID,
    bundleJson: brandJson,
    extractionJson,
    getPrivate,
  });

  const assembledHtml = assembleAssets(polished, uris);
  const nextVersion = parent.versionNumber + 1;
  const versionId = randomUUID();
  const base = `runs/${runId}/prototypes/v${nextVersion}`;
  const placeholder = await putPrivate(`${base}/placeholder.html`, polished, "text/html");
  const assembled = await putPrivate(`${base}/assembled.html`, assembledHtml, "text/html");

  await db().insert(schema.prototypeVersions).values({
    id: versionId,
    projectId: PROJECT_ID,
    cycle: parent.cycle,
    versionNumber: nextVersion,
    parentVersionId: parent.id,
    placeholderHtmlBlobKey: placeholder.blob_path,
    assembledHtmlBlobKey: assembled.blob_path,
    sha256: assembled.sha256,
    sizeBytes: assembled.bytes,
    promptText:
      "Style polish: letter/prose share --rs-content-max with section headers (no nested 68ch); wrapping nav; AA contrast",
    refinementMode: "patch",
    patchJson: [{ search: "</head>", replace: "<!-- rs-readable polish --></head>" }],
    lintReport: null,
    audit: { polish: "rs-readable-layout", parent_version: parent.versionNumber },
    model: "deterministic-polish",
    costUsdMicros: 0,
    status: "ready",
  });
  await db().insert(schema.artifacts).values({
    runId,
    kind: "prototype",
    version: nextVersion,
    blobPath: assembled.blob_path,
    sha256: assembled.sha256,
    bytes: assembled.bytes,
    contentType: "text/html",
    meta: { versionId, placeholder: placeholder.blob_path, polish: "rs-readable" },
  });

  process.stdout.write(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        parentVersion: parent.versionNumber,
        versionNumber: nextVersion,
        versionId,
        assembledHtmlBlobKey: assembled.blob_path,
        sizeBytes: assembled.bytes,
        hasReadable: assembledHtml.includes('data-rs-readable="1"'),
        hasProseMeasure: assembledHtml.includes("--rs-prose:var(--rs-content-max)"),
        hasContentMax: assembledHtml.includes("--rs-content-max"),
        noNested68ch: !assembledHtml.includes("68ch"),
        hasWrapNav: assembledHtml.includes("flex-wrap:wrap"),
        hasCentered: assembledHtml.includes("margin-inline:auto"),
        hasNoBodyOverflowX: /html,body\{\s*overflow-x:hidden/.test(assembledHtml),
        killsEllipsis: assembledHtml.includes("text-overflow:unset"),
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
