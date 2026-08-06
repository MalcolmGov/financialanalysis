import { DnaCorrection } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const body = await request.json();
    const correction = DnaCorrection.parse(body);
    return await resumeGate("dna", projectId, { approve: correction.approve, correction });
  } catch (err) {
    // requireOperator() (inside resumeGate) throws a Response, not an Error,
    // on an auth failure — return it as-is so a real 401/403 reaches the
    // client instead of being flattened into a generic 400.
    if (err instanceof Response) return err;
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
