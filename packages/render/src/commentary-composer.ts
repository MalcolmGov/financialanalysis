/**
 * CommentaryComposer — letter / operations / dividend hierarchy for commentary.html.
 * Prose is verbatim from DocModel sections (with data-src); layout only.
 * Ops / facts KPI tables (pre-rendered from the SitePlan region) mount under
 * Review of operations so Financials stays statements-only.
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

export interface CommentaryComposeOptions {
  /** Pre-rendered statement-table sections (ops/facts) from the SitePlan region. */
  opsTablesHtml?: string[];
}

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

function bandShell(band: CommentaryBand, bodyHtml: string): string {
  // No .reveal — editorial must stay visible even if site.js/IO fails in iframe.
  return `<section class="commentary-section" id="${band.id}" data-kind="${band.kind}" data-dna-component="commentary-section">
<header class="commentary-section__hdr">
<p class="commentary-section__eyebrow">${escapeHtml(band.eyebrow)}</p>
<h2 class="commentary-section__title">${escapeHtml(band.label)}</h2>
</header>
<div class="commentary-section__body prose-rail">${bodyHtml}</div>
</section>`;
}

function bandHtml(
  band: CommentaryBand,
  sections: FinancialDocModel["sections"],
  opsTablesHtml: string[] = [],
): string | null {
  const matching = sections.filter((s) => s.kind === band.kind);
  const bodies = matching
    .map((sec) => {
      const inner = sectionInnerHtml(sec);
      if (!inner) return "";
      // Prefer section title when it differs from band label.
      const titleText = sec.title?.text?.trim();
      const showTitle =
        titleText &&
        !/^dear shareholder/i.test(titleText) &&
        titleText.toLowerCase() !== band.label.toLowerCase() &&
        // Ops KPI table captions restated as band title — skip duplicate.
        !(band.kind === "reviewOfOperations" && /review\s+of\s+operations/i.test(titleText));
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

  const tables =
    band.kind === "reviewOfOperations" && opsTablesHtml.length
      ? `<div class="commentary-ops-tables" data-dna-component="commentary-ops-tables">${opsTablesHtml.join("\n")}</div>`
      : "";

  if (!bodies && !tables) return null;
  return bandShell(band, `${bodies}${tables}`);
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

const OPS_HEADING =
  /^(review of operations|group operational\b|operational$|ergo mining proprietary|far west gold recoveries|at ergo|at fwgr)/i;

/**
 * When DocModel lacks a dedicated reviewOfOperations section, carve the best
 * available ops prose out of the shareholder letter (common DRD shape).
 */
function withOpsFallback(sections: FinancialDocModel["sections"]): FinancialDocModel["sections"] {
  // A facts-table-only reviewOfOperations section must not block carving ops
  // prose out of the shareholder letter.
  const hasOpsProse = sections.some(
    (s) =>
      s.kind === "reviewOfOperations" &&
      s.blocks.some((b) => b.kind !== "table" && Boolean((b.text ?? "").trim())),
  );
  if (hasOpsProse) return sections;
  const letterIdx = sections.findIndex((s) => s.kind === "letter");
  if (letterIdx < 0) return sections;
  const letter = sections[letterIdx]!;
  const opsAt = letter.blocks.findIndex(
    (b) => b.kind === "heading" && OPS_HEADING.test((b.text ?? "").trim()),
  );
  if (opsAt < 0) return sections;
  const stopAt = letter.blocks.findIndex(
    (b, i) =>
      i > opsAt &&
      b.kind === "heading" &&
      /^(cash dividend|dividend declaration|looking ahead|ni[eë]l\s)/i.test((b.text ?? "").trim()),
  );
  const opsEnd = stopAt > opsAt ? stopAt : letter.blocks.length;
  const opsBlocks = letter.blocks.slice(opsAt, opsEnd);
  if (!opsBlocks.length) return sections;
  const next = sections.slice();
  next[letterIdx] = {
    ...letter,
    blocks: [...letter.blocks.slice(0, opsAt), ...letter.blocks.slice(opsEnd)],
  };
  next.splice(letterIdx + 1, 0, {
    id: "doc:sec_reviewOfOperations_fallback",
    kind: "reviewOfOperations",
    title: {
      text: opsBlocks[0]?.text?.trim() || "Review of operations",
      src_ref: opsBlocks[0]?.src_ref ?? letter.title?.src_ref ?? "ext:ops",
    },
    blocks: opsBlocks,
    items: [],
  });
  return next;
}

export function composeCommentaryBody(
  docModel: FinancialDocModel,
  opts: CommentaryComposeOptions = {},
): string {
  const sections = withOpsFallback(docModel.sections);
  const opsTablesHtml = opts.opsTablesHtml ?? [];
  const rendered: Array<{ band: CommentaryBand; html: string }> = [];
  for (const band of BANDS) {
    const html = bandHtml(band, sections, opsTablesHtml);
    if (html) rendered.push({ band, html });
  }
  // Tables alone still warrant an ops band (prose may be absent in thin extractions).
  if (!rendered.some((r) => r.band.kind === "reviewOfOperations") && opsTablesHtml.length) {
    const opsBand = BANDS.find((b) => b.kind === "reviewOfOperations")!;
    rendered.splice(Math.min(1, rendered.length), 0, {
      band: opsBand,
      html: bandShell(
        opsBand,
        `<div class="commentary-ops-tables" data-dna-component="commentary-ops-tables">${opsTablesHtml.join("\n")}</div>`,
      ),
    });
  }
  if (!rendered.length) {
    return `<p class="prose-p">Commentary will appear when the extraction includes a shareholder letter.</p>`;
  }
  const toc = tocHtml(rendered.map((r) => r.band));
  const missingOps = !rendered.some((r) => r.band.kind === "reviewOfOperations");
  const note = missingOps
    ? `<p class="commentary-note" data-dna-component="commentary-ops-absent">Review of operations was not present as a separate section in the source extraction; letter and dividend bands are shown from available prose.</p>`
    : "";
  return `${toc}${note}${rendered.map((r) => r.html).join("\n")}`;
}
