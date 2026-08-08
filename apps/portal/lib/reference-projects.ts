/**
 * Golden / reference projects for IR multipage v1.
 *
 * These mark known-good issuer packs used for regression and demos.
 * Their DNA + Brand kit drive gold/olive (or other) styling — they are NOT
 * the global portal theme and must not be cloned onto other issuers.
 */

export const DRDGOLD_REFERENCE_PROJECT = {
  id: "444cd443-97cc-4b9c-b0f6-eef4f65c2f98",
  slug: "DRD Gold 1",
  legalName: "DRDGOLD",
  label: "DRDGOLD HY1 FY2026 — IR multipage v1 reference",
  note: "Reference project only. Brand look comes from this project's DesignDNA + Brand kit, not from render fallbacks.",
} as const;

const REFERENCE_IDS = new Set<string>([DRDGOLD_REFERENCE_PROJECT.id]);

/** Company-name matchers for the DRDGOLD reference issuer (legal or portal slug). */
const DRDGOLD_NAME_RE = /\bdrd\s*gold\b|\bdrdgold\b/i;

export function isDrdgoldReferenceProject(opts: {
  projectId?: string | null;
  company?: string | null;
}): boolean {
  if (opts.projectId && REFERENCE_IDS.has(opts.projectId)) return true;
  const name = opts.company?.trim() ?? "";
  return name.length > 0 && DRDGOLD_NAME_RE.test(name);
}

export function isReferenceProject(projectId: string): boolean {
  return REFERENCE_IDS.has(projectId);
}
