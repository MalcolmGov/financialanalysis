import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import type { PipelineInput } from "@rs/contracts";
import { resultsPipeline } from "../../../../workflows/pipeline";
import { requireOperator } from "../../../../lib/authz";
import { db, schema } from "../../../../lib/db";
import { env } from "../../../../lib/env";

/** Starts the durable pipeline for a project (step 1 → the whole run). */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }
  const { projectId, orgId, documentId, briefId } = (await request.json()) as {
    projectId: string;
    orgId: string;
    documentId: string;
    briefId?: string;
  };

  const runId = crypto.randomUUID();
  const input: PipelineInput = {
    schema: "PipelineInput@1",
    run_id: runId,
    org_id: orgId,
    project_id: projectId,
    document_id: documentId,
    brief_id: briefId ?? null,
    options: { flagship_model: false, budget_usd: 40, max_refine_rounds: 40 },
  };

  if (!env.MOCK_BLOB) {
    await db()
      .insert(schema.pipelineRuns)
      .values({ id: runId, projectId, documentId, status: "running" });
  }

  const run = await start(resultsPipeline, [input]);

  if (!env.MOCK_BLOB) {
    await db()
      .update(schema.pipelineRuns)
      .set({ workflowRunId: run.runId })
      .where(eq(schema.pipelineRuns.id, runId));
    await db()
      .update(schema.projects)
      .set({ pipelineRunId: run.runId, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));
  }

  return Response.json({ runId, workflowRunId: run.runId });
}
