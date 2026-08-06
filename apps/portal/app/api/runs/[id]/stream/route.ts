import { getRun } from "workflow/api";
import { requireOperator } from "../../../../../lib/authz";

/**
 * Tails the workflow run's progress stream (resumable via ?startIndex). The
 * timeline UI renders history from run_events instantly, then tails this for
 * live updates. `id` is the WDK workflow run id.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }
  const { id } = await params;
  const startIndex = Number(new URL(request.url).searchParams.get("startIndex") ?? "0");

  const run = getRun(id);
  const readable = run.getReadable({ startIndex });
  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}
