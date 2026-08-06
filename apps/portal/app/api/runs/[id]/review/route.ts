import { ReviewGateEvent } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const evt = ReviewGateEvent.parse(await request.json());
    return await resumeGate("review", projectId, evt);
  } catch (err) {
    // requireOperator() (inside resumeGate) throws a Response, not an Error,
    // on an auth failure — return it as-is instead of flattening to a 400.
    if (err instanceof Response) return err;
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
