import { desc, eq } from "drizzle-orm";
import { db, schema } from "../lib/db";

const id = process.argv[2] ?? "f3cc2ac8-29be-478c-babf-29677edabc8f";

async function main() {
  const [p] = await db()
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  console.log("project", p?.companyName, p?.periodLabel, p?.status);
  const [run] = await db()
    .select()
    .from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.projectId, id))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(1);
  console.log("run", run?.id, run?.status);
  if (!run) return;
  const arts = await db()
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.runId, run.id))
    .orderBy(desc(schema.artifacts.createdAt));
  console.log(
    "arts",
    arts.map((a) => `${a.kind}`).slice(0, 20),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
