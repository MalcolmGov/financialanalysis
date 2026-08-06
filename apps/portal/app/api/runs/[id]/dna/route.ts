import { DnaCorrection } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";
import { latestDnaArtifactId } from "../../../../../lib/gate-ids";
import { env } from "../../../../../lib/env";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const body = await request.json();
    const correction = DnaCorrection.parse(body);
    let dnaId = correction.dna_id;
    if (!dnaId && !env.MOCK_BLOB) {
      dnaId = (await latestDnaArtifactId(projectId)) ?? "";
    }
    return await resumeGate("dna", projectId, {
      approve: correction.approve,
      correction: { ...correction, dna_id: dnaId },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
