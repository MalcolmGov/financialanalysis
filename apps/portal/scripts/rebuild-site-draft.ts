/**
 * Rebuild multipage site draft for a project from its latest DNA + extraction.
 * Persists the same artifact shape as workflows/steps.buildSiteDraftArtifact.
 *
 * Usage:
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/rebuild-site-draft.ts [projectId]
 */
import {
  RebuildSiteDraftError,
  rebuildProjectSiteDraft,
} from "../lib/rebuild-site-draft";

const PROJECT_ID = process.argv[2] ?? "444cd443-97cc-4b9c-b0f6-eef4f65c2f98";

async function main() {
  try {
    const result = await rebuildProjectSiteDraft({
      projectId: PROJECT_ID,
      note: "rebuilt via scripts/rebuild-site-draft.ts (P5/P6 corporate QA + delivery pack)",
      hardFailGates: true,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof RebuildSiteDraftError) {
      console.error(err.message);
      if (err.details) console.error(JSON.stringify(err.details, null, 2));
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
