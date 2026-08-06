import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * Resolve the current head IDs a gate payload needs from Postgres, so the
 * operator console can approve without stashing UUIDs in client state.
 */
export async function latestPrototypeVersionId(projectId: string): Promise<string | null> {
  const [row] = await db()
    .select({ id: schema.prototypeVersions.id })
    .from(schema.prototypeVersions)
    .where(
      and(
        eq(schema.prototypeVersions.projectId, projectId),
        eq(schema.prototypeVersions.status, "ready"),
      ),
    )
    .orderBy(desc(schema.prototypeVersions.versionNumber))
    .limit(1);
  return row?.id ?? null;
}

export async function latestProposedBlueprintId(projectId: string): Promise<string | null> {
  const [row] = await db()
    .select({ id: schema.blueprintVersions.id })
    .from(schema.blueprintVersions)
    .where(
      and(
        eq(schema.blueprintVersions.projectId, projectId),
        eq(schema.blueprintVersions.status, "proposed"),
      ),
    )
    .orderBy(desc(schema.blueprintVersions.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function latestDnaArtifactId(projectId: string): Promise<string | null> {
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const [art] = await db()
    .select({ id: schema.artifacts.id, meta: schema.artifacts.meta })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "design_dna")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  if (!art) return null;
  const meta = art.meta as { artifact_id?: string } | null;
  return meta?.artifact_id ?? art.id;
}

export async function latestQaReportId(projectId: string): Promise<string | null> {
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const [art] = await db()
    .select({ id: schema.artifacts.id, meta: schema.artifacts.meta })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "qa_report")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  if (!art) return null;
  const meta = art.meta as { blueprintVersionId?: string } | null;
  return meta?.blueprintVersionId ? `qa_${meta.blueprintVersionId}` : art.id;
}

export async function latestQaVerdict(
  projectId: string,
): Promise<"pass" | "fail" | null> {
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const [art] = await db()
    .select({ meta: schema.artifacts.meta })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "qa_report")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  const verdict = (art?.meta as { verdict?: string } | null)?.verdict;
  return verdict === "pass" || verdict === "fail" ? verdict : null;
}

export async function latestExportZipPath(projectId: string): Promise<string | null> {
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const [art] = await db()
    .select({ meta: schema.artifacts.meta })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "export_bundle")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  const zipPath = (art?.meta as { zipPath?: string } | null)?.zipPath;
  return zipPath ?? null;
}
