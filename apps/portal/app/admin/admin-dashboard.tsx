import type { AdminOverview } from "../../lib/admin-data";

function fmtUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const mins = ms / 60_000;
  if (mins < 1) return `${Math.round(ms / 1000)}s`;
  if (mins < 90) return `${mins.toFixed(mins < 10 ? 1 : 0)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function fmtWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function prettyStatus(s: string): string {
  return s.replaceAll("_", " ");
}

function CostSparkline({
  days,
}: {
  days: AdminOverview["costByDay"];
}) {
  const w = 520;
  const h = 120;
  const pad = 8;
  const values = days.map((d) => Math.max(d.ledgerUsd, d.prototypeUsd));
  const max = Math.max(...values, 0.01);
  const n = Math.max(days.length - 1, 1);
  const points = days
    .map((d, i) => {
      const v = Math.max(d.ledgerUsd, d.prototypeUsd);
      const x = pad + (i / n) * (w - pad * 2);
      const y = h - pad - (v / max) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const area = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;
  const last = days[days.length - 1];
  const first = days[0];

  return (
    <div className="rs-admin-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Spend over the last 30 days">
        <defs>
          <linearGradient id="rsAdminSpendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(42, 95, 90, 0.28)" />
            <stop offset="100%" stopColor="rgba(42, 95, 90, 0)" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#rsAdminSpendFill)" />
        <polyline
          points={points}
          fill="none"
          stroke="var(--signal)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="rs-admin-chart__meta">
        <span>{first?.day ?? "—"}</span>
        <span>30-day spend</span>
        <span>{last?.day ?? "—"}</span>
      </div>
    </div>
  );
}

function StatusBars({ rows }: { rows: AdminOverview["projectsByStatus"] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  if (rows.length === 0) {
    return <p className="rs-muted">No projects yet.</p>;
  }
  return (
    <ul className="rs-admin-bars">
      {rows.map((r) => (
        <li key={r.status}>
          <span className="rs-admin-bars__label">{prettyStatus(r.status)}</span>
          <span className="rs-admin-bars__track" aria-hidden>
            <span style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="rs-admin-bars__value">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function SpendBars({ rows }: { rows: AdminOverview["costByProject"] }) {
  const max = Math.max(...rows.map((r) => r.prototypeSpendUsd), 0.01);
  if (rows.length === 0) {
    return <p className="rs-muted">No prototype spend recorded yet.</p>;
  }
  return (
    <ul className="rs-admin-bars rs-admin-bars--spend">
      {rows.map((r) => (
        <li key={r.projectId}>
          <span className="rs-admin-bars__label">
            <a href={`/projects/${r.projectId}`}>{r.companyName}</a>
            {r.periodLabel ? <span className="rs-project-meta"> · {r.periodLabel}</span> : null}
          </span>
          <span className="rs-admin-bars__track" aria-hidden>
            <span style={{ width: `${(r.prototypeSpendUsd / max) * 100}%` }} />
          </span>
          <span className="rs-admin-bars__value">{fmtUsd(r.prototypeSpendUsd)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AdminDashboard({ data }: { data: AdminOverview }) {
  const { kpis } = data;
  const spendSeriesTotal = data.costByDay.reduce(
    (s, d) => s + Math.max(d.ledgerUsd, d.prototypeUsd),
    0,
  );

  return (
    <div className="rs-admin rs-fade-up">
      <section className="rs-admin-hero">
        <p className="rs-kicker">Operator</p>
        <h1>Admin</h1>
        <p className="rs-lede">
          Costs, pipeline activity, and run health across Results Studio — visibility for operators,
          not a second console.
        </p>
        <p className="rs-tiny" style={{ marginTop: 14 }}>
          {data.authNote}
        </p>
      </section>

      <section className="rs-admin-section rs-fade-up-delay">
        <p className="rs-kicker">Overview</p>
        <h2 className="rs-section-title">At a glance</h2>
        <div className="rs-admin-kpi-grid">
          <div>
            <p className="rs-stat-label">Projects</p>
            <p className="rs-stat-value">{kpis.projectCount}</p>
          </div>
          <div>
            <p className="rs-stat-label">Tracked spend</p>
            <p className="rs-stat-value">{fmtUsd(kpis.trackedSpendUsd)}</p>
          </div>
          <div>
            <p className="rs-stat-label">Exports</p>
            <p className="rs-stat-value">{kpis.exportCount}</p>
          </div>
          <div>
            <p className="rs-stat-label">Runs ok / failed</p>
            <p className="rs-stat-value">
              {kpis.runsSucceeded}
              <span className="rs-admin-kpi-split">/</span>
              {kpis.runsFailed}
            </p>
          </div>
          <div>
            <p className="rs-stat-label">Running</p>
            <p className="rs-stat-value">{kpis.runsRunning}</p>
          </div>
          <div>
            <p className="rs-stat-label">Typical duration</p>
            <p className="rs-stat-value">{fmtDuration(kpis.medianRunDurationMs)}</p>
            <p className="rs-tiny" style={{ marginTop: 8 }}>
              avg {fmtDuration(kpis.avgRunDurationMs)} · completed runs
            </p>
          </div>
        </div>

        <div className="rs-admin-split" style={{ marginTop: 36 }}>
          <div>
            <p className="rs-kicker">Status mix</p>
            <StatusBars rows={data.projectsByStatus} />
          </div>
          <div>
            <p className="rs-kicker">Spend · 30 days</p>
            <p className="rs-admin-chart-total">{fmtUsd(spendSeriesTotal)}</p>
            <CostSparkline days={data.costByDay} />
          </div>
        </div>
      </section>

      <section className="rs-admin-section">
        <p className="rs-kicker">Costs</p>
        <h2 className="rs-section-title">Where spend lands</h2>
        <p className="rs-lede" style={{ marginBottom: 20 }}>
          {data.coverage.prototypeSpendLabel}: {fmtUsd(kpis.prototypeSpendUsd)}.{" "}
          {data.coverage.ledgerSpendLabel}: {fmtUsd(kpis.ledgerSpendUsd)}.
        </p>
        <ul className="rs-admin-gaps">
          {data.coverage.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>

        <div className="rs-admin-split" style={{ marginTop: 28 }}>
          <div>
            <p className="rs-kicker">Top projects</p>
            <SpendBars rows={data.costByProject} />
          </div>
          <div>
            <p className="rs-kicker">By model</p>
            {data.costByModel.length === 0 ? (
              <p className="rs-muted">No model attribution yet.</p>
            ) : (
              <ul className="rs-admin-model-list">
                {data.costByModel.slice(0, 10).map((m) => (
                  <li key={`${m.source}-${m.model}`}>
                    <span>
                      <strong>{m.model}</strong>
                      <span className="rs-project-meta"> · {m.source}</span>
                    </span>
                    <span>
                      {fmtUsd(m.spendUsd)}
                      <span className="rs-project-meta"> · {m.calls}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {data.costByProject.length > 0 ? (
          <div style={{ marginTop: 32 }}>
            <p className="rs-kicker">Version detail</p>
            <ul className="rs-admin-detail-list">
              {data.costByProject.map((p) => (
                <li key={`detail-${p.projectId}`}>
                  <a href={`/projects/${p.projectId}`}>
                    <strong>{p.companyName}</strong>
                    {p.periodLabel ? (
                      <span className="rs-project-meta"> · {p.periodLabel}</span>
                    ) : null}
                  </a>
                  <span className="rs-admin-detail-list__meta">
                    {p.versionCount} version{p.versionCount === 1 ? "" : "s"}
                    {p.models.length ? ` · ${p.models.join(", ")}` : ""}
                    {" · "}
                    {fmtUsd(p.prototypeSpendUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rs-admin-section">
        <p className="rs-kicker">Activity</p>
        <h2 className="rs-section-title">Audit trail</h2>
        <p className="rs-lede" style={{ marginBottom: 20 }}>
          Pipeline events and governance actions across projects.
        </p>

        <div className="rs-admin-split">
          <div>
            <p className="rs-kicker">Recent events</p>
            {data.activity.length === 0 ? (
              <p className="rs-muted">No run events yet.</p>
            ) : (
              <ol className="rs-admin-timeline">
                {data.activity.map((e) => (
                  <li key={e.id}>
                    <time dateTime={e.createdAt}>{fmtWhen(e.createdAt)}</time>
                    <div>
                      <strong>{e.type}</strong>
                      <span className="rs-project-meta">
                        {" "}
                        · {e.companyName}
                        {e.periodLabel ? ` · ${e.periodLabel}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <p className="rs-kicker">Approvals</p>
            {data.approvals.length === 0 ? (
              <p className="rs-muted">No approval records yet.</p>
            ) : (
              <ol className="rs-admin-timeline">
                {data.approvals.map((a) => (
                  <li key={a.id}>
                    <time dateTime={a.createdAt}>{fmtWhen(a.createdAt)}</time>
                    <div>
                      <strong>{prettyStatus(a.action)}</strong>
                      <span className="rs-project-meta"> · {a.companyName}</span>
                      {a.note ? <p className="rs-tiny">{a.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>

      <section className="rs-admin-section">
        <p className="rs-kicker">Runs</p>
        <h2 className="rs-section-title">Recent pipeline runs</h2>
        {data.recentRuns.length === 0 ? (
          <p className="rs-muted" style={{ marginTop: 16 }}>
            No pipeline runs yet.
          </p>
        ) : (
          <ul className="rs-admin-run-list">
            {data.recentRuns.map((r) => (
              <li key={r.runId}>
                <a href={`/projects/${r.projectId}`} className="rs-admin-run-row">
                  <span>
                    <strong>{r.companyName}</strong>
                    {r.periodLabel ? (
                      <span className="rs-project-meta"> · {r.periodLabel}</span>
                    ) : null}
                    <span className="rs-admin-run-row__sub">
                      {fmtWhen(r.createdAt)}
                      {r.currentStep ? ` · ${prettyStatus(r.currentStep)}` : ""}
                      {r.durationMs != null ? ` · ${fmtDuration(r.durationMs)}` : ""}
                    </span>
                  </span>
                  <span className="rs-status">{prettyStatus(r.status)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="rs-tiny" style={{ marginTop: 20 }}>
          Snapshot {fmtWhen(data.generatedAt)} · also available at{" "}
          <code>/api/admin/overview</code>
        </p>
      </section>
    </div>
  );
}
