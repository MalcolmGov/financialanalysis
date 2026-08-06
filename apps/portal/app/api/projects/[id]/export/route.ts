import { latestExportZipPath } from "../../../../../lib/gate-ids";
import { requireOperator } from "../../../../../lib/authz";
import { getPrivate } from "../../../../../lib/blob";
import { env } from "../../../../../lib/env";

/** Stream the latest export zip for a project (operator-only, attachment). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  if (env.MOCK_BLOB) {
    return Response.json({ error: "export unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const zipPath = await latestExportZipPath(projectId);
  if (!zipPath) {
    return Response.json({ error: "no export bundle for this project yet" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await getPrivate(zipPath);
  } catch {
    return Response.json({ error: "export zip missing from storage" }, { status: 404 });
  }

  const filename = `results-export-${projectId.slice(0, 8)}.zip`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
