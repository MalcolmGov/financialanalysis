import { eq } from "drizzle-orm";
import { requireOperator } from "../../../../../lib/authz";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

/**
 * Operator "start over": clear a failed/in-progress run association and return
 * the project to uploaded (keep current PDF) or created (no document yet) so
 * the console can re-upload / re-run without sticky extraction errors.
 */
export async function POST(
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
    return Response.json({ status: "uploaded", documentId: null });
  }

  const [project] = await db()
    .select({
      id: schema.projects.id,
      currentDocumentId: schema.projects.currentDocumentId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  const nextStatus = project.currentDocumentId ? "uploaded" : "created";
  await db()
    .update(schema.projects)
    .set({
      status: nextStatus,
      pipelineRunId: null,
      cycle: 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  return Response.json({
    status: nextStatus,
    documentId: project.currentDocumentId,
  });
}
