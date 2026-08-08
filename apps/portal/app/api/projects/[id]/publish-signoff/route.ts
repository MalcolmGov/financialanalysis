import { and, desc, eq } from "drizzle-orm";
import { looksLikeProjectSlug } from "@rs/render";
import { requireOperator, logAccess } from "../../../../../lib/authz";
import { getPrivate, putPrivate } from "../../../../../lib/blob";
import { loadProjectBrandKit, brandOrigins, applyClientBrandKit } from "../../../../../lib/brand-kit";
import { pickBrandAssets } from "../../../../../lib/brand-assets";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import {
  buildPublishChecklist,
  canSignOffPublish,
  checklistBlockers,
  loadPublishSignoff,
  savePublishSignoff,
} from "../../../../../lib/publish-signoff";

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
  fileCount?: number;
  pdfBundled?: boolean;
};

async function loadDraftContext(projectId: string) {
  const [project] = await db()
    .select({
      companyName: schema.projects.companyName,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) return null;

  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) return { project, run: null, art: null, meta: null as DraftMeta | null, manifest: null };

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

  const meta = (art?.meta ?? {}) as DraftMeta;
  let manifest: Record<string, unknown> | null = null;
  if (meta.prefix) {
    try {
      manifest = JSON.parse(
        (await getPrivate(`${meta.prefix}/_meta/draft.json`)).toString("utf8"),
      ) as Record<string, unknown>;
    } catch {
      manifest = null;
    }
  }

  return { project, run, art, meta, manifest };
}

