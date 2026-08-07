import type { DesignDNA } from "@rs/contracts";
import type { Usage } from "./anthropic";
import { env } from "./env";
import { analyzeVision } from "./vision";
import { reconcileDna } from "./reconcile";

/**
 * Step 3 orchestration: deterministic probe (Railway worker) + vision pass
 * (opus-5 on the 2x page renders) + reconciler → the approved-candidate
 * DesignDNA. The workflow step supplies the page images (from the extraction
 * output in Blob) and the signed source URL for the probe.
 */

export interface DetectDnaResult {
  dna: DesignDNA;
  /** Vision-pass cost only (probe is free). */
  cost_usd: number;
  usage: Usage;
}

/** Call the worker's deterministic probe for the measured half of the DNA. */
async function probeHalf(projectId: string, signedSourceUrl: string, pages: number): Promise<DesignDNA> {
  const res = await fetch(`${env.WORKER_BASE_URL}/probe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.WORKER_SERVICE_TOKEN}`,
    },
    body: JSON.stringify({ project_id: projectId, pages, source: { signed_url: signedSourceUrl } }),
  });
  if (!res.ok) throw new Error(`probe failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as DesignDNA;
}

export async function detectDna(opts: {
  projectId: string;
  signedSourceUrl: string;
  pageImages: Buffer[];
  pages: number;
}): Promise<DetectDnaResult> {
  const probe = await probeHalf(opts.projectId, opts.signedSourceUrl, opts.pages);
  const { vision, usage } = await analyzeVision(opts.pageImages);
  const dna = await reconcileDna(probe, vision);
  return { dna, cost_usd: usage.cost_usd, usage };
}
