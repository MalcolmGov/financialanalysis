import type { ExtractionJobSubmit } from "@rs/contracts";
import { env } from "./env";

/** Typed client for the Railway extraction worker. Bearer-authed, service-to-service. */
export async function submitExtraction(job: ExtractionJobSubmit): Promise<void> {
  const res = await fetch(`${env.WORKER_BASE_URL}/v1/extractions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.WORKER_SERVICE_TOKEN}`,
    },
    body: JSON.stringify(job),
  });
  // 202 Accepted, or 200 if idempotent re-submit re-attaches.
  if (res.status !== 202 && res.status !== 200) {
    throw new Error(`worker submit failed: ${res.status} ${await res.text()}`);
  }
}

export async function getExtractionStatus(jobId: string): Promise<unknown> {
  const res = await fetch(`${env.WORKER_BASE_URL}/v1/extractions/${jobId}`, {
    headers: { authorization: `Bearer ${env.WORKER_SERVICE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`worker status failed: ${res.status}`);
  return res.json();
}
