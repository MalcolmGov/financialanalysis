import {
  PublishSignoff,
  type PublishChecklistItem,
  type PublishSignoff as PublishSignoffT,
} from "@rs/contracts";
import {
  contrastRatio,
  isHighLuminance,
  resolveIrChromeTokens,
} from "@rs/render";
import { getPrivate, putPrivate } from "./blob";
import { brandOrigins } from "./brand-kit";
import { assessBrandDifferentiation } from "./brand-differentiation";
import type { BrandAssetBundle } from "@rs/contracts";

export const PUBLISH_SIGNOFF_PATH = (projectId: string) =>
  `projects/${projectId}/publish-signoff.json`;

export type PublishReadinessInput = {
  projectId: string;
  draftId: string;
  draftVersion: number;
  gateA: string | null;
  gateB: string | null;
  corporateReliability: string | null;
  company: string | null;
  companyLooksLikeSlug?: boolean;
  brandLogo: boolean;
  brandBanner: boolean;
  logoOrigin?: string | null;
  bannerOrigin?: string | null;
  /** Client-uploaded Brand kit logo (not extraction). */
  clientLogo?: boolean;
  brandHex?: string | null;
  accentHex?: string | null;
  mastheadHex?: string | null;
  /** Optional DNA role map for bright-brand contrast gate. */
  dnaRoles?: Record<string, { hex?: string } | undefined> | null;
  pages: Array<{ path: string; title?: string }>;
  files?: string[];
  pdfBundled?: boolean;
  excelPresent?: boolean;
  deliveryPackOk?: boolean;
  /** Soft doc-shape hint from SitePlan / draft meta (interim vs AFS). */
  docShape?: string | null;
};

/**
 * Shape-complete IR pack checks beyond Gate A/B + corporate reliability.
 * Interim packs stay lean; AFS requires statutory pages when the tree implies them.
 */
