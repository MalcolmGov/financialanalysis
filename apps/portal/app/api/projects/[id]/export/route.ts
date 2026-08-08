import { latestExportZipPath } from "../../../../../lib/gate-ids";
import { requireOperator, logAccess } from "../../../../../lib/authz";
import { getPrivate } from "../../../../../lib/blob";
import { env } from "../../../../../lib/env";
import {
  ExportSignedDraftError,
  exportSignedDraft,
} from "../../../../../lib/export-signed-draft";

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

/**
 * Approve & export the current signed multipage draft (no live workflow hook required).
 * Body: { confirm: true }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let operator;
  try {
    operator = await requireOperator();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  if (env.MOCK_BLOB) {
    return Response.json({ error: "export unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  if (!body.confirm) {
    return Response.json({ error: "confirm: true required" }, { status: 400 });
  }

  try {
    const result = await exportSignedDraft({
      projectId,
      actorUserId: operator.id,
      actorEmail: operator.email,
    });
    await logAccess("operator", operator.id, "approve_export", `project:${projectId}`);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ExportSignedDraftError) {
      return Response.json(
        { error: err.message, details: err.details },
        { status: err.status },
      );
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
