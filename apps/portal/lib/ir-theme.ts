/**
 * Portal helpers for IR theme presets (classic | editorial | statutory).
 * Persists theme_id on the DesignDNA artifact; rebuild reads it via buildMultipageExport.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  IR_THEME_META,
  inferDocKind,
  normalizeIrThemeId,
  suggestIrThemeId,
  themeIdFromDna,
  type IrThemeId,
} from "@rs/render";
import { getPrivate, putPrivate } from "./blob";
import { db, schema } from "./db";

export { IR_THEME_META, normalizeIrThemeId, suggestIrThemeId, themeIdFromDna };
export type { IrThemeId };

export class IrThemeError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "IrThemeError";
    this.status = status;
  }
}

export type DnaThemeSnapshot = {
  themeId: IrThemeId;
  suggestedThemeId: IrThemeId;
  suggestReason: string;
  dnaId: string | null;
  revision: number;
  blobPath: string;
  operatorOverride: boolean;
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
      version: schema.artifacts.version,
      meta: schema.artifacts.meta,
    })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, runId), eq(schema.artifacts.kind, "design_dna")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  return art ?? null;
}

function suggestFromContext(opts: {
  companyName?: string | null;
  periodLabel?: string | null;
  dna: Record<string, unknown>;
  extraction?: Record<string, unknown> | null;
}): ReturnType<typeof suggestIrThemeId> {
  const toneWords = Array.isArray(opts.dna.tone_words)
    ? (opts.dna.tone_words as string[])
    : [];
  const sectionKinds: string[] = [];
  const sectionTitles: string[] = [];
  const enrichment = opts.extraction?.enrichment as
    | { sections?: { kind?: string; title?: string }[] }
    | undefined;
  for (const s of enrichment?.sections ?? []) {
    if (s.kind) sectionKinds.push(s.kind);
    if (s.title) sectionTitles.push(s.title);
  }

  // Enrichment sections are title/page spans (no kind). Classify titles so
  // letter-less AFS (MTN/Spar) can suggest Statutory Hub instead of Classic.
  for (const title of sectionTitles) {
    const t = title.toLowerCase();
    if (/directors['']?\s*report/.test(t)) sectionKinds.push("directorsReport");
    else if (/independent\s+auditor|auditor'?s?\s+report/.test(t))
      sectionKinds.push("auditorReport");
    else if (/accounting\s+polic/.test(t)) sectionKinds.push("accountingPolicies");
    else if (/dear\s+shareholder|shareholder\s+letter|letter\s+to\s+shareholders/.test(t))
      sectionKinds.push("letter");
    else if (/review\s+of\s+operations|operating\s+review/.test(t))
      sectionKinds.push("reviewOfOperations");
  }

  const title =
    (opts.extraction?.source as { pdf_meta?: { title?: string } } | undefined)?.pdf_meta
      ?.title ?? "";
  const coverHints = [title, ...sectionTitles.slice(0, 12), opts.periodLabel ?? ""];
  let docKind: string | null = inferDocKind(coverHints, opts.periodLabel ?? "");
  if (!docKind) {
    const hay = coverHints.join(" ").toLowerCase();
    if (
      /annual\s+financial|afs\b|year\s+ended/.test(hay) &&
      !/interim|half[\s-]?year|hy\d/.test(hay)
    ) {
      docKind = "annual_audited";
    }
  }

  // Portal project titles for AFS demos (MTN / Spar) often omit "annual" —
  // treat known AFS issuer packs as annual when PDF title is empty too.
  const companyHay = `${opts.companyName ?? ""} ${opts.periodLabel ?? ""}`.toLowerCase();
  if (
    !docKind ||
    docKind === "interim_unaudited"
  ) {
    if (
      /\b(mtn|spar)\b/.test(companyHay) &&
      /year\s+ended|fy\s*20|annual|afs|31\s+december|26\s+september/.test(
        `${companyHay} ${title}`.toLowerCase(),
      )
    ) {
      docKind = "annual_audited";
    }
  }

  return suggestIrThemeId({
    company: opts.companyName,
    periodLabel: opts.periodLabel,
    docKind,
    toneWords,
    sectionKinds: [...new Set(sectionKinds)],
    signals: [
      title,
      ...toneWords,
      ...sectionTitles.slice(0, 8),
      opts.companyName ?? "",
      opts.periodLabel ?? "",
      docKind ?? "",
    ],
  });
}

/** Read current theme + soft suggestion for the console picker. */
export async function loadProjectTheme(projectId: string): Promise<DnaThemeSnapshot> {
  const [project] = await db()
    .select({
      companyName: schema.projects.companyName,
      periodLabel: schema.projects.periodLabel,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) throw new IrThemeError("project not found", 404);

  const run = await latestRun(projectId);
  if (!run) throw new IrThemeError("no pipeline run for this project", 404);

  const art = await latestDnaArtifact(run.id);
  if (!art) throw new IrThemeError("no design DNA artifact yet", 404);

  const dna = JSON.parse((await getPrivate(art.blobPath)).toString("utf8")) as Record<
    string,
    unknown
  >;

  let extraction: Record<string, unknown> | null = null;
  const [extArt] = await db()
    .select({ blobPath: schema.artifacts.blobPath })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, run.id), eq(schema.artifacts.kind, "extraction_result")))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  if (extArt) {
    try {
      extraction = JSON.parse((await getPrivate(extArt.blobPath)).toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      extraction = null;
    }
  }

  const suggested = suggestFromContext({
    companyName: project.companyName,
    periodLabel: project.periodLabel,
    dna,
    extraction,
  });
  const themeId = themeIdFromDna(dna as { theme_id?: unknown });
  const humanEdits = Array.isArray(dna.human_edits) ? dna.human_edits : [];
  const operatorOverride = humanEdits.some(
    (e) => (e as { path?: string }).path === "theme_id",
  );

  return {
    themeId,
    suggestedThemeId: suggested.themeId,
    suggestReason: suggested.reason,
    dnaId: typeof dna.dna_id === "string" ? dna.dna_id : null,
    revision: typeof dna.revision === "number" ? dna.revision : 1,
    blobPath: art.blobPath,
    operatorOverride,
  };
}

