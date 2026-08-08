/**
 * Per-issuer brand differentiation — Brand kit (logo/hero) + DesignDNA tokens
 * drive look-and-feel. Render chrome fallbacks are neutral IR, not DRDGOLD.
 */
import {
  DRDGOLD_REFERENCE_PALETTE,
  IR_NEUTRAL_FALLBACKS,
} from "@rs/render";
import { isDrdgoldReferenceProject } from "./reference-projects";

export type BrandDifferentiationInput = {
  projectId: string;
  company: string | null;
  /** DNA palette.roles.brand.hex */
  brandHex?: string | null;
  accentHex?: string | null;
  mastheadHex?: string | null;
  /** Client-uploaded logo in Brand kit */
  clientLogo: boolean;
  /** Any logo in draft (client or extraction) */
  brandLogo: boolean;
};

export type BrandDifferentiationAssessment = {
  isReferenceIssuer: boolean;
  brandDifferentiated: boolean;
  accentFromDna: boolean;
  logoPresent: boolean;
  /** Checklist status */
  status: "pass" | "warn" | "fail";
  detail: string;
  /**
   * Critical fail blocks publish sign-off.
   * Soft warn still allows rebuild for iteration.
   */
  critical: boolean;
  warnings: string[];
};

function normHex(h: string | null | undefined): string | null {
  if (!h) return null;
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(h.trim());
  return m ? `#${m[1]!.toUpperCase()}` : null;
}

function isNeutralFallback(hex: string | null): boolean {
  if (!hex) return true;
  const n = hex.toUpperCase();
  return (
    n === IR_NEUTRAL_FALLBACKS.brand.toUpperCase() ||
    n === IR_NEUTRAL_FALLBACKS.masthead.toUpperCase() ||
    n === IR_NEUTRAL_FALLBACKS.accent.toUpperCase()
  );
}

function matchesDrdgoldPalette(brand: string | null, masthead: string | null): boolean {
  const b = brand?.toUpperCase();
  const m = masthead?.toUpperCase();
  return (
    b === DRDGOLD_REFERENCE_PALETTE.brand.toUpperCase() ||
    b === DRDGOLD_REFERENCE_PALETTE.olderBrand.toUpperCase() ||
    m === DRDGOLD_REFERENCE_PALETTE.masthead.toUpperCase()
  );
}

export function assessBrandDifferentiation(
  input: BrandDifferentiationInput,
): BrandDifferentiationAssessment {
  const isReferenceIssuer = isDrdgoldReferenceProject({
    projectId: input.projectId,
    company: input.company,
  });
  const brandHex = normHex(input.brandHex);
  const accentHex = normHex(input.accentHex);
  const mastheadHex = normHex(input.mastheadHex);
  const accentFromDna = Boolean(brandHex || accentHex || mastheadHex);
  const logoPresent = input.clientLogo || input.brandLogo;
  const warnings: string[] = [];

  const dnaLooksUnset =
    !brandHex ||
    !mastheadHex ||
    (isNeutralFallback(brandHex) && isNeutralFallback(mastheadHex));

  const looksLikeDrdClone =
    !isReferenceIssuer && matchesDrdgoldPalette(brandHex, mastheadHex);

  if (looksLikeDrdClone) {
    warnings.push(
      "DNA palette matches DRDGOLD reference gold/olive — confirm this issuer's own brand tokens before publish",
    );
  }
  if (!input.clientLogo && !isReferenceIssuer) {
    warnings.push("No client Brand kit logo — upload SVG/PNG for issuer differentiation");
  }
  if (dnaLooksUnset && !isReferenceIssuer) {
    warnings.push(
      "DNA brand/masthead unset or neutral IR defaults — approve issuer-specific DesignDNA before publish",
    );
  }

  // Reference issuer: DNA + existing brand kit are the source of truth.
  if (isReferenceIssuer) {
    const ok = accentFromDna || logoPresent;
    return {
      isReferenceIssuer: true,
      brandDifferentiated: ok,
      accentFromDna,
      logoPresent,
      status: ok ? "pass" : "warn",
      detail: ok
        ? `DRDGOLD reference · accent ${brandHex ?? mastheadHex ?? "from DNA"} · logo ${logoPresent ? "present" : "wordmark"}`
        : "DRDGOLD reference — DNA/Brand kit incomplete",
      critical: false,
      warnings,
    };
  }

  // Non-reference: strongly gate empty kit + unset/generic DNA.
  if (!input.clientLogo && dnaLooksUnset) {
    return {
      isReferenceIssuer: false,
      brandDifferentiated: false,
      accentFromDna,
      logoPresent,
      status: "fail",
      detail:
        "Brand kit empty and DNA tokens unset/generic — upload logo + lock issuer DesignDNA (do not inherit DRDGOLD look)",
      critical: true,
      warnings,
    };
  }

  if (looksLikeDrdClone && !input.clientLogo) {
    return {
      isReferenceIssuer: false,
      brandDifferentiated: false,
      accentFromDna,
      logoPresent,
      status: "fail",
      detail:
        "Non-DRDGOLD issuer with DRDGOLD-like DNA and no Brand kit logo — differentiate brand before publish",
      critical: true,
      warnings,
    };
  }

  if (!input.clientLogo || dnaLooksUnset || looksLikeDrdClone) {
    return {
      isReferenceIssuer: false,
      brandDifferentiated: Boolean(accentFromDna && logoPresent && !looksLikeDrdClone),
      accentFromDna,
      logoPresent,
      status: "warn",
      detail: [
        logoPresent ? "logo present" : "no logo",
        accentFromDna ? `accent ${brandHex ?? mastheadHex}` : "accent unset",
        looksLikeDrdClone ? "DRDGOLD-like palette" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      critical: false,
      warnings,
    };
  }

  return {
    isReferenceIssuer: false,
    brandDifferentiated: true,
    accentFromDna: true,
    logoPresent: true,
    status: "pass",
    detail: `Issuer-differentiated · brand ${brandHex} · masthead ${mastheadHex} · client logo`,
    critical: false,
    warnings,
  };
}

/** Soft preflight for site-draft rebuild — never hard-blocks by itself. */
export function brandDifferentiationRebuildWarning(
  assessment: BrandDifferentiationAssessment,
): string | null {
  if (assessment.status === "pass") return null;
  if (assessment.isReferenceIssuer) return null;
  return assessment.detail;
}
