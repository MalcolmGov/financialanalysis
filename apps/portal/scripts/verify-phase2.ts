/**
 * Verify Phase 2 drafts: note groups + Group/Company books + no blank commentary.
 *
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/verify-phase2.ts <runId:vN:label> [...]
 */
import { getPrivate } from "../lib/blob";

type Target = { runId: string; version: number; label: string };

const targets: Target[] = process.argv.slice(2).map((arg) => {
  const [runId, version, label] = arg.split(":");
  if (!runId || !version || !label) throw new Error(`bad arg ${arg}`);
  return { runId, version: Number(version), label };
});

async function verify(t: Target) {
  const prefix = `runs/${t.runId}/site-draft/v${t.version}`;
  let nav: { label: string; href: string }[] = [];
  let pages: string[] = [];
  try {
    const sp = JSON.parse(
      (await getPrivate(`${prefix}/_meta/site-plan.json`)).toString("utf8"),
    ) as { nav?: { label: string; href: string }[]; pages?: { path: string }[] };
    nav = sp.nav ?? [];
    pages = (sp.pages ?? []).map((p) => p.path);
  } catch {
    const draft = JSON.parse(
      (await getPrivate(`${prefix}/_meta/draft.json`)).toString("utf8"),
    ) as { files?: string[] };
    pages = draft.files?.filter((f) => f.endsWith(".html")) ?? [];
  }

  const commentary = (await getPrivate(`${prefix}/commentary.html`)).toString("utf8");
  const blank =
    /Commentary will appear when the extraction includes a shareholder letter/i.test(
      commentary,
    );
  const proseLen = commentary.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;

  const hasGroupBook = pages.some((p) => p.startsWith("financials/group/"));
  const hasCompanyBook = pages.some((p) => p.startsWith("financials/company/"));
  const noteGroups = pages.filter(
    (p) =>
      /^financials\/(?:(?:group|company)\/)?notes-(?:\d+(?:-\d+)?|part-\d+)\.html$/.test(
        p,
      ),
  );

  const checks = {
    label: t.label,
    prefix,
    pageCount: pages.length,
    hasDirectorsPage: pages.includes("directors-report.html"),
    hasAuditorPage: pages.includes("auditors-report.html"),
    hasPoliciesPage: pages.includes("financials/accounting-policies.html"),
    hasGroupBook,
    hasCompanyBook,
    noteGroupPages: noteGroups,
    navFinancials: nav
      .filter((n) => n.href.startsWith("financials/"))
      .map((n) => n.label),
    commentaryBlankPlaceholder: blank,
    commentaryProseChars: proseLen,
  };
  console.log(JSON.stringify(checks, null, 2));
  return checks;
}

const results = [];
for (const t of targets) results.push(await verify(t));

const fails = results.filter(
  (r) =>
    r.commentaryBlankPlaceholder ||
    r.commentaryProseChars < 200 ||
    (r.label.toLowerCase().includes("mtn") &&
      (!r.hasGroupBook || !r.hasCompanyBook || r.noteGroupPages.length < 1)),
);
if (fails.length) {
  console.error(
    "VERIFICATION FAILED",
    fails.map((f) => f.label),
  );
  process.exit(1);
}
console.log("VERIFICATION OK");
