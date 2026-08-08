/**
 * CommentaryComposer — letter / operations / dividend hierarchy for commentary.html.
 * Prose is verbatim from DocModel sections (with data-src); layout only.
 */

import type { FinancialDocModel } from "@rs/contracts";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type SectionKind = "letter" | "reviewOfOperations" | "dividendDeclaration";

interface CommentaryBand {
  kind: SectionKind;
  id: string;
  label: string;
  eyebrow: string;
}

const BANDS: CommentaryBand[] = [
  {
    kind: "letter",
    id: "letter",
    label: "Letter to shareholders",
    eyebrow: "From the Chief Executive Officer",
  },
  {
    kind: "reviewOfOperations",
    id: "operations",
    label: "Review of operations",
    eyebrow: "Operational performance",
  },
  {
    kind: "dividendDeclaration",
    id: "dividend",
    label: "Dividend declaration",
    eyebrow: "Returns to shareholders",
  },
];

function wrapLooseListItems(html: string): string {
  if (!html.includes("prose-li")) return html;
  return html.replace(/(?:<li class="prose-li"[^>]*>[\s\S]*?<\/li>\n?)+/g, (block) => {
    return `<ul class="prose-ul">${block}</ul>`;
  });
}

function sectionInnerHtml(sec: FinancialDocModel["sections"][number]): string {
  const parts: string[] = [];
  let leadUsed = false;
  for (const b of sec.blocks) {
    if (b.kind === "table") continue;
    const text = b.text?.trim();
    if (!text) continue;
    const src = b.src_ref ? ` data-src="${escapeHtml(b.src_ref)}"` : "";
    if (b.kind === "heading") {
      // Skip duplicate top title if it restates the band label / Dear Shareholder.
      if (/^dear shareholder/i.test(text) || /^condensed consolidated/i.test(text)) {
        parts.push(`<p class="commentary-dek"${src}>${escapeHtml(text)}</p>`);
      } else {
        parts.push(`<h3 class="prose-subh"${src}>${escapeHtml(text)}</h3>`);
      }
    } else if (b.kind === "list") {
      parts.push(`<li class="prose-li"${src}>${escapeHtml(text)}</li>`);
    } else if (b.kind === "signoff") {
      parts.push(`<p class="prose-signoff"${src}>${escapeHtml(text)}</p>`);
    } else if (!leadUsed) {
      leadUsed = true;
      parts.push(`<p class="prose-p prose-lead"${src}>${escapeHtml(text)}</p>`);
    } else {
      parts.push(`<p class="prose-p"${src}>${escapeHtml(text)}</p>`);
    }
  }
  return wrapLooseListItems(parts.join("\n"));
}

function bandHtml(
  band: CommentaryBand,
  sections: FinancialDocModel["sections"],
): string | null {
  const matching = sections.filter((s) => s.kind === band.kind);
  if (!matching.length) return null;
  const bodies = matching
    .map((sec) => {
      const inner = sectionInnerHtml(sec);
      if (!inner) return "";
      // Prefer section title when it differs from band label.
      const titleText = sec.title?.text?.trim();
      const showTitle =
        titleText &&
        !/^dear shareholder/i.test(titleText) &&
        titleText.toLowerCase() !== band.label.toLowerCase();
      const titleSrc = sec.title?.src_ref
        ? ` data-src="${escapeHtml(sec.title.src_ref)}"`
        : "";
      const sub = showTitle
        ? `<h3 class="commentary-section__doc-title"${titleSrc}>${escapeHtml(titleText)}</h3>`
        : "";
      return `${sub}${inner}`;
    })
    .filter(Boolean)
    .join("\n");
  if (!bodies) return null;
  // No .reveal — editorial must stay visible even if site.js/IO fails in iframe.
  return `<section class="commentary-section" id="${band.id}" data-kind="${band.kind}" data-dna-component="commentary-section">
<header class="commentary-section__hdr">
<p class="commentary-section__eyebrow">${escapeHtml(band.eyebrow)}</p>
<h2 class="commentary-section__title">${escapeHtml(band.label)}</h2>
</header>
<div class="commentary-section__body prose-rail">${bodies}</div>
</section>`;
}

function tocHtml(present: CommentaryBand[]): string {
  if (present.length < 2) return "";
  const links = present
    .map(
      (b, i) =>
        `<a class="commentary-toc__link" href="#${b.id}"><span class="commentary-toc__n" data-allow-number>${String(i + 1).padStart(2, "0")}</span>${escapeHtml(b.label)}</a>`,
    )
    .join("");
  return `<nav class="commentary-toc" aria-label="On this page" data-dna-component="commentary-toc">
<p class="commentary-toc__label">On this page</p>
<div class="commentary-toc__links">${links}</div>
</nav>`;
}

export function composeCommentaryBody(docModel: FinancialDocModel): string {
  const sections = docModel.sections;
  const rendered: Array<{ band: CommentaryBand; html: string }> = [];
  for (const band of BANDS) {
    const html = bandHtml(band, sections);
    if (html) rendered.push({ band, html });
  }
  if (!rendered.length) {
    return `<p class="prose-p">Commentary will appear when the extraction includes a shareholder letter.</p>`;
  }
  const toc = tocHtml(rendered.map((r) => r.band));
  return `${toc}${rendered.map((r) => r.html).join("\n")}`;
}
