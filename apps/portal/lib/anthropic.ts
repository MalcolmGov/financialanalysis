import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { estimateCostUsd } from "./ledger";

/**
 * Anthropic client + generation helpers. Direct SDK (per architecture — single
 * provider, leaning on streaming + structured output + vision + prompt
 * caching). Model routing per stage; opus-5 is the default for the design
 * studio's generation and vision passes.
 */

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export const MODELS = {
  vision: "claude-opus-5",
  generate: "claude-opus-5",
  refine: "claude-sonnet-5",
  classify: "claude-haiku-4-5",
  style: "claude-sonnet-5",
} as const;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

function usageOf(model: string, u: Anthropic.Usage): Usage {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_tokens: cacheRead,
    cost_usd: estimateCostUsd(model, u.input_tokens, u.output_tokens, cacheRead),
  };
}

export class RefusalError extends Error {
  constructor(public category: string | null) {
    super(`Claude declined the request (category: ${category ?? "unknown"})`);
    this.name = "RefusalError";
  }
}

/**
 * Structured (JSON-schema-constrained) generation. Used for the spec pass and
 * vision DNA analysis. Non-streaming (outputs are small).
 */
export async function generateStructured<T>(opts: {
  model: string;
  system?: string;
  messages: Anthropic.MessageParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}): Promise<{ data: T; usage: Usage }> {
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    ...(opts.system ? { system: opts.system } : {}),
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
      ...(opts.effort ? { effort: opts.effort } : {}),
    },
    messages: opts.messages,
  });
  if (res.stop_reason === "refusal") {
    throw new RefusalError(res.stop_details?.category ?? null);
  }
  const text = res.content.find((b) => b.type === "text");
  const raw = text && "text" in text ? text.text : "{}";
  return { data: JSON.parse(raw) as T, usage: usageOf(opts.model, res.usage) };
}

/**
 * Long-form streamed generation for the ~2000-line prototype HTML. Streaming is
 * mandatory at this token scale (avoids HTTP timeouts). onDelta lets the caller
 * pipe progress into the workflow stream.
 */
export async function generateLongText(opts: {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  onDelta?: (text: string) => void;
}): Promise<{ text: string; usage: Usage; stopReason: string | null }> {
  const stream = anthropic().messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 64000,
    system: opts.system,
    output_config: { effort: opts.effort ?? "high" },
    messages: opts.messages,
  });
  if (opts.onDelta) stream.on("text", opts.onDelta);
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new RefusalError(final.stop_details?.category ?? null);
  }
  const text = final.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("");
  return { text, usage: usageOf(opts.model, final.usage), stopReason: final.stop_reason };
}

/** Build an image content block from PNG bytes (page renders for the vision pass). */
export function imageBlock(pngBytes: Buffer): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: pngBytes.toString("base64") },
  };
}
