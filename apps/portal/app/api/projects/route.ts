import { desc } from "drizzle-orm";
import { requireOperator } from "../../../lib/authz";
import { db, schema } from "../../../lib/db";
import { env } from "../../../lib/env";

export async function GET(): Promise<Response> {
  try {
    await requireOperator();
  } catch (res) {
    return res as Response;
  }
  if (env.MOCK_BLOB) return Response.json({ projects: [] });
  const rows = await db()
    .select()
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt));
  return Response.json({ projects: rows });
}

export async function POST(request: Request): Promise<Response> {
  let operator;
  try {
    operator = await requireOperator();
  } catch (res) {
    return res as Response;
  }
  const { companyName, periodLabel } = (await request.json()) as {
    companyName: string;
    periodLabel?: string;
  };
  if (!companyName) return Response.json({ error: "companyName required" }, { status: 400 });

  if (env.MOCK_BLOB) {
    return Response.json({ project: { id: crypto.randomUUID(), companyName, status: "created" } });
  }
  // v1: a single implicit org. Ensure one exists, then create the project.
  let [org] = await db().select().from(schema.orgs).limit(1);
  if (!org) [org] = await db().insert(schema.orgs).values({ name: "default" }).returning();
  const [project] = await db()
    .insert(schema.projects)
    .values({ orgId: org.id, companyName, periodLabel, createdBy: null })
    .returning();
  return Response.json({ project });
}
