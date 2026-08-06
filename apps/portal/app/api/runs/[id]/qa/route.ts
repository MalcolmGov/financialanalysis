import { QaGateEvent } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";
import { latestQaReportId } from "../../../../../lib/gate-ids";
import { env } from "../../../../../lib/env";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const evt = QaGateEvent.parse(await request.json());
    if (!evt.qa_report_id && !env.MOCK_BLOB) {
      const id = await latestQaReportId(projectId);
      if (!id) {
        return Response.json({ error: "no QA report for this project yet" }, { status: 409 });
      }
      return await resumeGate("qa", projectId, { ...evt, qa_report_id: id });
    }
    return await resumeGate("qa", projectId, evt);
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