async function readinessFromDraft(projectId: string) {
  const ctx = await loadDraftContext(projectId);
  if (!ctx?.art) {
    return { error: "no multipage site draft yet", status: 404 as const };
  }

  const m = ctx.manifest ?? {};
  const meta = ctx.meta;
  const pages = (meta.pages?.length ? meta.pages : []) as Array<{ path: string; title?: string }>;
  const files =
    (Array.isArray(m.files) ? (m.files as string[]) : meta.files) ??
    pages.map((p) => p.path);

  const kit = await loadProjectBrandKit(projectId);
  let logoOrigin: string | null = null;
  let bannerOrigin: string | null = null;
  try {
    const [extArt] = await db()
      .select({ blobPath: schema.artifacts.blobPath })
      .from(schema.artifacts)
      .where(
        and(eq(schema.artifacts.runId, ctx.run!.id), eq(schema.artifacts.kind, "extraction_result")),
      )
      .orderBy(desc(schema.artifacts.createdAt))
      .limit(1);
    if (extArt) {
      const extraction = JSON.parse((await getPrivate(extArt.blobPath)).toString("utf8"));
      const bundle = applyClientBrandKit(pickBrandAssets(extraction, projectId), kit);
      const o = brandOrigins(bundle);
      logoOrigin = o.logoOrigin;
      bannerOrigin = o.bannerOrigin;
    } else if (kit) {
      const o = brandOrigins(
        applyClientBrandKit(
          {
            schema_version: "assets/1",
            project_id: projectId,
            assets: [],
            embed_budget_bytes: 1_500_000,
          },
          kit,
        ),
      );
      logoOrigin = o.logoOrigin;
      bannerOrigin = o.bannerOrigin;
    }
  } catch {
    /* origins optional */
  }

  const company =
    (typeof m.company === "string" && m.company) ||
    meta.company ||
    null;
  const corporateReliability =
    (typeof m.corporate_reliability === "string" && m.corporate_reliability) ||
    meta.corporateReliability ||
    null;
  const brandLogo =
    typeof m.brand_logo === "boolean"
      ? m.brand_logo
      : Boolean(meta.brandLogo ?? logoOrigin);
  const brandBanner =
    typeof m.brand_banner === "boolean"
      ? m.brand_banner
      : Boolean(meta.brandBanner ?? bannerOrigin);

  const checklist = buildPublishChecklist({
    projectId,
    draftId: meta.draftId ?? ctx.art.id,
    draftVersion: ctx.art.version,
    gateA: (m.gate_a as { status?: string } | undefined)?.status ?? meta.gateA ?? null,
    gateB: (m.gate_b as { status?: string } | undefined)?.status ?? meta.gateB ?? null,
    corporateReliability,
    company,
    companyLooksLikeSlug: company ? looksLikeProjectSlug(company) : true,
    brandLogo,
    brandBanner,
    logoOrigin,
    bannerOrigin,
    pages,
    files,
    pdfBundled:
      typeof m.pdf_bundled === "boolean" ? m.pdf_bundled : meta.pdfBundled,
    excelPresent: files.some((f) => /\.xlsx$/i.test(f)),
  });

  const blockers = checklistBlockers(checklist);
  const existing = await loadPublishSignoff(projectId);
  const signoffMatchesDraft =
    existing?.draft_id === (meta.draftId ?? ctx.art.id) ||
    existing?.draft_version === ctx.art.version;

  return {
    status: 200 as const,
    payload: {
      draftId: meta.draftId ?? ctx.art.id,
      draftVersion: ctx.art.version,
      projectStatus: ctx.project.status,
      company,
      gateA: checklist.find((c) => c.id === "gate_a")?.detail ?? meta.gateA,
      gateB: checklist.find((c) => c.id === "gate_b")?.detail ?? meta.gateB,
      corporateReliability,
      checklist,
      blockers,
      canSignOff: canSignOffPublish(checklist),
      signoff: signoffMatchesDraft ? existing : null,
      signoffStale: Boolean(existing && !signoffMatchesDraft),
      brand: {
        logoOrigin,
        bannerOrigin,
        clientLogo: Boolean(kit?.logo),
        clientHero: Boolean(kit?.hero),
      },
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  if (env.MOCK_BLOB) {
    return Response.json({ error: "unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const result = await readinessFromDraft(projectId);
  if (result.status !== 200) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result.payload);
}

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
    return Response.json({ error: "unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  if (!body.confirm) {
    return Response.json({ error: "confirm: true required" }, { status: 400 });
  }

  const result = await readinessFromDraft(projectId);
  if (result.status !== 200) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  const { payload } = result;
  if (!payload.canSignOff) {
    return Response.json(
      {
        error: "Publish sign-off blocked — critical checklist items failed",
        blockers: payload.blockers,
        checklist: payload.checklist,
      },
      { status: 409 },
    );
  }

  const signoff = await savePublishSignoff({
    schema_version: "publish-signoff/1",
    project_id: projectId,
    draft_id: payload.draftId,
    draft_version: payload.draftVersion,
    signed_off_by: operator.id,
    signed_off_by_email: operator.email,
    signed_off_at: new Date().toISOString(),
    checklist: payload.checklist,
    blockers: [],
    corporate_reliability: payload.corporateReliability === "pass" ? "pass" : "fail",
    gate_a: String(payload.gateA ?? ""),
    gate_b: String(payload.gateB ?? ""),
    company: payload.company ?? undefined,
    brand_logo: Boolean(payload.brand.clientLogo || payload.brand.logoOrigin),
    brand_banner: Boolean(payload.brand.clientHero || payload.brand.bannerOrigin),
    logo_origin: payload.brand.logoOrigin ?? undefined,
    banner_origin: payload.brand.bannerOrigin ?? undefined,
  });

  // Persist on draft meta blob when available.
  const ctx = await loadDraftContext(projectId);
  if (ctx?.meta?.prefix) {
    try {
      await putPrivate(
        `${ctx.meta.prefix}/_meta/publish-signoff.json`,
        JSON.stringify(signoff, null, 2),
        "application/json",
      );
    } catch (err) {
      console.warn(`[publish-signoff] draft meta write failed:`, err);
    }
  }

  await db().insert(schema.approvals).values({
    projectId,
    action: "publish_signoff",
    actorUserId: null,
    actorRole: "operator",
    note: JSON.stringify({
      by: operator.email,
      draftId: signoff.draft_id,
      draftVersion: signoff.draft_version,
      at: signoff.signed_off_at,
    }),
  });

  await logAccess("operator", operator.id, "publish_signoff", `project:${projectId}`);

  return Response.json({ ok: true, signoff });
}
