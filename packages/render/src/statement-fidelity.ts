/**
 * P2 — statement IR fidelity checks for multipage financial HTML.
 * Structural/skin gates only — numbers remain Gate A/B's job.
 */

import type { ReliabilityFinding } from "./corporate-reliability.js";

const STATEMENT_PAGE =
  /financials\/(income-statement|balance-sheet|cash-flows|changes-in-equity|equity)\.html$/i;

export function isStatementFinancialPage(path: string): boolean {
  return STATEMENT_PAGE.test(path);
}

function finding(
  ok: boolean,
  code: string,
  path: string,
  message: string,
): ReliabilityFinding {
  return { ok, code, path, message };
}

/** Strip style/script so structural checks don't match CSS class names. */
function markupOnly(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
}

/**
 * Assert a financial statement page carries WW-recognizable IR table chrome.
 * Safe to run on balance sheet / income / cash flows / equity pages.
 */
export function checkStatementIrFidelity(
  html: string,
  path: string,
): ReliabilityFinding[] {
  const findings: ReliabilityFinding[] = [];
  const markup = markupOnly(html);
  const hasTable =
    /class="[^"]*fin-table/.test(markup) || /<table class="fin-table"/.test(markup);
  const hasEmptyState = /data-dna-component="statement-empty"/.test(markup);
  if (!hasTable) {
    findings.push(
      finding(
        hasEmptyState,
        "statement-fin-table",
        path,
        hasEmptyState
          ? `${path}: no .fin-table — documented empty-state (extraction gap)`
          : `${path}: missing .fin-table`,
      ),
    );
    return findings;
  }

  findings.push(
    finding(
      html.includes("/* rs-statement-ir */") || html.includes("rs-statement-ir"),
      "statement-ir-css",
      path,
      html.includes("rs-statement-ir")
        ? `${path}: rs-statement-ir skin present`
        : `${path}: rs-statement-ir CSS marker missing`,
    ),
  );

  // Stable thead (WW sofp): grey period headers — sticky+overflow was clipping.
  findings.push(
    finding(
      /\.fin-table\s+thead\s+th\.h-fig/.test(html) ||
        /thead th\.h-fig/.test(html) ||
        /class="[^"]*\bh-fig\b/.test(markup),
      "statement-stable-thead",
      path,
      /h-fig/.test(html)
        ? `${path}: period header (h-fig) thead present`
        : `${path}: period header (h-fig) thead missing`,
    ),
  );

  const hasCurCol = /data-cur-col="\d+"/.test(markup);
  const hasYearHeader = /\b((?:19|20)\d{2})\b/.test(
    (markup.match(/<thead[\s\S]*?<\/thead>/i) ?? [""])[0]!,
  );
  if (hasCurCol || hasYearHeader) {
    findings.push(
      finding(
        hasCurCol,
        "statement-cur-col",
        path,
        hasCurCol
          ? `${path}: current-period column shading marked`
          : `${path}: period years in header but data-cur-col missing`,
      ),
    );
  } else {
    findings.push(
      finding(
        true,
        "statement-cur-col",
        path,
        `${path}: no period-year columns (e.g. equity) — cur-col N/A`,
      ),
    );
  }

  findings.push(
    finding(
      /class="[^"]*r-(section|line|subtotal|total)/.test(markup),
      "statement-row-taxonomy",
      path,
      /r-(section|line|subtotal|total)/.test(markup)
        ? `${path}: semantic row roles present`
        : `${path}: r-section/line/subtotal/total missing`,
    ),
  );

  findings.push(
    finding(
      /\bbd-tan\b/.test(markup) && /\bgrp\b/.test(markup),
      "statement-grp-bd",
      path,
      /\bbd-tan\b/.test(markup) && /\bgrp\b/.test(markup)
        ? `${path}: grp/bd border classes present`
        : `${path}: grp/bd border classes missing`,
    ),
  );

  const stacked =
    /\bh-fig\b/.test(markup) &&
    (markup.includes("h-fig__date") ||
      markup.includes("h-fig__lead") ||
      /As at<br>/i.test(markup) ||
      /ended<br>/i.test(markup));
  findings.push(
    finding(
      stacked || /\bh-fig\b/.test(markup),
      "statement-stacked-headers",
      path,
      stacked || /\bh-fig\b/.test(markup)
        ? `${path}: period/figure headers present`
        : `${path}: stacked period headers (h-fig) missing`,
    ),
  );

  findings.push(
    finding(
      markup.includes("statement-unit") && /statement-unit__value/.test(markup),
      "statement-unit-chrome",
      path,
      markup.includes("statement-unit")
        ? `${path}: UNIT chrome present`
        : `${path}: statement-unit chrome missing`,
    ),
  );

  const goldRule =
    /border-top:\s*2px\s+solid\s+var\(--dna-brand/.test(html) ||
    /border-top:2px solid var\(--dna-brand/.test(html);
  findings.push(
    finding(
      goldRule,
      "statement-gold-rule",
      path,
      goldRule
        ? `${path}: gold top rule on statement table`
        : `${path}: gold top rule CSS missing`,
    ),
  );

  // Note links required only when note cells carry digits (ignore empty note cols / CSS).
  const hasNoteLinks = /notes\.html#note-\d+/.test(markup);
  const noteCellsWithDigits = [
    ...markup.matchAll(
      /<td\b[^>]*class="[^"]*(?:cell-noteRef|\bnote\b)[^"]*"[^>]*>([\s\S]*?)<\/td>/gi,
    ),
  ].filter((m) => /\d/.test(m[1] ?? ""));
  if (noteCellsWithDigits.length > 0 || hasNoteLinks) {
    findings.push(
      finding(
        hasNoteLinks,
        "statement-note-links",
        path,
        hasNoteLinks
          ? `${path}: live notes.html#note-N links present`
          : `${path}: note digits without notes.html#note-N links`,
      ),
    );
  }

  const printCss =
    /@media\s+print\s*\{[\s\S]*?\.fin-table/.test(html) ||
    (/@media\s+print/.test(html) && /print-color-adjust/.test(html));
  findings.push(
    finding(
      printCss,
      "statement-print-css",
      path,
      printCss
        ? `${path}: print-friendly statement CSS present`
        : `${path}: @media print statement rules missing`,
    ),
  );

  return findings;
}

/** Run IR fidelity on all statement financial pages in a site tree. */
export function auditStatementIrFidelity(files: Record<string, string>): {
  ok: boolean;
  findings: ReliabilityFinding[];
} {
  const findings: ReliabilityFinding[] = [];
  const paths = Object.keys(files)
    .filter((p) => isStatementFinancialPage(p))
    .sort();
  if (paths.length === 0) {
    return {
      ok: false,
      findings: [
        {
          ok: false,
          code: "statement-pages-missing",
          message: "No financial statement pages found for IR fidelity audit",
        },
      ],
    };
  }
  for (const path of paths) {
    findings.push(...checkStatementIrFidelity(files[path]!, path));
  }
  return { ok: findings.every((f) => f.ok), findings };
}
