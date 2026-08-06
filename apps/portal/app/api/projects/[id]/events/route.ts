import { desc, eq } from "drizzle-orm";
import { requireOperator } from "../../../../../lib/authz";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

/** Lightweight poll endpoint for the project console timeline + extraction wait. */
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
    return Response.json({
      events: [],
      status: "created",
      documentId: null,
      pageCount: null,
      runStartedAt: null,
      extraction: null,
    });
  }

  const [project] = await db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  let pageCount: number | null = null;
  if (project.currentDocumentId) {
    const [doc] = await db()
      .select({ pageCount: schema.documents.pageCount })
      .from(schema.documents)
      .where(eq(schema.documents.id, project.currentDocumentId));
    pageCount = doc?.pageCount ?? null;
  }

  // projects.pipelineRunId stores the WDK workflow id; run_events.run_id FKs
  // to pipeline_runs.id (our UUID). Resolve via the runs table.
  const [run] = await db()
    .select({
      id: schema.pipelineRuns.id,
      createdAt: schema.pipelineRuns.createdAt,
    })
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

  const [job] = await db()
    .select({
      jobId: schema.extractionJobs.jobId,
      status: schema.extractionJobs.status,
      progress: schema.extractionJobs.progress,
      updatedAt: schema.extractionJobs.updatedAt,
    })
    .from(schema.extractionJobs)
    .where(eq(schema.extractionJobs.projectId, projectId))
    .orderBy(desc(schema.extractionJobs.updatedAt))
    .limit(1);

  const progress = (job?.progress ?? null) as {
    pages_done?: number;
    total_pages?: number | null;
  } | null;

  return Response.json({
    status: project.status,
    documentId: project.currentDocumentId,
    pageCount,
    runStartedAt: run?.createdAt ? run.createdAt.toISOString() : null,
    extraction: job
      ? {
          jobId: job.jobId,
          status: job.status,
          pagesDone: progress?.pages_done ?? 0,
          totalPages: progress?.total_pages ?? pageCount,
        }
      : null,
    events: events.map((e) => ({
      id: Number(e.id),
      type: e.type,
      createdAt: (e.createdAt ?? new Date()).toISOString(),
    })),
  });
}
