import { and, desc, eq } from "drizzle-orm";
import { requireOperator } from "../../../../../lib/authz";
import { getPrivate } from "../../../../../lib/blob";
import {
  applyClientBrandKit,
  brandOrigins,
  loadProjectBrandKit,
  upsertBrandKitAssets,
} from "../../../../../lib/brand-kit";
import { pickBrandAssets } from "../../../../../lib/brand-assets";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

function toBlobUrl(path: string): string {
  return `/api/blob/${path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

async function latestExtraction(projectId: string) {
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const [art] = await db()
    .select({ blobPath: schema.artifacts.blobPath })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "extraction_result")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  if (!art) return null;
  try {
    return JSON.parse((await getPrivate(art.blobPath)).toString("utf8"));
  } catch {
    return null;
  }
}

/** Operator brand kit — official logo (SVG/PNG) + full-bleed hero photo. */
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
    return Response.json({ error: "brand kit unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const [project] = await db()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  const kit = await loadProjectBrandKit(projectId);
  const extraction = await latestExtraction(projectId);
  let effective = kit
    ? applyClientBrandKit(
        extraction
          ? pickBrandAssets(extraction, projectId)
          : {
              schema_version: "assets/1" as const,
              project_id: projectId,
              assets: [],
              embed_budget_bytes: 1_500_000,
            },
        kit,
      )
    : extraction
      ? pickBrandAssets(extraction, projectId)
      : null;
  const origins = brandOrigins(effective);

  return Response.json({
    kit: kit ?? {
      schema_version: "brand-kit/1",
      project_id: projectId,
      logo: null,
      hero: null,
      updated_at: null,
    },
    logoPreviewUrl: kit?.logo?.blob_path ? toBlobUrl(kit.logo.blob_path) : null,
    heroPreviewUrl: kit?.hero?.blob_path ? toBlobUrl(kit.hero.blob_path) : null,
    extractionLogo: Boolean(
      effective?.assets.some((a) => a.role === "logo" && !a.origin?.startsWith("client_upload")),
    ),
    extractionBanner: Boolean(
      effective?.assets.some((a) => a.role === "banner" && !a.origin?.startsWith("client_upload")),
    ),
    effective: {
      logoOrigin: origins.logoOrigin,
      bannerOrigin: origins.bannerOrigin,
      logoIsClient: origins.logoIsClient,
      bannerIsClient: origins.bannerIsClient,
      logoIsSvg: origins.logoIsSvg,
      prefersClientLogo: origins.logoIsClient,
      prefersClientHero: origins.bannerIsClient,
    },
    note:
      "Client SVG/PNG logo and hero photo override extraction figures. Rebuild the site draft after uploading for preview.",
  });
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
    return Response.json({ error: "brand kit unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const [project] = await db()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  try {
    const form = await request.formData();
    const logoFile = form.get("logo");
    const heroFile = form.get("hero");

    const asUpload = async (value: FormDataEntryValue | null) => {
      if (!value || typeof value === "string") return null;
      const file = value as File;
      const buf = new Uint8Array(await file.arrayBuffer());
      return { bytes: buf, filename: file.name || "upload.bin", mime: file.type || null };
    };

    const logo = await asUpload(logoFile);
    const hero = await asUpload(heroFile);
    if (!logo && !hero) {
      return Response.json({ error: "provide logo and/or hero file" }, { status: 400 });
    }

    const kit = await upsertBrandKitAssets({
      projectId,
      actorEmail: operator.email,
      logo,
      hero,
    });

    return Response.json({
      ok: true,
      kit,
      logoPreviewUrl: kit.logo?.blob_path ? toBlobUrl(kit.logo.blob_path) : null,
      heroPreviewUrl: kit.hero?.blob_path ? toBlobUrl(kit.hero.blob_path) : null,
      rebuildHint: "Rebuild the multipage site draft to apply brand kit assets in preview/export.",
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
