import { and, desc, eq } from "drizzle-orm";
import { requireOperator } from "../../../../../lib/authz";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

type PageMeta = { path: string; title: string };

function toBlobUrl(path: string): string {
  return `/api/blob/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

/** Latest multipage site draft for operator review (page tree + preview URLs). */
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
    return Response.json({ error: "site draft unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const [project] = await db()
    .select({
      currentDocumentId: schema.projects.currentDocumentId,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) {
    return Response.json({ error: "no pipeline run for this project yet" }, { status: 404 });
  }

  const [art] = await db()
    .select({
      id: schema.artifacts.id,
      version: schema.artifacts.version,
      blobPath: schema.artifacts.blobPath,
      meta: schema.artifacts.meta,
      createdAt: schema.artifacts.createdAt,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "site_plan")))
    .orderBy(desc(schema.artifacts.version), desc(schema.artifacts.createdAt))
    .limit(1);

  if (!art) {
    return Response.json({ error: "no multipage site draft yet" }, { status: 404 });
  }

  const meta = (art.meta ?? {}) as {
    prefix?: string;
    entrypoint?: string;
    mode?: string;
    pages?: PageMeta[];
    files?: string[];
    gateA?: string;
    gateB?: string;
    sitePlanId?: string;
    draftId?: string;
    fileCount?: number;
  };

  const prefix = meta.prefix;
  if (!prefix) {
    return Response.json({ error: "site draft missing storage prefix" }, { status: 409 });
  }

  const pages: PageMeta[] =
    meta.pages?.length ?
      meta.pages
    : (meta.files ?? [])
        .filter((p) => p.endsWith(".html") && !p.startsWith("prototype/"))
        .map((path) => ({
          path,
          title: path
            .replace(/\.html$/, "")
            .replace(/^financials\//, "")
            .replace(/[-_/]/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        }));

  let sourcePdfUrl: string | null = null;
  if (project.currentDocumentId) {
    const [doc] = await db()
      .select({ blobPath: schema.documents.blobPath })
      .from(schema.documents)
      .where(eq(schema.documents.id, project.currentDocumentId))
      .limit(1);
    if (doc?.blobPath) sourcePdfUrl = toBlobUrl(doc.blobPath);
  }

  return Response.json({
    draftId: meta.draftId ?? art.id,
    version: art.version,
    mode: meta.mode ?? "multipage",
    entrypoint: meta.entrypoint ?? "index.html",
    sitePlanId: meta.sitePlanId ?? null,
    prefix,
    basePreviewUrl: toBlobUrl(`${prefix}/`),
    pages: pages.map((p) => ({
      path: p.path,
      title: p.title,
      previewUrl: toBlobUrl(`${prefix}/${p.path}`),
    })),
    gateA: meta.gateA ?? null,
    gateB: meta.gateB ?? null,
    fileCount: meta.fileCount ?? pages.length,
    createdAt: art.createdAt?.toISOString() ?? null,
    sourcePdfUrl,
    manifestUrl: toBlobUrl(art.blobPath),
  });
}
