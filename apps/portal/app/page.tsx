import { desc } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { env } from "../lib/env";
import { requireOperatorOrRedirect } from "../lib/authz";
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
  await requireOperatorOrRedirect();
  const projects = await listProjects();
  return (
    <div className="rs-home rs-fade-up">
      <section className="rs-home-hero">
        <p className="rs-kicker">Results Studio</p>
        <h1>Projects</h1>
        <p className="rs-lede">
          One results PDF becomes a verified interactive microsite — measured DNA, human gates,
          export-ready HTML.
        </p>
      </section>

      <NewProject />

      <section className="rs-fade-up-delay">
        <p className="rs-kicker">Library</p>
        {projects.length === 0 ? (
          <p className="rs-muted" style={{ margin: "16px 0 0" }}>
            No projects yet. Create one above to begin.
          </p>
        ) : (
          <ul className="rs-project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <a href={`/projects/${p.id}`} className="rs-project-row">
                  <span>
                    <strong>{p.companyName}</strong>
                    {p.periodLabel ? (
                      <span className="rs-project-meta"> · {p.periodLabel}</span>
                    ) : null}
                  </span>
                  <span className="rs-status">{p.status.replaceAll("_", " ")}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
