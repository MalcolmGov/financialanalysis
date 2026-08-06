import { desc } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { env } from "../lib/env";
import { NewProject } from "./new-project";

async function listProjects() {
  if (env.MOCK_BLOB) return [];
  try {
    return await db().select().from(schema.projects).orderBy(desc(schema.projects.createdAt));
  } catch {
    return [];
  }
}

export default async function Home() {
  const projects = await listProjects();
  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section>
        <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Projects</h1>
        <p style={{ color: "var(--ink-2)", margin: 0 }}>
          Each project turns one results PDF into a verified interactive microsite.
        </p>
      </section>

      <NewProject />

      <section style={{ display: "grid", gap: 8 }}>
        {projects.length === 0 ? (
          <p style={{ color: "var(--ink-2)" }}>
            No projects yet. Create one above to begin the nine-step pipeline.
          </p>
        ) : (
          projects.map((p) => (
            <a
              key={p.id}
              href={`/projects/${p.id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "14px 16px",
                border: "1px solid var(--rule)",
                borderRadius: 8,
                textDecoration: "none",
                color: "var(--ink)",
              }}
            >
              <span>
                <strong>{p.companyName}</strong>
                {p.periodLabel ? (
                  <span style={{ color: "var(--ink-2)" }}> · {p.periodLabel}</span>
                ) : null}
              </span>
              <span style={{ fontSize: 12, color: "var(--gold-deep)", letterSpacing: ".06em" }}>
                {p.status.toUpperCase()}
              </span>
            </a>
          ))
        )}
      </section>
    </div>
  );
}
