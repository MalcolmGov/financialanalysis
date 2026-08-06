import { requireOperator } from "../../../../../lib/authz";
import { env } from "../../../../../lib/env";
import { parkProjectForFreshStart } from "../../../../../lib/project-reset";

/**
 * Operator "start over": detach any in-flight run and return the project to
 * uploaded (keep current PDF) or created (no document) so the console can
 * re-upload / re-run without sticky mid-pipeline state.
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

  try {
    const result = await parkProjectForFreshStart(projectId);
    return Response.json(result);
  } catch (err) {
    if ((err as Error).message === "project not found") {
      return Response.json({ error: "project not found" }, { status: 404 });
    }
    throw err;
  }
}
