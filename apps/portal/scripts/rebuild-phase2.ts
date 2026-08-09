/**
 * Phase 2 rebuild helper — soft gates so drafts persist.
 *
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/rebuild-phase2.ts <projectId> [...]
 */
import { RebuildSiteDraftError, rebuildProjectSiteDraft } from "../lib/rebuild-site-draft";

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("Usage: rebuild-phase2.ts <projectId> [...]");
  process.exit(1);
}

async function one(projectId: string) {
  console.log("\n=== REBUILD", projectId, "===");
  try {
    const result = await rebuildProjectSiteDraft({
      projectId,
      note: "Phase 2 note numbering + Group/Company books + brand contrast gate",
      hardFailGates: false,
    });
    console.log(
      JSON.stringify(
        {
          projectId,
          ok: true,
          draftVersion: (result as { draftVersion?: number }).draftVersion,
          result,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    if (err instanceof RebuildSiteDraftError) {
      console.error("FAIL", projectId, err.message);
      console.error(JSON.stringify(err.details, null, 2));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

for (const id of ids) {
  await one(id);
}
