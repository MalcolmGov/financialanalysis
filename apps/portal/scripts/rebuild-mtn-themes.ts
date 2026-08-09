/**
 * Rebuild MTN (or any project) for classic then editorial themes.
 *
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/rebuild-mtn-themes.ts [projectId]
 */
import {
  RebuildSiteDraftError,
  rebuildProjectSiteDraft,
} from "../lib/rebuild-site-draft";

const PROJECT_ID = process.argv[2] ?? "f3cc2ac8-29be-478c-babf-29677edabc8f";

async function main() {
  for (const themeId of ["classic", "editorial"] as const) {
    try {
      const result = await rebuildProjectSiteDraft({
        projectId: PROJECT_ID,
        themeId,
        note: `MTN bright-brand contrast + AFS commentary (${themeId})`,
        hardFailGates: true,
      });
      console.log(themeId.toUpperCase(), JSON.stringify(result, null, 2));
    } catch (err) {
      if (err instanceof RebuildSiteDraftError) {
        console.error(themeId, err.message);
        if (err.details) console.error(JSON.stringify(err.details, null, 2));
        process.exit(1);
      }
      throw err;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
