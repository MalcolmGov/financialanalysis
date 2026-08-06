import { ReviewGateEvent } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";
import { latestPrototypeVersionId } from "../../../../../lib/gate-ids";
import { env } from "../../../../../lib/env";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const evt = ReviewGateEvent.parse(await request.json());

    if (evt.type === "approve" && !evt.prototype_version_id && !env.MOCK_BLOB) {
      const id = await latestPrototypeVersionId(projectId);
      if (!id) {
        return Response.json({ error: "no ready prototype version for this project" }, { status: 409 });
      }
      return await resumeGate("review", projectId, { ...evt, prototype_version_id: id });
    }

    if (evt.type === "refine" && !evt.base_version_id && !env.MOCK_BLOB) {
      const id = await latestPrototypeVersionId(projectId);
      if (!id) {
        return Response.json({ error: "no ready prototype version to refine" }, { status: 409 });
      }
      return await resumeGate("review", projectId, { ...evt, base_version_id: id });
    }

    return await resumeGate("review", projectId, evt);
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
