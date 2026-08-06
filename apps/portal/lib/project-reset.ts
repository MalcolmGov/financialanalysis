import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * Park a project so the operator can upload a new PDF / re-run the pipeline.
 * Detaches the active workflow, cancels open gates, and clears version rows that
 * would collide on the next initial prototype (unique project_id + version_number).
 *
 * Does not delete blobs or documents — only DB pointers that block a fresh start.
 */
export async function parkProjectForFreshStart(projectId: string): Promise<{
  status: "uploaded" | "created";
  documentId: string | null;
}> {
  const [project] = await db()
    .select({
      id: schema.projects.id,
      currentDocumentId: schema.projects.currentDocumentId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) {
    throw new Error("project not found");
  }

  await db()
    .update(schema.hooks)
    .set({ status: "cancelled" })
    .where(and(eq(schema.hooks.projectId, projectId), eq(schema.hooks.status, "open")));

  await db()
    .update(schema.pipelineRuns)
    .set({ status: "abandoned", completedAt: new Date() })
    .where(and(eq(schema.pipelineRuns.projectId, projectId), eq(schema.pipelineRuns.status, "running")));

  // Blueprints reference prototypes — clear blueprints first.
  await db()
    .delete(schema.blueprintVersions)
    .where(eq(schema.blueprintVersions.projectId, projectId));
  await db()
    .delete(schema.prototypeVersions)
    .where(eq(schema.prototypeVersions.projectId, projectId));

  const nextStatus = project.currentDocumentId ? "uploaded" : "created";
  await db()
    .update(schema.projects)
    .set({
      status: nextStatus,
      pipelineRunId: null,
      currentBlueprintId: null,
      cycle: 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  return { status: nextStatus, documentId: project.currentDocumentId };
}
