import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { getPrivate, putPrivate, sha256 } from "./blob";
import { db, schema } from "./db";
import { loadPublishSignoff } from "./publish-signoff";

export class ExportSignedDraftError extends Error {
  constructor(
    message: string,
    readonly status: number = 409,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ExportSignedDraftError";
  }
}

type DraftMeta = {
  prefix?: string;
  entrypoint?: string;
  pages?: Array<{ path: string; title?: string }>;
  files?: string[];
  gateA?: string;
  gateB?: string;
  corporateReliability?: string;
  company?: string;
  brandLogo?: boolean;
  brandBanner?: boolean;
  draftId?: string;
  sitePlanId?: string;
  blueprintVersionId?: string;
  pdfBundled?: boolean;
};

export type DeliveryZipResult = {
  bundleId: string;
  zipPath: string;
  manifestPath: string;
  zipBytes: number;
  draftVersion: number;
  draftId: string;
  downloadUrl: string;
  created: boolean;
  signed: boolean;
};

const TEXT_EXT = /\.(html?|css|js|mjs|json|md|txt|svg|csv|xml)$/i;

async function latestExportMetaForRun(runId: string): Promise<{
  zipPath?: string;
  draftId?: string;
  draftVersion?: number;
} | null> {
  const [art] = await db()
    .select({ meta: schema.artifacts.meta })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, runId), eq(schema.artifacts.kind, "export_bundle")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  return (art?.meta as { zipPath?: string; draftId?: string; draftVersion?: number } | null) ?? null;
}

/**
 * Ensure a client-delivery zip exists for the current draft when publish is
 * allowed (Gate A/B + reliability). Prefer an existing zip for this draft;
 * otherwise materialize one. Sign-off is required only when `requireSignoff`.
 */
export async function ensureDeliveryZip(opts: {
  projectId: string;
  actorUserId: string;
  actorEmail?: string;
  /** Default true — Approve & export / post-signoff path. */
  requireSignoff?: boolean;
}): Promise<DeliveryZipResult> {
  const requireSignoff = opts.requireSignoff !== false;
  const { projectId, actorUserId, actorEmail } = opts;

  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) throw new ExportSignedDraftError("no pipeline run for project", 404);

  const [art] = await db()
    .select({
      id: schema.artifacts.id,
      version: schema.artifacts.version,
      meta: schema.artifacts.meta,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "site_plan")))
    .orderBy(desc(schema.artifacts.version), desc(schema.artifacts.createdAt))
    .limit(1);
  if (!art) throw new ExportSignedDraftError("no multipage site draft yet", 404);

  const meta = (art.meta ?? {}) as DraftMeta;
  const prefix = meta.prefix;
  let draftManifest: Record<string, unknown> = {};
  if (prefix) {
    try {
      draftManifest = JSON.parse(
        (await getPrivate(`${prefix}/_meta/draft.json`)).toString("utf8"),
      ) as Record<string, unknown>;
    } catch {
      draftManifest = {};
    }
  }
  const draftId =
    (typeof draftManifest.draft_id === "string" && draftManifest.draft_id) ||
    meta.draftId ||
    art.id;
  const draftVersion =
    (typeof draftManifest.version === "number" && draftManifest.version) || art.version;

  const existing = await latestExportMetaForRun(run.id);
  if (
    existing?.zipPath &&
    (existing.draftId === draftId || existing.draftVersion === draftVersion)
  ) {
    try {
      const bytes = await getPrivate(existing.zipPath);
      return {
        bundleId: existing.zipPath.split("/").pop()?.replace(/\.zip$/, "") ?? "existing",
        zipPath: existing.zipPath,
        manifestPath: existing.zipPath.replace(/\.zip$/, ".json"),
        zipBytes: bytes.byteLength,
        draftVersion,
        draftId,
        downloadUrl: `/api/projects/${projectId}/export`,
        created: false,
        signed: true,
      };
    } catch {
      /* missing blob — rebuild below */
    }
  }

  return exportSignedDraft({
    projectId,
    actorUserId,
    actorEmail,
    requireSignoff,
  });
}

/**
 * Zip the current multipage site draft with the IR/CFO publish sign-off
 * embedded in `_meta/export.json`. Works without a live workflow review hook
 * (needed after offline rebuilds leave status `in_review` on a completed run).
 *
 * When `requireSignoff` is false, still requires Gate A/B + reliability (publish
 * allowed) so GET /export can materialize a delivery zip before Approve is clicked.
 */
