/**
 * P1 — resolve legal issuer name for published IR chrome.
 * Prefer DNA / extraction over portal project.title (e.g. "DRD Gold 1").
 */

import type { DesignDNA, ExtractionResult } from "@rs/contracts";

export type LegalCompanySource =
  | "client-brief"
  | "extraction-heading"
  | "extraction-enrichment"
  | "extraction-alias"
  | "dna-motif"
  | "pdf-meta"
  | "project"
  | "fallback";

export interface LegalCompanyResolution {
  company: string;
  source: LegalCompanySource;
  /** True when a project title was ignored as a slug / internal label. */
  ignoredProjectSlug?: string;
}

const LEGAL_SUFFIX =
  /\b(Limited|Ltd\.?|plc|Inc\.?|Incorporated|Corporation|Corp\.?|Group|Holdings|N\.?V\.?|S\.?A\.?|Pty\.?\s*Ltd\.?)\b/i;

const REPORT_TITLE =
  /\b(interim|results|annual|report|condensed|consolidated|unaudited|reviewed|financial|dividend|statement)\b/i;

/** Internal portal labels that must never appear in published chrome. */
export function looksLikeProjectSlug(name: string | null | undefined): boolean {
  const t = (name ?? "").trim();
  if (!t) return true;
  // Period / date lines are not project slugs (e.g. "… December 2025").
  if (/\b(19|20)\d{2}\b/.test(t) && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|month|ended|fy\d)/i.test(t)) {
    return false;
  }
  // Trailing short counters: "DRD Gold 1", "Acme 2" — not 4-digit years.
  if (/\s+\d{1,2}$/.test(t)) return true;
  if (/\b(copy|test|draft|demo|tmp|wip|sandbox|prototype)\b/i.test(t)) return true;
  if (/^project\b/i.test(t)) return true;
  if (/^[a-f0-9-]{8,}$/i.test(t)) return true;
  return false;
}

function cleanName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^['"“”‘’(]+|['"“”‘’)]+$/g, "")
    .trim();
}

function plausibleLegalName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = cleanName(raw);
  if (t.length < 2 || t.length > 80) return null;
  if (looksLikeProjectSlug(t)) return null;
  if (REPORT_TITLE.test(t) && !LEGAL_SUFFIX.test(t)) return null;
  // Prefer entity-shaped strings; allow short tickers/brands (DRDGOLD, 3M).
  if (LEGAL_SUFFIX.test(t)) return t;
  if (/^[A-Z0-9][A-Z0-9 .&'-]{1,40}$/.test(t) && !/\s{2,}/.test(t)) return t;
  if (/^[A-Za-z0-9][A-Za-z0-9 .&'-]{1,48}$/.test(t) && t.split(" ").length <= 6) {
    // Short brand without suffix — OK when not a report title.
    if (!REPORT_TITLE.test(t)) return t;
  }
  return null;
}

function walkBlocks(
  nodes: ExtractionResult["body"] | undefined,
  visit: (text: string, type: string) => void,
): void {
  if (!nodes?.length) return;
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.text) visit(n.text, n.type);
    if (n.children?.length) stack.push(...n.children);
  }
}

