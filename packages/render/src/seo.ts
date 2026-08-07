/**
 * SeoComposer — per-page meta/OG + schema.org JSON-LD for multipage IR sites.
 * Descriptions may cite verbatim KPI displays from highlights; never invent figures.
 */

import type { FinancialDocModel } from "@rs/contracts";
import type { HomeKpiCard } from "./home-kpis.js";

export interface SeoPageInput {
  path: string;
  title: string;
  company?: string;
  periodLabel?: string;
  docKind?: FinancialDocModel["meta"]["doc_kind"];
  currency?: string;
  /** Verbatim KPI cards (home Report JSON-LD / rich descriptions). */
  kpis?: HomeKpiCard[];
  /** Optional absolute site origin for canonical URLs. */
  siteOrigin?: string;
}

export interface SeoHeadParts {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogType: string;
  ogSiteName: string;
  canonicalPath: string;
  canonicalHref: string | null;
  robots: string;
  jsonLd: Record<string, unknown> | null;
  keywords: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function docKindLabel(kind?: FinancialDocModel["meta"]["doc_kind"]): string {
  switch (kind) {
    case "interim_reviewed":
      return "Condensed Consolidated Reviewed Interim Results";
    case "annual_audited":
      return "Audited Annual Financial Results";
    case "interim_unaudited":
    default:
      return "Condensed Consolidated Unaudited Interim Results";
  }
}

function shortCompany(company: string): string {
  return company.replace(/\s+Limited$/i, "").trim() || company;
}

/** Join up to N KPI displays with " | " for OG-style blurbs (verbatim). */
function kpiBlurb(kpis: HomeKpiCard[] | undefined, max = 4): string {
  if (!kpis?.length) return "";
  return kpis
    .slice(0, max)
    .map((k) => `${k.label} ${k.display}`.replace(/\s+/g, " ").trim())
    .join(" | ");
}

function pageKind(path: string): "home" | "commentary" | "financials" | "admin" | "downloads" | "other" {
  if (path === "index.html") return "home";
  if (path === "commentary.html") return "commentary";
  if (path.startsWith("financials/")) return "financials";
  if (path === "administration.html") return "admin";
  if (path === "downloads.html") return "downloads";
  return "other";
}

export function composeSeo(page: SeoPageInput): SeoHeadParts {
  const company = page.company?.trim() || "";
  const period = page.periodLabel?.trim() || "";
  const short = company ? shortCompany(company) : "";
  const kind = pageKind(page.path);
  const resultsLabel = docKindLabel(page.docKind);
  const blurb = kpiBlurb(page.kpis);

  let title: string;
  let description: string;
  let ogTitle: string;
  let ogDescription: string;

  if (kind === "home") {
    title = [short || company, period.split("—")[0]?.trim() || period, resultsLabel]
      .filter(Boolean)
      .join(" — ");
    description =
      [
        company && period
          ? `${company}'s ${resultsLabel.toLowerCase()} for ${period}.`
          : `${resultsLabel}.`,
        blurb || undefined,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 320);
    ogTitle = [short || company, period.split("—")[0]?.trim() || period, "Interim Results"]
      .filter(Boolean)
      .join(" ");
    ogDescription = blurb || description;
  } else {
    title = company ? `${page.title} · ${company}` : page.title;
    const base = [company, period, page.title].filter(Boolean).join(" — ");
    description =
      kind === "commentary"
        ? `${base}. Shareholder letter, review of operations, and dividend declaration.`
        : kind === "financials"
          ? `${base}. Condensed consolidated financial statement from the results announcement.`
          : kind === "downloads"
            ? `${base}. Source PDF and spreadsheet downloads.`
            : kind === "admin"
              ? `${base}. Corporate and shareholder information.`
              : base || page.title;
    ogTitle = title;
    ogDescription = description;
  }

  const ogSiteName = company
    ? `${shortCompany(company)} Investor Results Centre`
    : "Investor Results Centre";

  const canonicalPath = page.path === "index.html" ? "./" : page.path;
  const origin = page.siteOrigin?.replace(/\/+$/, "") || "";
  const canonicalHref = origin
    ? `${origin}/${page.path === "index.html" ? "" : page.path}`.replace(/\/+$/, "/") || origin + "/"
    : null;

  const keywords = [short || company, "interim results", period.split("—")[0]?.trim(), "financial results"]
    .filter(Boolean)
    .join(", ");

  let jsonLd: Record<string, unknown> | null = null;
  if (kind === "home") {
    const reportDesc =
      blurb ||
      description ||
      `${company} ${resultsLabel}${period ? ` for ${period}` : ""}`.trim();
    jsonLd = {
      "@context": "https://schema.org",
      "@type": "Report",
      name: [company, resultsLabel, period ? `for ${period}` : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
      description: reportDesc,
      publisher: {
        "@type": "Organization",
        name: company || "Issuer",
      },
      about: {
        "@type": "Organization",
        name: company || "Issuer",
        ...(page.currency ? { currency: page.currency } : {}),
      },
    };
  } else {
    jsonLd = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      isPartOf: {
        "@type": "Report",
        name: [company, resultsLabel].filter(Boolean).join(" — "),
        publisher: {
          "@type": "Organization",
          name: company || "Issuer",
        },
      },
    };
  }

  return {
    title,
    description,
    ogTitle,
    ogDescription,
    ogType: kind === "home" ? "website" : "article",
    ogSiteName,
    canonicalPath,
    canonicalHref,
    robots: "index,follow",
    jsonLd,
    keywords,
  };
}

/** Serialize SEO parts into <head> fragments (excluding CSS). */
export function renderSeoMeta(parts: SeoHeadParts): string {
  const canonical = parts.canonicalHref
    ? `<link rel="canonical" href="${escapeHtml(parts.canonicalHref)}">`
    : `<link rel="canonical" href="${escapeHtml(parts.canonicalPath)}">`;
  const jsonLd = parts.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(parts.jsonLd)}</script>`
    : "";
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(parts.title)}</title>
<meta name="description" content="${escapeHtml(parts.description)}">
<meta name="keywords" content="${escapeHtml(parts.keywords)}">
<meta name="robots" content="${escapeHtml(parts.robots)}">
${canonical}
<meta property="og:type" content="${escapeHtml(parts.ogType)}">
<meta property="og:title" content="${escapeHtml(parts.ogTitle)}">
<meta property="og:description" content="${escapeHtml(parts.ogDescription)}">
<meta property="og:site_name" content="${escapeHtml(parts.ogSiteName)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(parts.ogTitle)}">
<meta name="twitter:description" content="${escapeHtml(parts.ogDescription)}">
${jsonLd}`;
}

/** Convenience: compose + render meta for a page. */
export function composeSeoHead(
  page: SeoPageInput,
  css: string,
): string {
  return `${renderSeoMeta(composeSeo(page))}\n<style>${css}</style>`;
}
