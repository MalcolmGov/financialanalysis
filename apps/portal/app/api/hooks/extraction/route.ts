import { createHmac, timingSafeEqual } from "node:crypto";
import { resumeHook } from "workflow/api";
import { ExtractionWebhook, hookTokens } from "@rs/contracts";
import { env } from "../../../../lib/env";

/**
 * Worker → portal extraction webhook. HMAC-verified, then resumes the
 * extraction hook the pipeline is parked on. Idempotent on job_id+status.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const sig = request.headers.get("x-signature") ?? "";

  const expected = createHmac("sha256", env.WEBHOOK_HMAC_KEY).update(raw).digest("hex");
  const ok =
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return new Response("bad signature", { status: 401 });

  let payload;
  try {
    payload = ExtractionWebhook.parse(JSON.parse(raw));
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  await resumeHook(hookTokens.extraction(payload.job_id), {
    status: payload.status,
    result_pointer: payload.result_pointer,
  });
  return Response.json({ ok: true });
}
