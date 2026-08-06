import { LockGateEvent } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";
import { latestProposedBlueprintId } from "../../../../../lib/gate-ids";
import { env } from "../../../../../lib/env";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const evt = LockGateEvent.parse(await request.json());
    if (!evt.blueprint_version_id && !env.MOCK_BLOB) {
      const id = await latestProposedBlueprintId(projectId);
      if (!id) {
        return Response.json({ error: "no proposed blueprint for this project" }, { status: 409 });
      }
      return await resumeGate("lock", projectId, { ...evt, blueprint_version_id: id });
    }
    return await resumeGate("lock", projectId, evt);
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
