import { desc, eq } from "drizzle-orm";
import { db, schema } from "../../../lib/db";
import { env } from "../../../lib/env";
import { requireOperatorOrRedirect } from "../../../lib/authz";
import { ProjectConsole } from "./console";

async function loadProject(id: string) {
  if (env.MOCK_BLOB) return null;
  try {
    const [project] = await db().select().from(schema.projects).where(eq(schema.projects.id, id));
    if (!project) return null;
    const [run] = await db()
      .select({ id: schema.pipelineRuns.id, createdAt: schema.pipelineRuns.createdAt })
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.projectId, id))
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
    let pageCount: number | null = null;
    let sourcePdfUrl: string | null = null;
    if (project.currentDocumentId) {
      const [doc] = await db()
        .select({
          pageCount: schema.documents.pageCount,
          blobPath: schema.documents.blobPath,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, project.currentDocumentId));
      pageCount = doc?.pageCount ?? null;
      if (doc?.blobPath) {
        sourcePdfUrl = `/api/blob/${doc.blobPath
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/")}`;
      }
    }
    return {
      project,
      events,
      pageCount,
      sourcePdfUrl,
      runStartedAt: run?.createdAt ?? null,
    };
  } catch {
    return null;
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOperatorOrRedirect();
  const { id } = await params;
  const data = await loadProject(id);

  return (
    <ProjectConsole
      projectId={id}
      orgId={data?.project.orgId ?? ""}
      documentId={data?.project.currentDocumentId ?? null}
      initialStatus={data?.project.status ?? "created"}
      initialPageCount={data?.pageCount ?? null}
      initialSourcePdfUrl={data?.sourcePdfUrl ?? null}
      initialRunStartedAt={data?.runStartedAt ? data.runStartedAt.toISOString() : null}
      companyName={data?.project.companyName ?? "Project"}
      periodLabel={data?.project.periodLabel ?? null}
      workflowRunId={data?.project.pipelineRunId ?? null}
      initialEvents={(data?.events ?? []).map((e) => ({
        id: Number(e.id),
        type: e.type,
        createdAt: (e.createdAt ?? new Date()).toISOString(),
      }))}
    />
  );
}
