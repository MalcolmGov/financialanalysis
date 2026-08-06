import { z } from "zod";
import { IsoDateTime } from "./common.js";

/**
 * Pipeline lifecycle — ONE orchestrator (the consolidated resultsPipeline):
 * cycle counter, per-cycle hook tokens, QA change-request → blueprint unlock
 * → back to review. QA rejection never kills a run.
 */

export const ProjectStatus = z.enum([
  "created",
  "uploaded",
  "extracting",
  "extraction_failed",
  "dna_detecting",
  "dna_review",
  "dna_failed",
  "prototype_generating",
  "prototype_failed",
  "in_review",
  "blueprint_extracting",
  "blueprint_failed",
  "blueprint_proposed",
  "locked",
  "mapping",
  "mapping_failed",
  "qa_running",
  "qa_review",
  "qa_failed",
  "exporting",
  "exported",
  "change_requested",
  "cancelled",
  "archived",
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const PipelineInput = z.object({
  schema: z.literal("PipelineInput@1"),
  run_id: z.string(),
  org_id: z.string(),
  project_id: z.string(),
  document_id: z.string(),
  brief_id: z.string().nullable(),
  options: z.object({
    flagship_model: z.boolean().default(false),
    budget_usd: z.number().default(40),
    max_refine_rounds: z.number().int().default(40),
  }),
});
export type PipelineInput = z.infer<typeof PipelineInput>;

/**
 * Deterministic hook tokens, per gate per cycle. Server-secret: tokens are
 * looked up from the hooks table after authz and only ever used server-side.
 * Approve/lock/qa-signoff are OPERATOR-SESSION actions exclusively — review
 * tokens (v1.5) carry view/comment capability only.
 */
export const hookTokens = {
  dna: (projectId: string, cycle: number) => `dna:${projectId}:c${cycle}`,
  review: (projectId: string, cycle: number) => `review:${projectId}:c${cycle}`,
  lock: (projectId: string, cycle: number) => `lock:${projectId}:c${cycle}`,
  qa: (projectId: string, cycle: number) => `qa:${projectId}:c${cycle}`,
  extraction: (jobId: string) => `extraction:${jobId}`,
} as const;
export const HookGate = z.enum(["dna", "review", "lock", "qa", "extraction"]);
export type HookGate = z.infer<typeof HookGate>;

export const ReviewGateEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("refine"),
    prompt: z.string().min(1),
    /** Optimistic concurrency: must equal the current head version. */
    base_version_id: z.string(),
    force_mode: z.enum(["patch", "regen"]).nullable().default(null),
    actor_user_id: z.string(),
  }),
  z.object({
    type: z.literal("approve"),
    prototype_version_id: z.string(),
    actor_user_id: z.string(),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("cancel"),
    actor_user_id: z.string(),
    reason: z.string(),
  }),
]);
export type ReviewGateEvent = z.infer<typeof ReviewGateEvent>;

export const LockGateEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("confirm_lock"),
    blueprint_version_id: z.string(),
    actor_user_id: z.string(),
  }),
  z.object({
    type: z.literal("reject"),
    blueprint_version_id: z.string(),
    actor_user_id: z.string(),
    reason: z.string(),
  }),
]);
export type LockGateEvent = z.infer<typeof LockGateEvent>;

export const QaGateEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approve"),
    qa_report_id: z.string(),
    actor_user_id: z.string(),
  }),
  z.object({
    type: z.literal("change_request"),
    qa_report_id: z.string(),
    actor_user_id: z.string(),
    reason: z.string(),
    scope: z.enum(["design", "mapping"]),
  }),
]);
export type QaGateEvent = z.infer<typeof QaGateEvent>;

export const ProgressEvent = z.object({
  schema: z.literal("ProgressEvent@1"),
  run_id: z.string(),
  ts: IsoDateTime,
  type: z.enum([
    "step.started",
    "step.progress",
    "step.completed",
    "step.failed",
    "awaiting.dna",
    "awaiting.review",
    "awaiting.lock",
    "awaiting.qa",
    "artifact.created",
    "budget.warning",
    "run.completed",
    "run.failed",
  ]),
  step: z.string().optional(),
  detail: z.string().optional(),
  artifact_id: z.string().optional(),
  pct: z.number().min(0).max(1).optional(),
});
export type ProgressEvent = z.infer<typeof ProgressEvent>;

export const ModelCall = z.object({
  run_id: z.string(),
  step: z.string(),
  model: z.string(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_tokens: z.number().int().default(0),
  cache_write_tokens: z.number().int().default(0),
  cost_usd: z.number(),
});
export type ModelCall = z.infer<typeof ModelCall>;