export async function exportSignedDraft(opts: {
  projectId: string;
  actorUserId: string;
  actorEmail?: string;
  requireSignoff?: boolean;
}): Promise<DeliveryZipResult> {
  const { projectId, actorUserId, actorEmail } = opts;
  const requireSignoff = opts.requireSignoff !== false;

  const [project] = await db()
    .select({
      companyName: schema.projects.companyName,
      periodLabel: schema.projects.periodLabel,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) throw new ExportSignedDraftError("project not found", 404);

  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) throw new ExportSignedDraftError("no pipeline run for project", 404);

  const [art] = await db()
    .select({
      id: schema.artifacts.id,
      version: schema.artifacts.version,
      meta: schema.artifacts.meta,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "site_plan")))
    .orderBy(desc(schema.artifacts.version), desc(schema.artifacts.createdAt))
    .limit(1);
  if (!art) throw new ExportSignedDraftError("no multipage site draft yet", 404);

  const meta = (art.meta ?? {}) as DraftMeta;
  const prefix = meta.prefix;
  if (!prefix) throw new ExportSignedDraftError("site draft missing blob prefix", 409);

  let draftManifest: Record<string, unknown> = {};
  try {
    draftManifest = JSON.parse(
      (await getPrivate(`${prefix}/_meta/draft.json`)).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    draftManifest = {};
  }

  const draftId =
    (typeof draftManifest.draft_id === "string" && draftManifest.draft_id) ||
    meta.draftId ||
    art.id;
  const draftVersion =
    (typeof draftManifest.version === "number" && draftManifest.version) || art.version;
  const files =
    (Array.isArray(draftManifest.files) ? (draftManifest.files as string[]) : null) ??
    meta.files ??
    [];
  if (!files.length) {
    throw new ExportSignedDraftError("site draft has no files to export", 409);
  }

  const gateA =
    (draftManifest.gate_a as { status?: string } | undefined)?.status ?? meta.gateA ?? null;
  const gateB =
    (draftManifest.gate_b as { status?: string } | undefined)?.status ?? meta.gateB ?? null;
  const corporateReliability =
    (typeof draftManifest.corporate_reliability === "string" &&
      draftManifest.corporate_reliability) ||
    meta.corporateReliability ||
    null;

  if (gateA !== "pass" || gateB !== "pass" || corporateReliability !== "pass") {
    throw new ExportSignedDraftError(
      `Export blocked — Gate A/B or corporate reliability failed (A=${gateA} B=${gateB} reliability=${corporateReliability})`,
      409,
      { gateA, gateB, corporateReliability },
    );
  }

  const publishSignoff = await loadPublishSignoff(projectId);
  if (requireSignoff) {
    if (!publishSignoff) {
      throw new ExportSignedDraftError(
        "Publish sign-off required — complete Sign off for publish before Approve & export",
        409,
      );
    }
    const signoffMatches =
      publishSignoff.draft_id === draftId || publishSignoff.draft_version === draftVersion;
    if (!signoffMatches) {
      throw new ExportSignedDraftError(
        `Publish sign-off is stale (signed draft v${publishSignoff.draft_version}, current v${draftVersion}) — re-sign before export`,
        409,
        {
          signedDraftId: publishSignoff.draft_id,
          signedDraftVersion: publishSignoff.draft_version,
          currentDraftId: draftId,
          currentDraftVersion: draftVersion,
        },
      );
    }
  } else if (publishSignoff) {
    const signoffMatches =
      publishSignoff.draft_id === draftId || publishSignoff.draft_version === draftVersion;
    if (!signoffMatches) {
      // Stale sign-off: still allow a gate-green delivery zip for the current draft.
    }
  }

  const signed =
    Boolean(publishSignoff) &&
    (publishSignoff!.draft_id === draftId || publishSignoff!.draft_version === draftVersion);

  const bundleId = `exp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const zipInput: Record<string, Uint8Array> = {};

  for (const rel of files) {
    const path = rel.replace(/^\.\//, "");
    const bytes = await getPrivate(`${prefix}/${path}`);
    if (TEXT_EXT.test(path) || path === "README.md") {
      zipInput[path] = strToU8(bytes.toString("utf8"));
    } else {
      zipInput[path] = new Uint8Array(bytes);
    }
  }

  let draftPack: Record<string, unknown> = {};
  try {
    const raw = zipInput["_meta/export.json"];
    if (raw) {
      draftPack = JSON.parse(Buffer.from(raw).toString("utf8")) as Record<string, unknown>;
    }
  } catch {
    draftPack = {};
  }

  const pages =
    (Array.isArray(draftManifest.pages)
      ? (draftManifest.pages as Array<{ path: string; title?: string }>)
      : null) ??
    meta.pages ??
    [];
  const company =
    (typeof draftManifest.company === "string" && draftManifest.company) ||
    meta.company ||
    project.companyName;
  const periodLabel =
    (typeof draftManifest.period_label === "string" && draftManifest.period_label) ||
    project.periodLabel ||
    "";

  const exportMeta = {
    ...draftPack,
    schema_version: "multipage-export/1",
    pack: "client-delivery",
    bundle_id: bundleId,
    project_id: projectId,
    run_id: run.id,
    company,
    company_source: draftManifest.company_source ?? null,
    portal_company_name: project.companyName ?? null,
    period_label: periodLabel,
    site_plan_id: draftManifest.site_plan_id ?? meta.sitePlanId ?? null,
    blueprint_version_id: draftManifest.blueprint_version_id ?? meta.blueprintVersionId ?? null,
    draft_id: draftId,
    draft_version: draftVersion,
    refinement_mode: "multipage_draft",
    created_at: new Date().toISOString(),
    signed_off_by: signed
      ? (actorEmail ?? actorUserId)
      : null,
    publish_signoff: signed && publishSignoff
      ? {
          by: publishSignoff.signed_off_by_email ?? publishSignoff.signed_off_by,
          at: publishSignoff.signed_off_at,
          draft_id: publishSignoff.draft_id,
          draft_version: publishSignoff.draft_version,
          checklist: publishSignoff.checklist,
        }
      : null,
    entrypoint: (draftManifest.entrypoint as string) || meta.entrypoint || "index.html",
    mode: "multipage",
    gate_a: gateA,
    gate_b: gateB,
    corporate_reliability: "pass",
    files,
    pages,
    pdf_bundled:
      typeof draftManifest.pdf_bundled === "boolean"
        ? draftManifest.pdf_bundled
        : Boolean(meta.pdfBundled),
    brand_logo:
      typeof draftManifest.brand_logo === "boolean"
        ? draftManifest.brand_logo
        : Boolean(meta.brandLogo),
    brand_banner:
      typeof draftManifest.brand_banner === "boolean"
        ? draftManifest.brand_banner
        : Boolean(meta.brandBanner),
    hosting: draftPack.hosting ?? {
      offline: "Unzip and open index.html in a modern browser",
      static_host:
        "Upload the unzipped folder as a static site root; default document index.html; no server runtime",
    },
    exported_via: signed ? "exportSignedDraft" : "ensureDeliveryZip",
  };

  zipInput["_meta/export.json"] = strToU8(JSON.stringify(exportMeta, null, 2));

  const zipBytes = zipSync(zipInput, { level: 6 });
  const zipBuf = Buffer.from(zipBytes);
  const zipDigest = await sha256(zipBuf);
  const zipPath = `runs/${run.id}/exports/${bundleId}.zip`;
  const zipPut = await putPrivate(zipPath, zipBuf, "application/zip");

  const manifestPath = `runs/${run.id}/exports/${bundleId}.json`;
  const manifestBody = JSON.stringify({
    ...exportMeta,
    zip: { blob_path: zipPut.blob_path, sha256: zipDigest, bytes: zipBuf.byteLength },
  });
  const manifestPut = await putPrivate(manifestPath, manifestBody, "application/json");

  const [prevExport] = await db()
    .select({ version: schema.artifacts.version })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "export_bundle")))
    .orderBy(desc(schema.artifacts.version))
    .limit(1);
  const exportVersion = (prevExport?.version ?? 0) + 1;

  await db().insert(schema.artifacts).values({
    runId: run.id,
    kind: "export_bundle",
    version: exportVersion,
    blobPath: manifestPut.blob_path,
    sha256: manifestPut.sha256,
    bytes: manifestPut.bytes,
    contentType: "application/json",
    meta: {
      bundleId,
      zipPath: zipPut.blob_path,
      zipBytes: zipBuf.byteLength,
      entrypoint: "index.html",
      mode: "multipage",
      draftId,
      draftVersion,
      fileCount: files.length,
      files: files.filter((p) => p.endsWith(".html")),
      pages,
      gateA,
      gateB,
      exportedVia: signed ? "exportSignedDraft" : "ensureDeliveryZip",
      signed,
    },
  });

  if (signed) {
    await db()
      .update(schema.projects)
      .set({ status: "exported", updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));

    await db().insert(schema.runEvents).values({
      runId: run.id,
      type: "run.completed",
      payload: {
        bundleId,
        draftId,
        draftVersion,
        via: "exportSignedDraft",
        actor: actorEmail ?? actorUserId,
      },
      actorId: null,
    });

    await db().insert(schema.approvals).values({
      projectId,
      action: "approve_export",
      actorUserId: null,
      actorRole: "operator",
      note: JSON.stringify({
        by: actorEmail ?? actorUserId,
        bundleId,
        draftId,
        draftVersion,
        at: exportMeta.created_at,
      }),
    });
  } else {
    await db().insert(schema.runEvents).values({
      runId: run.id,
      type: "export.draft_zip",
      payload: {
        bundleId,
        draftId,
        draftVersion,
        via: "ensureDeliveryZip",
        actor: actorEmail ?? actorUserId,
      },
      actorId: null,
    });
  }

  return {
    bundleId,
    zipPath: zipPut.blob_path,
    manifestPath: manifestPut.blob_path,
    zipBytes: zipBuf.byteLength,
    draftVersion,
    draftId,
    downloadUrl: `/api/projects/${projectId}/export`,
    created: true,
    signed,
  };
}
