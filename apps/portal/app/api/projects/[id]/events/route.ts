import { desc, eq } from "drizzle-orm";
import { requireOperator } from "../../../../../lib/authz";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

/** Lightweight poll endpoint for the project console timeline. */
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
    return Response.json({ events: [], status: "created", documentId: null });
  }

  const [project] = await db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  // projects.pipelineRunId stores the WDK workflow id; run_events.run_id FKs
  // to pipeline_runs.id (our UUID). Resolve via the runs table.
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);

  const events = run
    ? await db()
        .select()
        .from(schema.runEvents)
        .where(eq(schema.runEvents.runId, run.id))
        .orderBy(desc(schema.runEvents.id))
        .limit(50)
    : [];

  return Response.json({
    status: project.status,
    documentId: project.currentDocumentId,
    events: events.map((e) => ({
      id: Number(e.id),
      type: e.type,
      createdAt: (e.createdAt ?? new Date()).toISOString(),
    })),
  });
}
