import {
  PublishSignoff,
  type PublishChecklistItem,
  type PublishSignoff as PublishSignoffT,
} from "@rs/contracts";
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
  pages: Array<{ path: string }>;
  files?: string[];
  pdfBundled?: boolean;
  excelPresent?: boolean;
  deliveryPackOk?: boolean;
};

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
