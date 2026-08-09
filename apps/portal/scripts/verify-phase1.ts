/**
 * Verify Phase 1 rebuild drafts: nav expansion + commentary never-drop.
 *
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/verify-phase1.ts <runId:vN:label> [...]
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
  const planRaw = await getPrivate(`${prefix}/_meta/site-plan.json`).catch(async () => {
    // fallback: draft.json may list files
    return getPrivate(`${prefix}/_meta/draft.json`);
  });
  let nav: string[] = [];
  let pages: string[] = [];
  try {
    const plan = JSON.parse(planRaw.toString("utf8")) as {
      nav?: { label: string; href: string }[];
      pages?: { path: string; title: string }[];
      files?: string[];
    };
    nav = (plan.nav ?? []).map((n) => n.href);
    pages = (plan.pages ?? []).map((p) => p.path);
    if (!pages.length && plan.files) pages = plan.files.filter((f) => f.endsWith(".html"));
  } catch {
    /* draft.json shape */
    const draft = JSON.parse(planRaw.toString("utf8")) as { files?: string[]; pages?: number };
    pages = draft.files ?? [];
  }

  // Prefer site-plan artifact if draft was loaded
  if (!nav.length) {
    try {
      const sp = JSON.parse(
        (await getPrivate(`${prefix}/_meta/site-plan.json`)).toString("utf8"),
      ) as { nav?: { href: string }[]; pages?: { path: string }[] };
      nav = (sp.nav ?? []).map((n) => n.href);
      pages = (sp.pages ?? []).map((p) => p.path);
    } catch {
      /* ignore */
    }
  }

  const commentary = (await getPrivate(`${prefix}/commentary.html`)).toString("utf8");
  const blank =
    /Commentary will appear when the extraction includes a shareholder letter/i.test(
      commentary,
    );
  const hasDirectorsBand = /id="directors-report"|Directors' report/i.test(commentary);
  const hasLetter = /id="letter"|Letter to shareholders/i.test(commentary);
  const proseLen = commentary.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;

  const checks = {
    label: t.label,
    prefix,
    pageCount: pages.length || "unknown",
    navSample: nav.slice(0, 20),
    hasDirectorsPage: pages.includes("directors-report.html") || nav.includes("directors-report.html"),
    hasAuditorPage: pages.includes("auditors-report.html") || nav.includes("auditors-report.html"),
    hasPoliciesPage:
      pages.includes("financials/accounting-policies.html") ||
      nav.includes("financials/accounting-policies.html"),
    hasNoteGroups: pages.some((p) => /^financials\/notes-\d/.test(p)),
    commentaryBlankPlaceholder: blank,
    commentaryHasLetter: hasLetter,
    commentaryHasDirectors: hasDirectorsBand,
    commentaryProseChars: proseLen,
  };
  console.log(JSON.stringify(checks, null, 2));
  return checks;
}

const results = [];
for (const t of targets) results.push(await verify(t));

const fails = results.filter(
  (r) => r.commentaryBlankPlaceholder || r.commentaryProseChars < 200,
);
if (fails.length) {
  console.error("VERIFICATION FAILED", fails.map((f) => f.label));
  process.exit(1);
}
console.log("VERIFICATION OK");
