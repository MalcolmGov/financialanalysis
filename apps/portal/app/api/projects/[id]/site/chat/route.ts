import { and, desc, eq } from "drizzle-orm";
import { requireOperator, logAccess } from "../../../../../../lib/authz";
import { MODELS, generateStructured } from "../../../../../../lib/anthropic";
import { getPrivate, putPrivate } from "../../../../../../lib/blob";
import { db, schema } from "../../../../../../lib/db";
import { env } from "../../../../../../lib/env";
import { recordModelCall } from "../../../../../../lib/ledger";
import {
  applyPatches,
  assertNumeralsUnchanged,
  NumeralGuardError,
  PatchApplyError,
  type RefinePatch,
} from "../../../../../../lib/refine";
import {
  SITE_CHAT_SCHEMA,
  SITE_CHAT_SYSTEM,
  buildSiteChatUserPayload,
  summarizeDnaForChat,
  truncateForModel,
  type SiteChatModelReply,
  type SiteChatTurn,
} from "../../../../../../lib/site-chat";

type PageMeta = { path: string; title: string };

function toBlobUrl(path: string): string {
  return `/api/blob/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

function contentTypeForPath(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain; charset=utf-8";
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes("\0")) return false;
  if (path.startsWith("/") || path.includes("..")) return false;
  if (path.includes("\\")) return false;
  return true;
}

/**
 * Operator chat against the multipage site draft.
 * Claude proposes surgical patches; we apply + persist to the draft prefix.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let operator;
  try {
    operator = await requireOperator();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  if (env.MOCK_BLOB) {
    return Response.json({ error: "site chat unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  let body: {
    message?: string;
    pagePath?: string;
    history?: SiteChatTurn[];
    allowNumberOverride?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  const pagePath = (body.pagePath ?? "").trim();
  const allowNumberOverride = Boolean(body.allowNumberOverride);
  const history = Array.isArray(body.history)
    ? body.history
        .filter(
          (t): t is SiteChatTurn =>
            !!t &&
            (t.role === "user" || t.role === "assistant") &&
            typeof t.content === "string",
        )
        .slice(-8)
        .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }))
    : [];

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  if (!pagePath || !isSafeRelativePath(pagePath)) {
    return Response.json({ error: "valid pagePath is required" }, { status: 400 });
  }

  const [project] = await db()
    .select({
      companyName: schema.projects.companyName,
      periodLabel: schema.projects.periodLabel,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) {
    return Response.json({ error: "no pipeline run for this project yet" }, { status: 404 });
  }

  const [art] = await db()
    .select({
      id: schema.artifacts.id,
      version: schema.artifacts.version,
      blobPath: schema.artifacts.blobPath,
      meta: schema.artifacts.meta,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "site_plan")))
    .orderBy(desc(schema.artifacts.version), desc(schema.artifacts.createdAt))
    .limit(1);

  if (!art) {
    return Response.json({ error: "no multipage site draft yet" }, { status: 404 });
  }

  const meta = (art.meta ?? {}) as {
    prefix?: string;
    entrypoint?: string;
    pages?: PageMeta[];
    files?: string[];
    gateA?: string;
    gateB?: string;
    draftId?: string;
    fileCount?: number;
    chatRevision?: number;
    /** Resolved legal / trading issuer — never the portal project slug. */
    company?: string;
    company_source?: string;
  };

  const prefix = meta.prefix;
  if (!prefix) {
    return Response.json({ error: "site draft missing storage prefix" }, { status: 409 });
  }

  const pages: PageMeta[] =
    meta.pages?.length ?
      meta.pages
    : (meta.files ?? [])
        .filter((p) => p.endsWith(".html") && !p.startsWith("prototype/"))
        .map((path) => ({
          path,
          title: path
            .replace(/\.html$/, "")
            .replace(/^financials\//, "")
            .replace(/[-_/]/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        }));

  if (!pages.some((p) => p.path === pagePath)) {
    return Response.json({ error: `pagePath not in draft: ${pagePath}` }, { status: 400 });
  }

  const chromeCandidates = ["assets/site.css", "assets/styles.css", "styles.css", "site.css"];
  const chromeFiles: { path: string; text: string }[] = [];
  for (const c of chromeCandidates) {
    try {
      const raw = (await getPrivate(`${prefix}/${c}`)).toString("utf8");
      chromeFiles.push({ path: c, text: truncateForModel(raw, 24_000).text });
    } catch {
      /* not present */
    }
  }
  const chromePaths = chromeFiles.map((f) => f.path);
  const allowedPaths = [...new Set([pagePath, ...chromePaths, ...pages.map((p) => p.path)])];

  let fileBytes: Buffer;
  try {
    fileBytes = await getPrivate(`${prefix}/${pagePath}`);
  } catch {
    return Response.json({ error: `could not load page ${pagePath}` }, { status: 404 });
  }
  const fileHtml = fileBytes.toString("utf8");
  const { text: htmlForModel, truncated: htmlTruncated } = truncateForModel(fileHtml);
  const chromeBlock =
    chromeFiles.length === 0
      ? ""
      : `\nSHARED CHROME FILES (patch these only for site-wide styles; copy search from the matching file):\n${chromeFiles
          .map((f) => `--- ${f.path} ---\n${f.text}`)
          .join("\n\n")}`;

  let dnaSummary = "(no design DNA on this run)";
  const [dnaArt] = await db()
    .select({ blobPath: schema.artifacts.blobPath })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "design_dna")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  if (dnaArt) {
    try {
      const dna = JSON.parse((await getPrivate(dnaArt.blobPath)).toString("utf8")) as Record<
        string,
        unknown
      >;
      dnaSummary = summarizeDnaForChat(dna);
    } catch {
      /* keep default */
    }
  }

  // Prefer draft issuer (DRDGOLD Limited) over portal project.title ("DRD Gold 1").
  const issuerName =
    (typeof meta.company === "string" && meta.company.trim()) ||
    project.companyName ||
    "Company";

  const userPayload = buildSiteChatUserPayload({
    company: issuerName,
    periodLabel: project.periodLabel ?? "",
    selectedPagePath: pagePath,
    allowedPaths,
    dnaSummary,
    gateA: meta.gateA ?? null,
    gateB: meta.gateB ?? null,
    fileHtml: `${htmlForModel}${chromeBlock}`,
    htmlTruncated,
    history,
    message,
    allowNumberOverride,
  });

  let modelReply: SiteChatModelReply;
  let usageCost = 0;
  try {
    const { data, usage } = await generateStructured<SiteChatModelReply>({
      model: MODELS.refine,
      system: SITE_CHAT_SYSTEM,
      messages: [{ role: "user", content: userPayload }],
      schema: SITE_CHAT_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 8000,
      effort: "medium",
    });
    modelReply = data;
    usageCost = usage.cost_usd;
    await recordModelCall({
      run_id: run.id,
      step: "site_chat",
      model: MODELS.refine,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_write_tokens: 0,
      cost_usd: usage.cost_usd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Claude request failed: ${msg}` }, { status: 502 });
  }

  const assistantMessage =
    typeof modelReply.message === "string" && modelReply.message.trim()
      ? modelReply.message.trim()
      : "Done.";
  const patches = Array.isArray(modelReply.patches) ? modelReply.patches : [];
  let targetPath =
    typeof modelReply.target_path === "string" && modelReply.target_path.trim()
      ? modelReply.target_path.trim()
      : pagePath;

  if (!isSafeRelativePath(targetPath) || !allowedPaths.includes(targetPath)) {
    return Response.json({
      message: `${assistantMessage}\n\n(No edits applied — model targeted an invalid path.)`,
      applied: false,
      patchesApplied: 0,
      targetPath: pagePath,
      needsNumberOverride: false,
      costUsd: usageCost,
    });
  }

  if (modelReply.number_change_requested && !allowNumberOverride) {
    const summary =
      modelReply.number_change_summary?.trim() ||
      "This request would change financial figures protected by Gate A/B.";
    return Response.json({
      message: `${assistantMessage}\n\nNumber change blocked: ${summary}\nConfirm with “allow number override” if you truly intend to change figures.`,
      applied: false,
      patchesApplied: 0,
      targetPath,
      needsNumberOverride: true,
      numberChangeSummary: summary,
      costUsd: usageCost,
    });
  }

  if (patches.length === 0) {
    await logAccess("operator", operator.id, "site_chat", `project:${projectId}`);
    return Response.json({
      message: assistantMessage,
      applied: false,
      patchesApplied: 0,
      targetPath,
      needsNumberOverride: false,
      costUsd: usageCost,
    });
  }

  // Load target file (may differ from selected page when editing chrome).
  let targetHtml = fileHtml;
  if (targetPath !== pagePath) {
    try {
      targetHtml = (await getPrivate(`${prefix}/${targetPath}`)).toString("utf8");
    } catch {
      return Response.json({
        message: `${assistantMessage}\n\n(No edits applied — could not load ${targetPath}.)`,
        applied: false,
        patchesApplied: 0,
        targetPath,
        needsNumberOverride: false,
        costUsd: usageCost,
      });
    }
  }

  let nextHtml = targetHtml;
  let appliedPatches: RefinePatch[] = patches;
  let lastErr: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let attemptPatches = appliedPatches;
    if (attempt === 1) {
      try {
        const retry = await generateStructured<SiteChatModelReply>({
          model: MODELS.refine,
          system: SITE_CHAT_SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                userPayload,
                `\nPREVIOUS APPLY FAILURE (fix and retry):\n${lastErr}`,
                `\nYour previous message was:\n${assistantMessage}`,
              ].join("\n"),
            },
          ],
          schema: SITE_CHAT_SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 8000,
          effort: "medium",
        });
        await recordModelCall({
          run_id: run.id,
          step: "site_chat_retry",
          model: MODELS.refine,
          input_tokens: retry.usage.input_tokens,
          output_tokens: retry.usage.output_tokens,
          cache_read_tokens: retry.usage.cache_read_tokens,
          cache_write_tokens: 0,
          cost_usd: retry.usage.cost_usd,
        });
        usageCost += retry.usage.cost_usd;
        attemptPatches = retry.data.patches ?? [];
        if (attemptPatches.length === 0) {
          return Response.json({
            message: `${retry.data.message?.trim() || assistantMessage}\n\n(Could not apply patches: ${lastErr})`,
            applied: false,
            patchesApplied: 0,
            targetPath,
            needsNumberOverride: false,
            costUsd: usageCost,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return Response.json({
          message: `${assistantMessage}\n\n(Could not apply patches: ${lastErr ?? msg})`,
          applied: false,
          patchesApplied: 0,
          targetPath,
          needsNumberOverride: false,
          costUsd: usageCost,
        });
      }
    }

    try {
      nextHtml = applyPatches(targetHtml, attemptPatches);
      appliedPatches = attemptPatches;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err instanceof PatchApplyError || err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        return Response.json({
          message: `${assistantMessage}\n\n(Could not apply patches: ${lastErr})`,
          applied: false,
          patchesApplied: 0,
          targetPath,
          needsNumberOverride: false,
          costUsd: usageCost,
        });
      }
    }
  }

  if (!allowNumberOverride) {
    try {
      assertNumeralsUnchanged(targetHtml, nextHtml!);
    } catch (err) {
      if (err instanceof NumeralGuardError) {
        return Response.json({
          message: `${assistantMessage}\n\nNumber integrity guard blocked this edit (missing=${err.missing.slice(0, 5).join(",") || "—"}; added=${err.added.slice(0, 5).join(",") || "—"}). Re-send with number override if intentional.`,
          applied: false,
          patchesApplied: 0,
          targetPath,
          needsNumberOverride: true,
          numberChangeSummary: err.message,
          costUsd: usageCost,
        });
      }
      throw err;
    }
  }

  await putPrivate(`${prefix}/${targetPath}`, nextHtml!, contentTypeForPath(targetPath));

  const chatRevision = (meta.chatRevision ?? 0) + 1;
  const bust = Date.now();
  await db()
    .update(schema.artifacts)
    .set({
      meta: {
        ...meta,
        chatRevision,
        lastChatAt: new Date().toISOString(),
        lastChatTarget: targetPath,
      },
    })
    .where(eq(schema.artifacts.id, art.id));

  await logAccess("operator", operator.id, "site_chat_apply", `project:${projectId}:${targetPath}`);

  const updatedPages = pages.map((p) => ({
    path: p.path,
    title: p.title,
    previewUrl: `${toBlobUrl(`${prefix}/${p.path}`)}?v=${bust}`,
  }));

  return Response.json({
    message: assistantMessage,
    applied: true,
    patchesApplied: appliedPatches.length,
    targetPath,
    chatRevision,
    previewBust: bust,
    needsNumberOverride: false,
    costUsd: usageCost,
    pages: updatedPages,
    gateA: meta.gateA ?? null,
    gateB: meta.gateB ?? null,
  });
}