export function assessCompleteIrShape(input: {
  pages: Array<{ path: string; title?: string }>;
  company?: string | null;
  companyLooksLikeSlug?: boolean;
  docShape?: string | null;
}): PublishChecklistItem[] {
  const paths = input.pages.map((p) => p.path);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const shape = (input.docShape ?? "").toLowerCase();
  const looksAfs =
    shape.includes("afs") ||
    has(/directors-report\.html$/i) ||
    has(/auditors-report\.html$/i) ||
    has(/accounting-policies\.html$/i) ||
    has(/financials\/(?:group|company)\//i);

  const commentary = has(/commentary\.html$/i);
  const directors = has(/directors-report\.html$/i);
  const auditor = has(/auditors-report\.html$/i);
  const policies = has(/accounting-policies\.html$/i);
  const noteGroups = paths.filter((p) =>
    /financials\/(?:(?:group|company)\/)?notes-(?:\d+(?:-\d+)?|part-\d+)\.html$/i.test(p),
  ).length;
  const notesIndex = has(/financials\/(?:(?:group|company)\/)?notes\.html$/i);
  const dualColumns = input.pages.some((p) => /group and company/i.test(p.title ?? ""));
  const groupBook = has(/financials\/group\//i);
  const companyBook = has(/financials\/company\//i);
  const legalOk = Boolean(input.company?.trim()) && !input.companyLooksLikeSlug;

  const narrativeOk = looksAfs ? directors || commentary : commentary || directors;
  const auditorStatus: PublishChecklistItem["status"] = !looksAfs
    ? "na"
    : auditor
      ? "pass"
      : directors
        ? "fail"
        : "na";
  const policiesStatus: PublishChecklistItem["status"] = !looksAfs
    ? "na"
    : policies
      ? "pass"
      : "warn";
  const notesStatus: PublishChecklistItem["status"] = !looksAfs
    ? notesIndex || has(/notes\.html$/i)
      ? "pass"
      : "na"
    : noteGroups >= 1 || notesIndex
      ? "pass"
      : "warn";
  const entityOk =
    !looksAfs ||
    dualColumns ||
    (groupBook && companyBook) ||
    has(/financials\/income-statement\.html$/i);

  return [
    {
      id: "shape_narrative",
      label: looksAfs
        ? "Narrative non-empty (directors' report or commentary)"
        : "Narrative non-empty (commentary / letter band)",
      status: narrativeOk ? "pass" : "fail",
      detail: narrativeOk
        ? directors && commentary
          ? "directors-report.html + commentary.html"
          : directors
            ? "directors-report.html"
            : "commentary.html"
        : "Missing directors' report and commentary pages",
      critical: true,
    },
    {
      id: "shape_auditor",
      label: "Auditor page when AFS",
      status: auditorStatus,
      detail:
        auditorStatus === "pass"
          ? "auditors-report.html present"
          : auditorStatus === "fail"
            ? "AFS has directors' report but no auditor page"
            : "N/A for interim / no auditor section",
      critical: auditorStatus === "fail",
    },
    {
      id: "shape_policies",
      label: "Policies / framework page when AFS",
      status: policiesStatus,
      detail:
        policiesStatus === "pass"
          ? "accounting-policies.html present"
          : policiesStatus === "warn"
            ? "AFS tree without dedicated policies page"
            : "N/A for interim",
      critical: false,
    },
    {
      id: "shape_notes_ux",
      label: "Notes UX (index / groups for large packs)",
      status: notesStatus,
      detail:
        noteGroups > 0
          ? `${noteGroups} note group page(s)${notesIndex ? " + index" : ""}`
          : notesIndex
            ? "Single notes page / index"
            : looksAfs
              ? "No notes pages detected"
              : "Interim notes optional",
      critical: false,
    },
    {
      id: "shape_entity",
      label: "Entity coverage (consolidated / dual / Group+Company)",
      status: entityOk ? "pass" : "warn",
      detail:
        groupBook && companyBook
          ? "Group + Company statement books"
          : dualColumns
            ? "Dual-entity columns"
            : has(/financials\/income-statement\.html$/i)
              ? "Consolidated statement pages"
              : "Statement pages incomplete",
      critical: false,
    },
    {
      id: "shape_legal_name",
      label: "Legal name (not project slug / TOC title)",
      status: legalOk ? "pass" : "fail",
      detail: input.company ?? "missing",
      critical: true,
    },
  ];
}

/**
 * Publish gate for high-luminance brand chrome (MTN yellow, etc.).
 * Accent may stay vivid; masthead / table header / shading must remapped to AA.
 */
export function assessBrightBrandContrast(input: {
  brandHex?: string | null;
  mastheadHex?: string | null;
  dnaRoles?: Record<string, { hex?: string } | undefined> | null;
}): PublishChecklistItem {
  const roles =
    input.dnaRoles ??
    ({
      brand: input.brandHex ? { hex: input.brandHex } : undefined,
      "masthead-bg": input.mastheadHex ? { hex: input.mastheadHex } : undefined,
    } as Record<string, { hex?: string } | undefined>);
  const tokens = resolveIrChromeTokens(roles);
  if (!tokens.brightBrand) {
    return {
      id: "brand_contrast",
      label: "Brand contrast (chrome AA)",
      status: "pass",
      detail: "Brand luminance OK for classic/editorial chrome",
      critical: false,
    };
  }
  const mastheadOk =
    !isHighLuminance(tokens.masthead) &&
    contrastRatio("#FFFFFF", tokens.masthead) >= 2.8;
  // Soft current-period wash may be high-luminance; require ink remains AA on it
  // and it is not the raw brand paint.
  const shadeOk =
    tokens.shading.toUpperCase() !== tokens.brand.toUpperCase() &&
    contrastRatio(tokens.ink, tokens.shading) >= 4.5;
  const headerOk =
    contrastRatio(tokens.tableHeaderText, tokens.tableHeaderBg) >= 3.5;
  const brandTextOk = contrastRatio(tokens.brandText, tokens.paper) >= 4.5;
  if (!mastheadOk || !shadeOk || !headerOk || !brandTextOk) {
    return {
      id: "brand_contrast",
      label: "Brand contrast (chrome AA)",
      status: "fail",
      detail:
        "High-luminance brand would paint unsafe chrome — remap masthead/shading/headers before publish",
      critical: true,
    };
  }
  return {
    id: "brand_contrast",
    label: "Brand contrast (chrome AA)",
    status: "pass",
    detail: `Bright brand remapped to AA chrome (accent ${tokens.brand} kept)`,
    critical: false,
  };
}

export function buildPublishChecklist(input: PublishReadinessInput): PublishChecklistItem[] {
  const reliabilityPass = input.corporateReliability === "pass";
  const gateAPass = input.gateA === "pass";
  const gateBPass = input.gateB === "pass";
  const pages = input.pages ?? [];
  const hasHome = pages.some((p) => p.path === "index.html" || p.path.endsWith("/index.html"));
  const hasDownloads = pages.some((p) => /downloads\.html$/i.test(p.path));
  const pageCountOk = pages.length >= 4;
  const legalOk = Boolean(input.company?.trim()) && !input.companyLooksLikeSlug;
  const logoOrFallback = true; // renderer always ships text wordmark; logo optional polish
  const files = input.files ?? [];
  const excel =
    input.excelPresent ??
    files.some((f) => /\.xlsx$/i.test(f) || /financials\.xlsx$/i.test(f));
  const pdf = input.pdfBundled ?? files.some((f) => /source\.pdf$/i.test(f));
  const readme = files.some((f) => f === "README.md" || f.endsWith("/README.md"));
  const exportMeta = files.some((f) => f.includes("_meta/export.json"));
  const deliveryOk = input.deliveryPackOk ?? (readme && exportMeta && excel);
  const brandDiff = assessBrandDifferentiation({
    projectId: input.projectId,
    company: input.company,
    brandHex: input.brandHex,
    accentHex: input.accentHex,
    mastheadHex: input.mastheadHex,
    clientLogo: Boolean(input.clientLogo),
    brandLogo: input.brandLogo,
  });
  const brandContrast = assessBrightBrandContrast({
    brandHex: input.brandHex,
    mastheadHex: input.mastheadHex,
    dnaRoles: input.dnaRoles,
  });

  const items: PublishChecklistItem[] = [
    {
      id: "corporate_reliability",
      label: "Corporate reliability gates green",
      status: reliabilityPass ? "pass" : "fail",
      detail: reliabilityPass ? "auditCorporateReliability pass" : "Reliability audit failed",
      critical: true,
    },
    {
      id: "gate_a",
      label: "Gate A (provenance) pass",
      status: gateAPass ? "pass" : "fail",
      detail: input.gateA ?? "missing",
      critical: true,
    },
    {
      id: "gate_b",
      label: "Gate B (rendered fidelity) pass",
      status: gateBPass ? "pass" : "fail",
      detail: input.gateB ?? "missing",
      critical: true,
    },
    {
      id: "legal_name",
      label: "Legal company name (not project slug)",
      status: legalOk ? "pass" : "fail",
      detail: input.company ?? "missing",
      critical: true,
    },
    {
      id: "logo_or_fallback",
      label: "Logo present or text wordmark fallback",
      status: logoOrFallback ? (input.brandLogo ? "pass" : "warn") : "fail",
      detail: input.brandLogo
        ? `Logo from ${input.logoOrigin ?? "bundle"}`
        : "Text wordmark fallback (upload SVG in Brand kit for polish)",
      critical: false,
    },
    {
      id: "brand_differentiated",
      label: "Brand differentiated (DNA accent + logo — not DRDGOLD defaults)",
      status: brandDiff.status,
      detail: brandDiff.detail,
      critical: brandDiff.critical,
    },
    brandContrast,
    {
      id: "hero_photo",
      label: "Hero photography (optional polish)",
      status: input.brandBanner
        ? input.bannerOrigin?.includes("client")
          ? "pass"
          : "warn"
        : "na",
      detail: input.brandBanner
        ? `Banner from ${input.bannerOrigin ?? "bundle"}`
        : "No hero — atmosphere fallback (upload commissioned photo in Brand kit)",
      critical: false,
    },
    {
      id: "pages_visible",
      label: "Page tree present (home + statements)",
      status: pageCountOk && hasHome ? "pass" : "fail",
      detail: `${pages.length} pages${hasHome ? "" : " · missing index.html"}`,
      critical: true,
    },
    {
      id: "downloads",
      label: "Downloads page + Excel/PDF artifacts",
      status: hasDownloads && excel ? "pass" : hasDownloads ? "warn" : "fail",
      detail: [
        hasDownloads ? "downloads.html" : "no downloads page",
        excel ? "xlsx" : "no xlsx",
        pdf ? "source.pdf" : "pdf optional/missing",
      ].join(" · "),
      critical: true,
    },
    {
      id: "delivery_pack",
      label: "Delivery pack handoff (README + export.json)",
      status: deliveryOk ? "pass" : "fail",
      detail: deliveryOk ? "README + _meta/export.json present" : "Incomplete delivery pack",
      critical: true,
    },
    ...assessCompleteIrShape({
      pages,
      company: input.company,
      companyLooksLikeSlug: input.companyLooksLikeSlug,
      docShape: input.docShape,
    }),
    {
      id: "operator_sla",
      label: "Operator SLA path (≤2-click rebuild / ≤15 min polish)",
      status: "pass",
      detail:
        "Theme or Brand kit → Apply & rebuild (≤2 clicks). Aim ≤15 min polish after extraction finishes.",
      critical: false,
    },
  ];
  return items;
}

export function checklistBlockers(items: PublishChecklistItem[]): string[] {
  return items
    .filter((i) => i.critical && i.status === "fail")
    .map((i) => `${i.label}${i.detail ? ` — ${i.detail}` : ""}`);
}

export function canSignOffPublish(items: PublishChecklistItem[]): boolean {
  return checklistBlockers(items).length === 0;
}

export async function loadPublishSignoff(
  projectId: string,
): Promise<PublishSignoffT | null> {
  // Vercel Blob head/fetch can briefly lag after overwrite — retry so Approve
  // & export does not embed a stale checklist snapshot.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await getPrivate(PUBLISH_SIGNOFF_PATH(projectId));
      const parsed = PublishSignoff.safeParse(JSON.parse(raw.toString("utf8")));
      if (parsed.success) return parsed.data;
    } catch {
      /* retry */
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return null;
}

export async function savePublishSignoff(
  signoff: PublishSignoffT,
): Promise<PublishSignoffT> {
  const next = PublishSignoff.parse(signoff);
  await putPrivate(
    PUBLISH_SIGNOFF_PATH(signoff.project_id),
    JSON.stringify(next, null, 2),
    "application/json",
  );
  // Read-after-write confirm (best-effort) so the next load sees this version.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await getPrivate(PUBLISH_SIGNOFF_PATH(signoff.project_id));
      const parsed = PublishSignoff.safeParse(JSON.parse(raw.toString("utf8")));
      if (
        parsed.success &&
        parsed.data.draft_id === next.draft_id &&
        parsed.data.signed_off_at === next.signed_off_at
      ) {
        return next;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return next;
}

export function originsFromBundle(bundle: BrandAssetBundle | null | undefined) {
  return brandOrigins(bundle);
}
