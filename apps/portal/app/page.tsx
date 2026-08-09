import { desc } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { env } from "../lib/env";
import { requireOperatorOrRedirect } from "../lib/authz";
import { statusToneClass } from "../lib/status-tone";
import { NewProject } from "./new-project";

async function listProjects() {
  if (env.MOCK_BLOB) return [];
  try {
    return await db().select().from(schema.projects).orderBy(desc(schema.projects.createdAt));
  } catch {
    return [];
  }
}

function summarize(projects: { status: string }[]) {
  let live = 0;
  let review = 0;
  let exported = 0;
  for (const p of projects) {
    const s = p.status.toLowerCase();
    if (
      s.includes("extract") ||
      s.includes("detect") ||
      s.includes("generat") ||
      s.includes("exporting")
    ) {
      live += 1;
    } else if (s.includes("review") || s.includes("ready") || s.includes("blueprint") || s === "uploaded") {
      review += 1;
    } else if (s === "exported" || s.includes("publish")) {
      exported += 1;
    }
  }
  return { total: projects.length, live, review, exported };
}

export default async function Home() {
  await requireOperatorOrRedirect();
  const projects = await listProjects();
  const stats = summarize(projects);

  return (
    <div className="rs-home rs-fade-up">
      <section className="rs-home-hero">
        <p className="rs-kicker">Results Studio · Live</p>
        <h1>Projects</h1>
        <p className="rs-lede">
          One results PDF becomes a verified interactive microsite — measured DNA, human gates,
          export-ready HTML.
        </p>
        <div className="rs-metric-strip" aria-label="Programme snapshot">
          <div className="rs-metric rs-metric--live">
            <span className="rs-metric__label">Active</span>
            <span className="rs-metric__value">{stats.total}</span>
            <span className="rs-metric__hint">projects in library</span>
          </div>
          <div className="rs-metric rs-metric--warn">
            <span className="rs-metric__label">In flight</span>
            <span className="rs-metric__value">{stats.live}</span>
            <span className="rs-metric__hint">pipeline running</span>
          </div>
          <div className="rs-metric rs-metric--review">
            <span className="rs-metric__label">Needs review</span>
            <span className="rs-metric__value">{stats.review}</span>
            <span className="rs-metric__hint">DNA or site gates</span>
          </div>
          <div className="rs-metric rs-metric--ok">
            <span className="rs-metric__label">Exported</span>
            <span className="rs-metric__value">{stats.exported}</span>
            <span className="rs-metric__hint">ready packs</span>
          </div>
        </div>
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
                  <span className={`rs-status ${statusToneClass(p.status)}`}>
                    {p.status.replaceAll("_", " ")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
