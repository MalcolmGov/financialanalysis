import { resumeHook } from "workflow/api";
import { and, eq } from "drizzle-orm";
import { hookTokens, type HookGate } from "@rs/contracts";
import { db, schema } from "./db";
import { env } from "./env";
import { requireOperator } from "./authz";

/**
 * Resumes a workflow gate. Tokens are deterministic but server-secret — derived
 * here, never accepted from the client. Approve / lock / QA sign-off are
 * OPERATOR-SESSION actions only (review tokens, when added, carry view/comment
 * capability and cannot reach these routes).
 */
export async function resumeGate(
  gate: HookGate,
  projectId: string,
  payload: unknown,
): Promise<Response> {
  const operator = await requireOperator();

  let cycle = 1;
  if (!env.MOCK_BLOB) {
    const [project] = await db()
      .select({ cycle: schema.projects.cycle })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    cycle = project?.cycle ?? 1;
  }

  const token =
    gate === "dna"
      ? hookTokens.dna(projectId, cycle)
      : gate === "review"
        ? hookTokens.review(projectId, cycle)
        : gate === "lock"
          ? hookTokens.lock(projectId, cycle)
          : hookTokens.qa(projectId, cycle);

  if (!env.MOCK_BLOB) {
    await db()
      .insert(schema.runEvents)
      .values({
        runId: (await runIdFor(projectId)) ?? projectId,
        type: `gate.${gate}`,
        payload: payload as object,
        actorId: null,
      });
  }

  await resumeHook(token, { ...(payload as object), actor: { id: operator.id } });
  return Response.json({ ok: true });
}

async function runIdFor(projectId: string): Promise<string | null> {
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(schema.pipelineRuns.createdAt);
  return run?.id ?? null;
}

export { and };
