import { and, desc, eq } from "drizzle-orm";
import { requireOperator } from "../../../../../lib/authz";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

/** Latest ready prototype version + authz proxy URL for iframe preview. */
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
    return Response.json({ error: "prototype unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const [row] = await db()
    .select({
      id: schema.prototypeVersions.id,
      versionNumber: schema.prototypeVersions.versionNumber,
      refinementMode: schema.prototypeVersions.refinementMode,
      promptText: schema.prototypeVersions.promptText,
      status: schema.prototypeVersions.status,
      assembledHtmlBlobKey: schema.prototypeVersions.assembledHtmlBlobKey,
      sizeBytes: schema.prototypeVersions.sizeBytes,
      createdAt: schema.prototypeVersions.createdAt,
    })
    .from(schema.prototypeVersions)
    .where(
      and(
        eq(schema.prototypeVersions.projectId, projectId),
        eq(schema.prototypeVersions.status, "ready"),
      ),
    )
    .orderBy(desc(schema.prototypeVersions.versionNumber))
    .limit(1);

  if (!row) {
    return Response.json({ error: "no ready prototype version yet" }, { status: 404 });
  }

  const previewPath = `/api/blob/${row.assembledHtmlBlobKey
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;

  return Response.json({
    versionId: row.id,
    versionNumber: row.versionNumber,
    refinementMode: row.refinementMode,
    promptText: row.promptText,
    status: row.status,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt?.toISOString() ?? null,
    previewUrl: previewPath,
  });
}
