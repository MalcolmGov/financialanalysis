/**
 * Operator: zip the current signed multipage draft to an export_bundle.
 *
 * Usage:
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/export-signed-draft.ts [projectId] [actorEmail]
 */
import {
  ExportSignedDraftError,
  exportSignedDraft,
} from "../lib/export-signed-draft";

const PROJECT_ID = process.argv[2] ?? "444cd443-97cc-4b9c-b0f6-eef4f65c2f98";
const ACTOR = process.argv[3] ?? process.env.OPERATOR_EMAIL ?? "operator";

async function main() {
  try {
    const result = await exportSignedDraft({
      projectId: PROJECT_ID,
      actorUserId: ACTOR,
      actorEmail: ACTOR,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof ExportSignedDraftError) {
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
