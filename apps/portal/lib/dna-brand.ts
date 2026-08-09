/**
 * Persist operator brand accent color on the DesignDNA artifact.
 * Rebuild reads palette.roles.brand — live preview injects CSS vars without rebuild.
 */
import { and, desc, eq } from "drizzle-orm";
import { getPrivate, putPrivate } from "./blob";
import { db, schema } from "./db";
import { normalizeBrandHex } from "./live-brand-preview";

export class DnaBrandError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DnaBrandError";
    this.status = status;
  }
}

export type DnaBrandSnapshot = {
  brandHex: string;
  dnaId: string | null;
  revision: number;
  blobPath: string;
};

type PaletteRole = { hex?: string; provenance?: string; confidence?: number; [k: string]: unknown };

type DnaDoc = Record<string, unknown> & {
  dna_id?: string;
  revision?: number;
  human_edits?: unknown[];
  palette?: {
    roles?: Record<string, PaletteRole | undefined>;
    [k: string]: unknown;
  };
};

async function latestRun(projectId: string) {
  const [run] = await db()
    .select({ id: schema.pipelineRuns.id })
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, projectId))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  return run ?? null;
}

async function latestDnaArtifact(runId: string) {
  const [art] = await db()
    .select({
      id: schema.artifacts.id,
      blobPath: schema.artifacts.blobPath,
      meta: schema.artifacts.meta,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, runId), eq(schema.artifacts.kind, "design_dna")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  return art ?? null;
}

function roleHex(dna: DnaDoc, role: string): string | null {
  const hex = dna.palette?.roles?.[role]?.hex;
  return typeof hex === "string" ? normalizeBrandHex(hex) : null;
}

/**
 * Update palette.roles.brand (and matching accent / footer-accent) on DesignDNA.
 * Does not rebuild the site draft — caller may rebuild separately.
 */
export async function persistProjectBrandColor(opts: {
  projectId: string;
  brandHex: string;
  by: string;
}): Promise<DnaBrandSnapshot> {
  const brandHex = normalizeBrandHex(opts.brandHex);
  if (!brandHex) throw new DnaBrandError("invalid brand hex (expected #RRGGBB)", 400);

  const run = await latestRun(opts.projectId);
  if (!run) throw new DnaBrandError("no pipeline run for this project", 404);

  const art = await latestDnaArtifact(run.id);
  if (!art) throw new DnaBrandError("no design DNA artifact yet", 404);

  const dna = JSON.parse((await getPrivate(art.blobPath)).toString("utf8")) as DnaDoc;
  const from = roleHex(dna, "brand");

  if (!dna.palette || typeof dna.palette !== "object") dna.palette = {};
  if (!dna.palette.roles || typeof dna.palette.roles !== "object") dna.palette.roles = {};

  const roles = dna.palette.roles;
  const prevBrand = roles.brand ?? {};
  roles.brand = {
    ...prevBrand,
    hex: brandHex,
    provenance: "operator",
    confidence: typeof prevBrand.confidence === "number" ? prevBrand.confidence : 1,
  };

  // Keep footer / accent chrome aligned when they tracked the prior brand (or are unset).
  const accentHex = roleHex(dna, "accent");
  if (!accentHex || (from && accentHex === from)) {
    roles.accent = { ...(roles.accent ?? {}), hex: brandHex, provenance: "operator" };
  }
  const footerHex = roleHex(dna, "footer-accent");
  if (!footerHex || (from && footerHex === from)) {
    roles["footer-accent"] = {
      ...(roles["footer-accent"] ?? {}),
      hex: brandHex,
      provenance: "operator",
    };
  }

  if (from !== brandHex) {
    const edits = Array.isArray(dna.human_edits) ? [...dna.human_edits] : [];
    edits.push({
      path: "palette.roles.brand.hex",
      from,
      to: brandHex,
      by: opts.by,
      at: new Date().toISOString(),
    });
    dna.human_edits = edits;
    dna.revision = (typeof dna.revision === "number" ? dna.revision : 1) + 1;
  }

  const body = JSON.stringify(dna, null, 2);
  await putPrivate(art.blobPath, body, "application/json");

  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(body).digest("hex");
  await db()
    .update(schema.artifacts)
    .set({
      sha256,
      bytes: Buffer.byteLength(body),
      meta: {
        ...((art.meta as object) ?? {}),
        brand_hex: brandHex,
        revision: dna.revision,
      },
    })
    .where(eq(schema.artifacts.id, art.id));

  return {
    brandHex,
    dnaId: typeof dna.dna_id === "string" ? dna.dna_id : null,
    revision: typeof dna.revision === "number" ? dna.revision : 1,
    blobPath: art.blobPath,
  };
}
