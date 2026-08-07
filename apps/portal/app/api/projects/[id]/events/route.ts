import { and, desc, eq } from "drizzle-orm";
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
      sourcePdfPath: null,
      sourcePdfUrl: null,
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
  let sourcePdfPath: string | null = null;
  if (project.currentDocumentId) {
    const [doc] = await db()
      .select({
        pageCount: schema.documents.pageCount,
        blobPath: schema.documents.blobPath,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, project.currentDocumentId));
    pageCount = doc?.pageCount ?? null;
    sourcePdfPath = doc?.blobPath ?? null;
  }
  const sourcePdfUrl = sourcePdfPath
    ? `/api/blob/${sourcePdfPath
        .split("/")
        .map((s) => encodeURIComponent(s))
        .join("/")}`
    : null;

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

  // Prefer the job for the latest pipeline run (ext_<runId>) so an older
  // failed job cannot shadow a newly queued extract.
  const preferredJobId = run ? `ext_${run.id}` : null;
  const [jobByRun] = preferredJobId
    ? await db()
        .select({
          jobId: schema.extractionJobs.jobId,
          status: schema.extractionJobs.status,
          progress: schema.extractionJobs.progress,
          error: schema.extractionJobs.error,
          updatedAt: schema.extractionJobs.updatedAt,
        })
        .from(schema.extractionJobs)
        .where(eq(schema.extractionJobs.jobId, preferredJobId))
        .limit(1)
    : [undefined];
  const [jobLatest] = await db()
    .select({
      jobId: schema.extractionJobs.jobId,
      status: schema.extractionJobs.status,
      progress: schema.extractionJobs.progress,
      error: schema.extractionJobs.error,
      updatedAt: schema.extractionJobs.updatedAt,
    })
    .from(schema.extractionJobs)
    .where(eq(schema.extractionJobs.projectId, projectId))
    .orderBy(desc(schema.extractionJobs.updatedAt))
    .limit(1);
  const job = jobByRun ?? jobLatest;

  const progress = (job?.progress ?? null) as {
    pages_done?: number;
    total_pages?: number | null;
  } | null;
  const jobError = (job?.error ?? null) as { code?: string; message?: string } | null;

  // Only coerce while still parked on extracting — never after a fresh upload
  // (status uploaded) or an explicit start-over, or the failed job sticks forever.
  let status = project.status;
  if (job?.status === "failed" && status === "extracting") {
    status = "extraction_failed";
  }

  const showExtraction =
    status === "extracting" ||
    status === "extraction_failed" ||
    job?.status === "queued" ||
    job?.status === "fetching" ||
    job?.status === "converting" ||
    job?.status === "uploading_assets";

  let qaVerdict: "pass" | "fail" | null = null;
  let exportReady = false;
  let exportInfo: {
    mode?: string;
    fileCount?: number;
    files?: string[];
    entrypoint?: string;
  } | null = null;
  if (run) {
    const [qaArt] = await db()
      .select({ meta: schema.artifacts.meta })
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "qa_report")))
      .orderBy(desc(schema.artifacts.createdAt))
      .limit(1);
    const v = (qaArt?.meta as { verdict?: string } | null)?.verdict;
    if (v === "pass" || v === "fail") qaVerdict = v;

    const [expArt] = await db()
      .select({ meta: schema.artifacts.meta })
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "export_bundle")))
      .orderBy(desc(schema.artifacts.createdAt))
      .limit(1);
    const expMeta = expArt?.meta as {
      zipPath?: string;
      mode?: string;
      fileCount?: number;
      files?: string[];
      entrypoint?: string;
    } | null;
    exportReady = !!expMeta?.zipPath;
    if (expMeta?.zipPath) {
      exportInfo = {
        mode: expMeta.mode,
        fileCount: expMeta.fileCount,
        files: expMeta.files,
        entrypoint: expMeta.entrypoint ?? "index.html",
      };
    }
  }

  return Response.json({
    status,
    documentId: project.currentDocumentId,
    pageCount,
    sourcePdfPath,
    sourcePdfUrl,
    runStartedAt: run?.createdAt ? run.createdAt.toISOString() : null,
    /** Approximate status entry time — used as wait-clock fallback on reload. */
    statusUpdatedAt: project.updatedAt ? project.updatedAt.toISOString() : null,
    extraction:
      showExtraction && job
        ? {
            jobId: job.jobId,
            status: job.status,
            pagesDone: progress?.pages_done ?? 0,
            totalPages: progress?.total_pages ?? pageCount,
            error:
              job.status === "failed"
                ? (jobError?.message ?? jobError?.code ?? null)
                : null,
          }
        : null,
    qaVerdict,
    exportReady,
    exportInfo,
    events: events.map((e) => ({
      id: Number(e.id),
      type: e.type,
      createdAt: (e.createdAt ?? new Date()).toISOString(),
    })),
  });
}
