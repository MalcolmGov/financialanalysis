import { QaGateEvent } from "@rs/contracts";
import { resumeGate } from "../../../../../lib/gates";
import { latestQaReportId, latestQaVerdict } from "../../../../../lib/gate-ids";
import { env } from "../../../../../lib/env";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  try {
    const evt = QaGateEvent.parse(await request.json());
    let payload = evt;
    if (!evt.qa_report_id && !env.MOCK_BLOB) {
      const id = await latestQaReportId(projectId);
      if (!id) {
        return Response.json({ error: "no QA report for this project yet" }, { status: 409 });
      }
      payload = { ...evt, qa_report_id: id };
    }

    // Hard-block export approval when Gate A/B/lint failed. Operator must
    // request changes instead of shipping a known-bad microsite.
    if (payload.type === "approve" && !env.MOCK_BLOB) {
      const verdict = await latestQaVerdict(projectId);
      if (verdict === "fail") {
        return Response.json(
          {
            error:
              "QA verdict is fail — export blocked. Use a change request, or fix mapping/DNA and re-run QA.",
          },
          { status: 409 },
        );
      }
      if (verdict == null) {
        return Response.json({ error: "no QA verdict available yet" }, { status: 409 });
      }
    }

    return await resumeGate("qa", projectId, payload);
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
