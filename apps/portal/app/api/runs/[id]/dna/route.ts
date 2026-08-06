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
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
