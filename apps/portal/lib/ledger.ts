import type { ModelCall } from "@rs/contracts";
import { db, schema } from "./db";
import { env } from "./env";

/** Per-1M-token prices (USD). Kept here so the cost panel and budget guard agree. */
export const MODEL_PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { in: 3, out: 15, cacheRead: 0.3 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheRead: 0.1 },
  "claude-fable-5": { in: 10, out: 50, cacheRead: 1 },
};

export function estimateCostUsd(
  model: string,
  inTok: number,
  outTok: number,
  cacheReadTok = 0,
): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES["claude-sonnet-5"];
  return (
    (inTok / 1e6) * p.in +
    (outTok / 1e6) * p.out +
    (cacheReadTok / 1e6) * p.cacheRead
  );
}

export async function recordModelCall(call: Omit<ModelCall, "cost_usd"> & { cost_usd?: number }) {
  if (env.MOCK_BLOB) return; // dev: skip DB writes when running credential-free
  const cost =
    call.cost_usd ??
    estimateCostUsd(call.model, call.input_tokens, call.output_tokens, call.cache_read_tokens);
  await db()
    .insert(schema.modelCalls)
    .values({
      runId: call.run_id,
      step: call.step,
      model: call.model,
      inputTokens: call.input_tokens,
      outputTokens: call.output_tokens,
      cacheReadTokens: call.cache_read_tokens,
      cacheWriteTokens: call.cache_write_tokens,
      costUsd: cost.toFixed(4),
    });
}
