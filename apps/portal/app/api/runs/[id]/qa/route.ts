import { QaGateEvent } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const evt = QaGateEvent.parse(await request.json());
    return await resumeGate("qa", projectId, evt);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
