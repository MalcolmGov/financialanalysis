import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireOperator } from "../../../../../lib/authz";
import { getPrivate } from "../../../../../lib/blob";
import { db, schema } from "../../../../../lib/db";
import {
  DnaBrandError,
  persistProjectBrandColor,
} from "../../../../../lib/dna-brand";
import { env } from "../../../../../lib/env";
import {
  IR_THEME_META,
  suggestIrThemeId,
  themeIdFromDna,
} from "../../../../../lib/ir-theme";
import {
  RebuildSiteDraftError,
  rebuildProjectSiteDraft,
} from "../../../../../lib/rebuild-site-draft";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  brandHex: z.string().min(4).max(9),
  /** Default false — live iframe preview updates instantly; Rebuild applies HTML. */
  rebuild: z.boolean().optional().default(false),
});

function noStore(data: unknown, init: { status?: number } = {}): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
    },
  });
}

/** Operator-facing Design DNA summary for the DNA approval gate. */
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
    return Response.json({ error: "DNA unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) {
    return Response.json({ error: "no pipeline run for this project" }, { status: 404 });
  }

  const [art] = await db()
    .select({
      blobPath: schema.artifacts.blobPath,
      meta: schema.artifacts.meta,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "design_dna")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  if (!art) {
    return Response.json({ error: "no design DNA artifact yet" }, { status: 404 });
  }

  let dna: Record<string, unknown>;
  try {
    dna = JSON.parse((await getPrivate(art.blobPath)).toString("utf8")) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "DNA blob missing from storage" }, { status: 404 });
  }

  const palette = (dna.palette ?? {}) as {
    roles?: Record<string, { hex?: string }>;
    measured?: { hex?: string }[];
  };
  const type = (dna.type ?? {}) as {
    stack?: { heading?: string; body?: string };
    heading_treatment?: { color?: string; case?: string; weight?: number };
    scale?: { web_base_px?: number; ratio?: number };
  };
  const theme = (dna.theme ?? {}) as { mode?: string; rationale?: string };
  const confidence = (dna.confidence ?? {}) as {
    overall?: number;
    flags?: { path: string; reason: string; confidence: number }[];
  };
  const table = (dna.table_style ?? {}) as {
    header_bg?: string;
    header_text?: string;
    header_case?: string;
    zebra?: boolean;
    numeric_alignment?: string;
    negative_format?: string;
  };
  const toneWords = Array.isArray(dna.tone_words) ? (dna.tone_words as string[]) : [];
  const components = Array.isArray(dna.components) ? (dna.components as { id: string }[]) : [];

  const roles = Object.entries(palette.roles ?? {}).map(([role, entry]) => ({
    role,
    hex: entry?.hex ?? "#000000",
    name: role,
  }));

  const [project] = await db()
    .select({
      companyName: schema.projects.companyName,
      periodLabel: schema.projects.periodLabel,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const themeId = themeIdFromDna(dna as { theme_id?: unknown });
  const suggested = suggestIrThemeId({
    company: project?.companyName,
    periodLabel: project?.periodLabel,
    toneWords,
    signals: [project?.companyName ?? "", project?.periodLabel ?? "", ...toneWords],
  });

  return Response.json({
    dnaId: dna.dna_id ?? null,
    revision: dna.revision ?? 1,
    confidence: confidence.overall ?? null,
    flags: confidence.flags ?? [],
    theme,
    themeId,
    suggestedThemeId: suggested.themeId,
    suggestReason: suggested.reason,
    themes: IR_THEME_META,
    toneWords,
    type: {
      heading: type.stack?.heading ?? null,
      body: type.stack?.body ?? null,
      headingTreatment: type.heading_treatment ?? null,
      webBasePx: type.scale?.web_base_px ?? null,
      ratio: type.scale?.ratio ?? null,
    },
    roles,
    measured: (palette.measured ?? []).slice(0, 12).map((c) => ({
      hex: c.hex ?? "#000000",
      name: c.hex ?? "?",
    })),
    tableStyle: {
      headerBg: table.header_bg ?? null,
      headerText: table.header_text ?? null,
      shading: table.zebra ? "zebra" : null,
      grid: table.numeric_alignment
        ? `${table.numeric_alignment} nums · ${table.negative_format ?? "minus"}`
        : null,
    },
    componentIds: components.map((c) => c.id).slice(0, 24),
    blobPath: art.blobPath,
  });
}

/**
 * Persist operator brand accent on DesignDNA (chrome only — no number changes).
 * Default rebuild=false so the console can debounce-save while live-updating the iframe.
 */
export async function PATCH(
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
    return noStore({ error: "DNA unavailable in MOCK_BLOB mode" }, { status: 404 });
  }

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch (err) {
    return noStore({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const snap = await persistProjectBrandColor({
      projectId,
      brandHex: body.brandHex,
      by: operator.email,
    });

    if (!body.rebuild) {
      return noStore({
        ok: true,
        brandHex: snap.brandHex,
        revision: snap.revision,
        rebuilt: false,
        rebuildHint:
          "Brand color saved on DNA. Live preview updates instantly; Rebuild applies it to exported HTML.",
      });
    }

    try {
      const draft = await rebuildProjectSiteDraft({
        projectId,
        note: `rebuilt after brand color → ${snap.brandHex} by ${operator.email}`,
        hardFailGates: true,
      });
      return noStore({
        ok: true,
        brandHex: snap.brandHex,
        revision: snap.revision,
        rebuilt: true,
        draft,
        rebuildHint: `Site draft rebuilt to v${draft.draftVersion} with brand ${snap.brandHex}.`,
      });
    } catch (err) {
      if (err instanceof RebuildSiteDraftError) {
        return noStore({
          ok: true,
          brandHex: snap.brandHex,
          revision: snap.revision,
          rebuilt: false,
          rebuildError: err.message,
          rebuildDetails: err.details ?? null,
          rebuildHint:
            "Brand color saved on DNA, but site draft rebuild failed. Retry Rebuild from the console.",
        });
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof DnaBrandError) {
      return noStore({ error: err.message }, { status: err.status });
    }
    console.error("dna brand patch failed:", err);
    return noStore({ error: (err as Error).message }, { status: 500 });
  }
}
