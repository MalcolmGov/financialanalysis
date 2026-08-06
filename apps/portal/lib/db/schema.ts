import {
  bigint,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Platform data model. Enums are stored as text and validated against the
 * @rs/contracts zod enums at the application boundary (single source of truth
 * lives in the contracts package, not in a duplicated pg enum).
 */

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("owner"), // owner | member
  passwordHash: text("password_hash"), // scrypt, see lib/password.ts; null = no login provisioned
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  companyName: text("company_name").notNull(),
  periodLabel: text("period_label"),
  /** @rs/contracts ProjectStatus */
  status: text("status").notNull().default("created"),
  cycle: integer("cycle").notNull().default(1),
  retentionDays: integer("retention_days").notNull().default(90),
  embargoUntil: timestamp("embargo_until", { withTimezone: true }),
  currentDocumentId: uuid("current_document_id"),
  currentBlueprintId: uuid("current_blueprint_id"),
  pipelineRunId: text("pipeline_run_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  blobPath: text("blob_path").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  pageCount: integer("page_count"),
  pdfMeta: jsonb("pdf_meta"),
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  documentId: uuid("document_id").references(() => documents.id),
  workflowRunId: text("workflow_run_id").unique(),
  status: text("status").notNull().default("running"),
  currentStep: text("current_step"),
  error: jsonb("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/** Registry of every pipeline artifact; bodies live in Blob, rows point at them. */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    kind: text("kind").notNull(), // @rs/contracts ArtifactKind
    version: integer("version").notNull().default(1),
    blobPath: text("blob_path").notNull(),
    sha256: text("sha256").notNull(),
    bytes: bigint("bytes", { mode: "number" }),
    contentType: text("content_type").notNull(),
    meta: jsonb("meta").notNull().default({}),
    immutable: boolean("immutable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("artifacts_run_kind_version").on(t.runId, t.kind, t.version)],
);

/** Append-only lifecycle event log — the timeline renders from here. */
export const runEvents = pgTable(
  "run_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actorId: uuid("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("run_events_run_idx").on(t.runId, t.id)],
);

/** Append-only, immutable prototype versions. */
export const prototypeVersions = pgTable(
  "prototype_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    cycle: integer("cycle").notNull(),
    versionNumber: integer("version_number").notNull(),
    parentVersionId: uuid("parent_version_id"),
    placeholderHtmlBlobKey: text("placeholder_html_blob_key").notNull(),
    assembledHtmlBlobKey: text("assembled_html_blob_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes"),
    promptText: text("prompt_text"),
    refinementMode: text("refinement_mode").notNull(), // initial | patch | regen
    patchJson: jsonb("patch_json"),
    lintReport: jsonb("lint_report"),
    audit: jsonb("audit"),
    model: text("model"),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }),
    flagged: boolean("flagged").notNull().default(false),
    status: text("status").notNull().default("generating"), // generating | ready | failed
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("prototype_versions_project_version").on(t.projectId, t.versionNumber),
  ],
);

/** Blueprint versions. Immutability enforced by trigger (see companion SQL). */
export const blueprintVersions = pgTable("blueprint_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  cycle: integer("cycle").notNull(),
  versionNumber: integer("version_number").notNull(),
  sourcePrototypeVersionId: uuid("source_prototype_version_id")
    .notNull()
    .references(() => prototypeVersions.id),
  supersedesId: uuid("supersedes_id"),
  blueprintJson: jsonb("blueprint_json").notNull(),
  checksum: text("checksum").notNull(),
  assetsManifest: jsonb("assets_manifest"),
  schemaVersion: text("schema_version").notNull().default("1.0"),
  status: text("status").notNull().default("proposed"), // proposed|locked|superseded|rejected
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: uuid("locked_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Append-only audit trail of every governance action. */
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  action: text("action").notNull(),
  prototypeVersionId: uuid("prototype_version_id"),
  blueprintVersionId: uuid("blueprint_version_id"),
  prototypeSha256: text("prototype_sha256"),
  blueprintSha256: text("blueprint_sha256"),
  actorUserId: uuid("actor_user_id"),
  actorRole: text("actor_role"),
  note: text("note"),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Hook registry mirrored from WDK; one open hook per project+gate. */
export const hooks = pgTable(
  "hooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    gate: text("gate").notNull(), // dna|review|lock|qa|extraction
    cycle: integer("cycle").notNull(),
    token: text("token").notNull().unique(),
    status: text("status").notNull().default("open"), // open|resumed|cancelled
    resumedBy: uuid("resumed_by"),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("hooks_one_open_per_gate")
      .on(t.projectId, t.gate)
      .where(sql`status = 'open'`),
  ],
);

/** Account-less client review links (v1.5): hashed, armed, expiring, view/comment only. */
export const reviewLinks = pgTable("review_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => pipelineRuns.id),
  tokenHash: text("token_hash").notNull().unique(),
  scope: text("scope").notNull(), // review | qa_view | view_export  (never approve/lock)
  armed: boolean("armed").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const accessLog = pgTable("access_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actorType: text("actor_type").notNull(), // operator | review_token | system
  actorId: text("actor_id"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const modelCalls = pgTable("model_calls", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  runId: uuid("run_id").references(() => pipelineRuns.id),
  step: text("step").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheWriteTokens: integer("cache_write_tokens"),
  costUsd: numeric("cost_usd", { precision: 8, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Shared with the Python worker: a durable SKIP LOCKED job queue. The worker
 * pulls jobs; the portal seeds them from the extraction step.
 */
export const extractionJobs = pgTable(
  "extraction_jobs",
  {
    jobId: text("job_id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    submit: jsonb("submit").notNull(), // ExtractionJobSubmit
    status: text("status").notNull().default("queued"),
    progress: jsonb("progress"),
    resultPointer: jsonb("result_pointer"),
    error: jsonb("error"),
    attempts: integer("attempts").notNull().default(0),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("extraction_jobs_status_idx").on(t.status, t.updatedAt)],
);

/** Unused since the switch to password auth (was Auth.js's magic-link verification-token store); left in place, no code writes to it anymore. */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("verification_tokens_pk").on(t.identifier, t.token)],
);
