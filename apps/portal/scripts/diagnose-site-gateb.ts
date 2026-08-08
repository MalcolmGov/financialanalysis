/**
 * Diagnose Gate B failures for a portal project's latest DNA + extraction.
 * Prints failure summary and locates bare untraceable tokens with DOM ancestry.
 *
 * Usage:
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... \
 *     pnpm exec tsx scripts/diagnose-site-gateb.ts [projectId]
 */
import { createRequire } from "node:module";
import { desc, eq } from "drizzle-orm";
import { NUMERIC_TOKEN } from "@rs/render";
import { getPrivate } from "../lib/blob";
import { buildMultipageExport } from "../lib/build-multipage-export";
import { db, schema } from "../lib/db";

const require = createRequire(import.meta.url);
const linkedomPath = require.resolve("linkedom", {
  paths: [new URL("../../../packages/render/", import.meta.url).pathname],
});
const { parseHTML } = await import(linkedomPath);

const PROJECT_ID = process.argv[2] ?? "444cd443-97cc-4b9c-b0f6-eef4f65c2f98";

function hasTraceable(node: { parentElement: Element | null }): boolean {
  let el: Element | null = node.parentElement;
  while (el) {
    if (el.hasAttribute("data-src") || el.hasAttribute("data-allow-number")) return true;
    const tag = el.tagName?.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "th") return true;
    el = el.parentElement;
  }
  return false;
}

async function main() {
  const [run] = await db()
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, PROJECT_ID))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  if (!run) throw new Error("no run");
  const arts = await db()
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.runId, run.id));
  const dna = JSON.parse(
    (await getPrivate(arts.find((a) => a.kind === "design_dna")!.blobPath)).toString("utf8"),
  );
  const extraction = JSON.parse(
    (await getPrivate(arts.find((a) => a.kind === "extraction_result")!.blobPath)).toString(
      "utf8",
    ),
  );
  const [project] = await db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, PROJECT_ID));
  console.log(
    JSON.stringify({
      projectId: PROJECT_ID,
      runId: run.id,
      company: project!.companyName,
      periodLabel: project!.periodLabel,
    }),
  );
  const built = buildMultipageExport({
    dna,
    extraction,
    projectId: PROJECT_ID,
    company: project!.companyName,
    periodLabel: project!.periodLabel ?? "",
    sourcePdfBytes: null,
  });
  console.log("gateA", built.gateA.status, "gateB", built.gateB.status);
  const fails = built.gateB.failures ?? [];
  console.log("fail count", fails.length, "tokens", built.gateB.numeric_tokens_found);
  const byReason = new Map<string, number>();
  for (const f of fails) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
  console.log("byReason", Object.fromEntries(byReason));
  for (const f of fails.slice(0, 20)) {
    console.log(JSON.stringify({ page: f.page, token: f.token, reason: f.reason, src: f.data_src }));
  }

  if (fails.length === 0) return;

  for (const page of [...new Set(fails.map((f) => f.page))]) {
    const html = built.files[page] ?? "";
    const { document } = parseHTML(html);
    const walker = document.createTreeWalker(document.body ?? document, 0x4);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      if (NUMERIC_TOKEN.test(text) && !hasTraceable(node as { parentElement: Element | null })) {
        const toks = text
          .split(/\s+/)
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && NUMERIC_TOKEN.test(t));
        const parent = (node as unknown as { parentElement: Element | null }).parentElement;
        console.log(
          "FOUND",
          JSON.stringify({
            page,
            toks: toks.slice(0, 8),
            text: text.slice(0, 160),
            tag: parent?.tagName,
            className: parent?.getAttribute("class"),
            outer: parent?.outerHTML?.slice(0, 240),
          }),
        );
      }
      node = walker.nextNode();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
