import { and, desc, eq } from "drizzle-orm";
import { requireOperator } from "../../../../../lib/authz";
import { getPrivate } from "../../../../../lib/blob";
import { db, schema } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

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

  return Response.json({
    dnaId: dna.dna_id ?? null,
    revision: dna.revision ?? 1,
    confidence: confidence.overall ?? null,
    flags: confidence.flags ?? [],
    theme,
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