/**
 * Persist theme_id on the latest DesignDNA blob (bumps revision, appends human_edits).
 * Does not rebuild the site draft — caller may invoke rebuildProjectSiteDraft.
 */
export async function persistProjectTheme(opts: {
  projectId: string;
  themeId: IrThemeId | string;
  by: string;
}): Promise<DnaThemeSnapshot> {
  const themeId = normalizeIrThemeId(opts.themeId);
  const run = await latestRun(opts.projectId);
  if (!run) throw new IrThemeError("no pipeline run for this project", 404);

  const art = await latestDnaArtifact(run.id);
  if (!art) throw new IrThemeError("no design DNA artifact yet", 404);

  const dna = JSON.parse((await getPrivate(art.blobPath)).toString("utf8")) as Record<
    string,
    unknown
  > & {
    theme_id?: string;
    revision?: number;
    human_edits?: unknown[];
  };
  // Blob reads can be briefly stale after a prior write — never skip persist based
  // on a getPrivate comparison alone. Always stamp the operator-requested theme.
  const from = themeIdFromDna(dna);
  const now = new Date().toISOString();
  const edits = Array.isArray(dna.human_edits) ? [...dna.human_edits] : [];
  if (from !== themeId) {
    edits.push({
      path: "theme_id",
      from,
      to: themeId,
      by: opts.by,
      at: now,
    });
    dna.revision = (typeof dna.revision === "number" ? dna.revision : 1) + 1;
    dna.human_edits = edits;
  }
  dna.theme_id = themeId;

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
        theme_id: themeId,
        revision: dna.revision,
      },
    })
    .where(eq(schema.artifacts.id, art.id));

  // Prefer in-memory values after write — blob get can briefly return a stale object.
  const suggested = await loadProjectTheme(opts.projectId).catch(() => null);
  return {
    themeId,
    suggestedThemeId: suggested?.suggestedThemeId ?? themeId,
    suggestReason: suggested?.suggestReason ?? "",
    dnaId: typeof dna.dna_id === "string" ? dna.dna_id : null,
    revision: typeof dna.revision === "number" ? dna.revision : 1,
    blobPath: art.blobPath,
    operatorOverride: true,
  };
}