/** Issuer from early extraction headings / shareholder identity block. */
export function extractIssuerFromExtraction(
  extraction: ExtractionResult | null | undefined,
): { company: string; source: LegalCompanySource } | null {
  if (!extraction) return null;

  // 1) Enrichment section titles (e.g. "DRDGOLD Limited")
  for (const sec of extraction.enrichment?.sections ?? []) {
    const hit = plausibleLegalName(sec.title);
    if (hit && LEGAL_SUFFIX.test(hit)) {
      return { company: hit, source: "extraction-enrichment" };
    }
  }

  // 2) Body / furniture headings & short paragraphs early in the doc
  let headingHit: string | null = null;
  let aliasHit: string | null = null;
  let seen = 0;
  const visit = (text: string, type: string) => {
    if (seen > 80) return;
    seen += 1;
    const cleaned = cleanName(text);
    if (!headingHit && (type === "heading" || type === "paragraph")) {
      const hit = plausibleLegalName(cleaned);
      if (hit && (LEGAL_SUFFIX.test(hit) || cleaned === hit)) {
        // Prefer explicit legal suffix for heading path.
        if (LEGAL_SUFFIX.test(hit) || type === "heading") {
          if (!headingHit || LEGAL_SUFFIX.test(hit)) headingHit = hit;
        }
      }
    }
    // (' DRDGOLD ' or the ' Company ')
    if (!aliasHit) {
      const m = cleaned.match(
        /\(\s*['‘’"]\s*([A-Z0-9][A-Z0-9 .&'-]{1,40}?)\s*['‘’"]\s*or\s+the\s+['‘’"]\s*Company/i,
      );
      if (m?.[1]) {
        const a = plausibleLegalName(m[1]);
        if (a) aliasHit = a;
      }
    }
  };
  walkBlocks(extraction.furniture, visit);
  walkBlocks(extraction.body, visit);

  if (headingHit) return { company: headingHit, source: "extraction-heading" };
  if (aliasHit) return { company: aliasHit, source: "extraction-alias" };

  // 3) Any enrichment title that is a short brand (no suffix)
  for (const sec of extraction.enrichment?.sections ?? []) {
    const hit = plausibleLegalName(sec.title);
    if (hit) return { company: hit, source: "extraction-enrichment" };
  }

  return null;
}

/** Issuer hints from DesignDNA motifs (footer / logo notes). */
export function extractIssuerFromDna(
  dna: DesignDNA | null | undefined,
): string | null {
  if (!dna?.motifs?.length) return null;

  for (const m of dna.motifs) {
    if (m.kind === "logo" || m.id?.toLowerCase().includes("logo")) {
      const fromNotes = m.notes?.match(
        /\b([A-Z][A-Z0-9]+(?:\s+LIMITED|\s+LTD\.?)?)\b/,
      );
      if (fromNotes?.[1]) {
        const hit = plausibleLegalName(
          fromNotes[1].replace(/\s+LIMITED$/i, " Limited").replace(/\s+LTD\.?$/i, " Ltd"),
        );
        if (hit) return hit;
      }
      if (m.value) {
        const hit = plausibleLegalName(m.value);
        if (hit) return hit;
      }
    }
  }

  for (const m of dna.motifs) {
    if (m.kind !== "text" && !/footer|running/i.test(m.id ?? "")) continue;
    const value = m.value?.trim() ?? "";
    if (!value) continue;
    // "DRDGOLD Condensed Consolidated…" → DRDGOLD
    const first = value.split(/\s+/).slice(0, 3).join(" ");
    const tok = value.match(/^([A-Z][A-Z0-9]{1,24})\b/);
    if (tok?.[1] && !REPORT_TITLE.test(tok[1])) {
      const hit = plausibleLegalName(tok[1]);
      if (hit) return hit;
    }
    const withSuffix = first.match(
      /^([A-Za-z0-9][A-Za-z0-9 .&'-]{0,50}?\b(?:Limited|Ltd\.?|plc|Inc\.?))/i,
    );
    if (withSuffix?.[1]) {
      const hit = plausibleLegalName(withSuffix[1]);
      if (hit) return hit;
    }
  }

  return null;
}

export interface ResolveLegalCompanyInput {
  extraction?: ExtractionResult | null;
  dna?: DesignDNA | null;
  /** Portal projects.companyName — often an internal slug. */
  projectCompanyName?: string | null;
  /** ClientBrief.company_name when present. */
  clientBriefName?: string | null;
  fallback?: string;
}

/**
 * Resolve the legal / trading name for SiteChrome (nav, hero, footer, SEO).
 * Order: client brief → extraction → DNA → pdf meta → non-slug project → fallback.
 */
export function resolveLegalCompanyName(
  input: ResolveLegalCompanyInput,
): LegalCompanyResolution {
  const project = (input.projectCompanyName ?? "").trim();
  const ignored =
    project && looksLikeProjectSlug(project) ? project : undefined;

  const brief = plausibleLegalName(input.clientBriefName);
  if (brief) {
    return { company: brief, source: "client-brief", ignoredProjectSlug: ignored };
  }

  const fromExt = extractIssuerFromExtraction(input.extraction);
  if (fromExt) {
    return {
      company: fromExt.company,
      source: fromExt.source,
      ignoredProjectSlug: ignored,
    };
  }

  const fromDna = extractIssuerFromDna(input.dna);
  if (fromDna) {
    return { company: fromDna, source: "dna-motif", ignoredProjectSlug: ignored };
  }

  const pdfTitle = plausibleLegalName(input.extraction?.source?.pdf_meta?.title);
  if (pdfTitle) {
    return { company: pdfTitle, source: "pdf-meta", ignoredProjectSlug: ignored };
  }

  if (project && !looksLikeProjectSlug(project)) {
    return { company: project, source: "project" };
  }

  return {
    company: (input.fallback ?? "Company").trim() || "Company",
    source: "fallback",
    ignoredProjectSlug: ignored,
  };
}

/** Chrome identity regions that must not leak project slugs. */
export function extractChromeIdentityText(html: string): string {
  const chunks: string[] = [];
  const patterns = [
    /class="[^"]*nav-brand__name[^"]*"[^>]*>([^<]*)/gi,
    /class="[^"]*site-footer__brand[^"]*"[^>]*>([^<]*)/gi,
    /class="[^"]*home-hero[^"]*"[\s\S]*?<h1[^>]*>([^<]*)/gi,
    /property="og:title"\s+content="([^"]*)"/gi,
    /property="og:site_name"\s+content="([^"]*)"/gi,
    /name="description"\s+content="([^"]*)"/gi,
    /<title>([^<]*)<\/title>/gi,
    /class="[^"]*breadcrumb[^"]*"[\s\S]*?<a[^>]*data-allow-number[^>]*>([^<]*)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (m[1]?.trim()) chunks.push(m[1].trim());
    }
  }
  return chunks.join("\n");
}
