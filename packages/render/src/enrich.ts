import type { FinancialDocModel, SitePlan } from "@rs/contracts";

/**
 * Fill WW-style prose pages after the deterministic table render.
 * Prose is injected as HTML (with data-src) so SitePlan text slots never
 * carry numerals — Gate B still covers any .num / data-src spans in tables.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NOTE_HEADING = /^(\d{1,2})\.\s+\S/;
function noteNumberOf(title: string): number | null {
  const m = NOTE_HEADING.exec(title.trim());
  return m ? Number(m[1]) : null;
}

function sectionBlocksHtml(
  sections: FinancialDocModel["sections"],
  kinds: string[],
): string {
  const parts: string[] = [];
  for (const sec of sections) {
    if (!kinds.includes(sec.kind)) continue;
    if (sec.title?.text) {
      const src = sec.title.src_ref ? ` data-src="${escapeHtml(sec.title.src_ref)}"` : "";
      parts.push(`<h2 class="prose-h"${src}>${escapeHtml(sec.title.text)}</h2>`);
    }
    for (const b of sec.blocks) {
      if (b.kind === "table") continue;
      const text = b.text?.trim();
      if (!text) continue;
      const src = b.src_ref ? ` data-src="${escapeHtml(b.src_ref)}"` : "";
      if (b.kind === "heading") {
        parts.push(`<h3 class="prose-subh"${src}>${escapeHtml(text)}</h3>`);
      } else if (b.kind === "list") {
        parts.push(`<li class="prose-li"${src}>${escapeHtml(text)}</li>`);
      } else {
        parts.push(`<p class="prose-p"${src}>${escapeHtml(text)}</p>`);
      }
    }
  }
  return parts.join("\n");
}

function wrapLooseListItems(html: string): string {
  if (!html.includes("prose-li")) return html;
  return html.replace(/(?:<li class="prose-li"[^>]*>[\s\S]*?<\/li>\n?)+/g, (block) => {
    return `<ul class="prose-ul">${block}</ul>`;
  });
}

function exploreCards(plan: SitePlan): string {
  const cards = plan.nav
    .filter((n) => n.href !== "index.html")
    .map((n, i) => {
      const n_ = String(i + 1).padStart(2, "0");
      // Decorative card index — not a financial figure (Gate B allow-list).
      return `<a class="explore-card" href="${escapeHtml(n.href)}"><span class="explore-n" data-allow-number>${n_}</span><span class="explore-label">${escapeHtml(n.label)}</span></a>`;
    })
    .join("");
  return `<section class="explore" aria-label="Explore the report"><h2 class="prose-h">Explore the report</h2><div class="explore-grid">${cards}</div></section>`;
}

function highlightsHtml(docModel: FinancialDocModel): string {
  const hi = docModel.sections.find((s) => s.kind === "highlights");
  if (!hi) return "";
  const body = wrapLooseListItems(
    sectionBlocksHtml(
      docModel.sections.filter((s) => s.kind === "highlights"),
      ["highlights"],
    ),
  );
  return `<section class="highlights" aria-label="Highlights">${body || "<p class=\"prose-p\">Highlights from the interim results.</p>"}</section>`;
}

function homeHero(docModel: FinancialDocModel): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  const period = escapeHtml(docModel.meta.period_label || "");
  return `<header class="home-hero" data-dna-component="home-hero">
<p class="home-kicker">Interactive results</p>
<h1>${company}</h1>
${period ? `<p class="home-period" data-allow-number>${period}</p>` : ""}
<p class="home-cta"><a href="commentary.html">Read commentary</a><a href="financials/income-statement.html">View financials</a></p>
</header>`;
}

function downloadsHtml(docModel: FinancialDocModel): string {
  const company = escapeHtml(docModel.meta.company || "Results");
  return `<section class="downloads" data-dna-component="downloads">
<h2 class="prose-h">Downloads</h2>
<p class="prose-p">Source PDF and spreadsheet exports for ${company}.</p>
<ul class="download-list">
<li><span class="dl-label">Full results PDF</span><span class="dl-note">Open the source document from your project upload (not bundled in this static zip).</span></li>
<li><span class="dl-label">Excel workbook</span><span class="dl-note">Coming soon — statement tables are available as HTML on the Financials pages.</span></li>
</ul>
</section>`;
}

function injectInto(html: string, markerClass: string, content: string): string {
  const re = new RegExp(`(<[^>]*class="[^"]*\\b${markerClass}\\b[^"]*"[^>]*>)([\\s\\S]*?)(</(?:div|main|section)>)`, "i");
  if (re.test(html)) {
    // Function replacer — prose may contain `$1` / `$&` (e.g. FX rates).
    return html.replace(re, (_m, open: string, _inner: string, close: string) => `${open}${content}${close}`);
  }
  // Fallback: insert before closing </main>
  if (/<\/main>/i.test(html)) {
    return html.replace(/<\/main>/i, () => `${content}</main>`);
  }
  return html;
}

function replaceHomeHero(html: string, hero: string): string {
  if (/class="[^"]*\bhome-hero\b/.test(html)) {
    return html.replace(/<header class="home-hero"[\s\S]*?<\/header>/i, () => hero);
  }
  return html.replace(
    /(<main[^>]*class="[^"]*\bpage-home\b[^"]*"[^>]*>)/i,
    (_m, open: string) => `${open}${hero}`,
  );
}

/** Wrap each notes table section with #note-N when a note number is known. */
function anchorNotes(
  html: string,
  docModel: FinancialDocModel,
): string {
  const bySrc = new Map<string, number>();
  for (const sec of docModel.sections) {
    const n =
      sec.note_number ??
      (sec.title?.text ? noteNumberOf(sec.title.text) : null);
    if (n == null) continue;
    for (const b of sec.blocks) {
      if (b.kind === "table" && b.table_ref) {
        const tbl = docModel.tables.find((t) => t.id === b.table_ref);
        if (tbl?.src_table) bySrc.set(tbl.src_table, n);
      }
    }
  }
  return html.replace(
    /<section([^>]*data-dna-component="statement-table"[^>]*)>([\s\S]*?)<\/section>/gi,
    (full, attrs: string, inner: string) => {
      const m = /data-table-src="([^"]+)"/.exec(inner) || /data-table-src="([^"]+)"/.exec(attrs);
      const src = m?.[1];
      const n = src ? bySrc.get(src) : undefined;
      if (n == null) return full;
      const id = `note-${n}`;
      if (/\sid="/.test(attrs)) return full;
      return `<section id="${id}"${attrs}><h2 class="note-title" data-allow-number>Note ${n}</h2>${inner}</section>`;
    },
  );
}

function pageTitleBanner(title: string): string {
  return `<header class="page-title-banner"><h1>${escapeHtml(title)}</h1></header>`;
}

export function enrichMultiPageFiles(
  files: Record<string, string>,
  plan: SitePlan,
  docModel: FinancialDocModel,
): Record<string, string> {
  const out = { ...files };

  if (out["index.html"]) {
    let html = replaceHomeHero(out["index.html"], homeHero(docModel));
    const body = `${highlightsHtml(docModel)}${exploreCards(plan)}`;
    html = injectInto(html, "home-body", body);
    out["index.html"] = html;
  }

  if (out["commentary.html"]) {
    const prose = wrapLooseListItems(
      sectionBlocksHtml(docModel.sections, ["letter", "reviewOfOperations", "dividendDeclaration"]),
    );
    const content =
      pageTitleBanner("Commentary") +
      (prose || `<p class="prose-p">Commentary will appear when the extraction includes a shareholder letter.</p>`);
    out["commentary.html"] = injectInto(out["commentary.html"], "prose-body", content);
  }

  if (out["administration.html"]) {
    const prose = wrapLooseListItems(
      sectionBlocksHtml(docModel.sections, [
        "shareholderInfo",
        "issuedCapital",
        "marketCap",
        "directors",
        "contacts",
        "forwardLooking",
      ]),
    );
    const content =
      pageTitleBanner("Administration") +
      (prose || `<p class="prose-p">Administration details from the results announcement.</p>`);
    out["administration.html"] = injectInto(out["administration.html"], "prose-body", content);
  }

  if (out["downloads.html"]) {
    out["downloads.html"] = injectInto(
      out["downloads.html"],
      "prose-body",
      pageTitleBanner("Downloads") + downloadsHtml(docModel),
    );
  }

  if (out["financials/notes.html"]) {
    let html = out["financials/notes.html"];
    if (!/<h1[\s>]/i.test(html)) {
      const banner = pageTitleBanner("Notes to the financial statements");
      html = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${banner}`);
    }
    out["financials/notes.html"] = anchorNotes(html, docModel);
  }

  // Statement page titles
  for (const page of plan.pages) {
    if (!page.path.startsWith("financials/") || page.path.endsWith("notes.html")) continue;
    const html = out[page.path];
    if (!html || /page-title-banner/.test(html)) continue;
    const banner = pageTitleBanner(page.title);
    out[page.path] = html.replace(/(<main[^>]*>)/i, (_m, open: string) => `${open}${banner}`);
  }

  return out;
}
