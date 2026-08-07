import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { env } from "./env";

export type AdminOverview = {
  generatedAt: string;
  /**
   * Auth note for operators: there is no separate admin role yet — the Admin
   * area is gated to the same authenticated operator allowlist as the rest of
   * the portal (`requireOperator` / `OPERATOR_EMAILS`).
   */
  authNote: string;
  coverage: {
    prototypeSpendLabel: string;
    ledgerSpendLabel: string;
    /** Honest gap: historical DNA spend was not persisted before this Admin work. */
    gaps: string[];
  };
  kpis: {
    projectCount: number;
    runCount: number;
    runsSucceeded: number;
    runsFailed: number;
    runsRunning: number;
    exportCount: number;
    /** Prefer model ledger when present; else prototype version rollup. */
    trackedSpendUsd: number;
    prototypeSpendUsd: number;
    ledgerSpendUsd: number;
    avgRunDurationMs: number | null;
    medianRunDurationMs: number | null;
  };
  projectsByStatus: { status: string; count: number }[];
  costByProject: {
    projectId: string;
    companyName: string;
    periodLabel: string | null;
    status: string;
    prototypeSpendUsd: number;
    versionCount: number;
    models: string[];
  }[];
  costByDay: { day: string; prototypeUsd: number; ledgerUsd: number }[];
  costByModel: { model: string; source: "prototype" | "ledger"; spendUsd: number; calls: number }[];
  recentRuns: {
    runId: string;
    projectId: string;
    companyName: string;
    periodLabel: string | null;
    status: string;
    currentStep: string | null;
    createdAt: string;
    completedAt: string | null;
    durationMs: number | null;
  }[];
  activity: {
    id: number;
    type: string;
    createdAt: string;
    runId: string;
    projectId: string;
    companyName: string;
    periodLabel: string | null;
  }[];
  approvals: {
    id: string;
    action: string;
    projectId: string;
    companyName: string;
    createdAt: string;
    note: string | null;
  }[];
};

function microsToUsd(micros: number | null | undefined): number {
  if (micros == null) return 0;
  return Number(micros) / 1e6;
}

function parseCostUsd(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function emptyOverview(): AdminOverview {
  return {
    generatedAt: new Date().toISOString(),
    authNote:
      "Gated to authenticated operators (same allowlist as Projects). No separate admin role exists yet.",
    coverage: {
      prototypeSpendLabel: "Prototype versions (studio / refine / KPI when recorded)",
      ledgerSpendLabel: "Model ledger (DNA + KPI + studio + refine)",
      gaps: [
        "Historical DNA vision spend was not persisted — only new runs write detect_dna to the model ledger.",
        "Older prototype rows may be studio/refine only (KPI + DNA missing).",
      ],
    },
    kpis: {
      projectCount: 0,
      runCount: 0,
      runsSucceeded: 0,
      runsFailed: 0,
      runsRunning: 0,
      exportCount: 0,
      trackedSpendUsd: 0,
      prototypeSpendUsd: 0,
      ledgerSpendUsd: 0,
      avgRunDurationMs: null,
      medianRunDurationMs: null,
    },
    projectsByStatus: [],
    costByProject: [],
    costByDay: [],
    costByModel: [],
    recentRuns: [],
    activity: [],
    approvals: [],
  };
}

export async function loadAdminOverview(): Promise<AdminOverview> {
  if (env.MOCK_BLOB) return emptyOverview();

  try {
    return await loadAdminOverviewLive();
  } catch (err) {
    console.error("[admin-data]", err);
    const fallback = emptyOverview();
    fallback.coverage.gaps = [
      "Could not load live admin data — check database connectivity.",
      ...fallback.coverage.gaps,
    ];
    return fallback;
  }
}

async function loadAdminOverviewLive(): Promise<AdminOverview> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    projectRows,
    statusRows,
    runRows,
    exportRows,
    versionRows,
    ledgerRows,
    eventRows,
    approvalRows,
  ] = await Promise.all([
    db().select({ id: schema.projects.id }).from(schema.projects),
    db()
      .select({
        status: schema.projects.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.projects)
      .groupBy(schema.projects.status),
    db()
      .select({
        id: schema.pipelineRuns.id,
        projectId: schema.pipelineRuns.projectId,
        status: schema.pipelineRuns.status,
        currentStep: schema.pipelineRuns.currentStep,
        createdAt: schema.pipelineRuns.createdAt,
        completedAt: schema.pipelineRuns.completedAt,
        companyName: schema.projects.companyName,
        periodLabel: schema.projects.periodLabel,
      })
      .from(schema.pipelineRuns)
      .innerJoin(schema.projects, eq(schema.pipelineRuns.projectId, schema.projects.id))
      .orderBy(desc(schema.pipelineRuns.createdAt))
      .limit(40),
    db()
      .select({ id: schema.artifacts.id })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.kind, "export_bundle")),
    db()
      .select({
        projectId: schema.prototypeVersions.projectId,
        companyName: schema.projects.companyName,
        periodLabel: schema.projects.periodLabel,
        status: schema.projects.status,
        costUsdMicros: schema.prototypeVersions.costUsdMicros,
        model: schema.prototypeVersions.model,
        createdAt: schema.prototypeVersions.createdAt,
      })
      .from(schema.prototypeVersions)
      .innerJoin(schema.projects, eq(schema.prototypeVersions.projectId, schema.projects.id)),
    db()
      .select({
        model: schema.modelCalls.model,
        step: schema.modelCalls.step,
        costUsd: schema.modelCalls.costUsd,
        createdAt: schema.modelCalls.createdAt,
      })
      .from(schema.modelCalls)
      .orderBy(desc(schema.modelCalls.createdAt))
      .limit(2000),
    db()
      .select({
        id: schema.runEvents.id,
        type: schema.runEvents.type,
        createdAt: schema.runEvents.createdAt,
        runId: schema.runEvents.runId,
        projectId: schema.pipelineRuns.projectId,
        companyName: schema.projects.companyName,
        periodLabel: schema.projects.periodLabel,
      })
      .from(schema.runEvents)
      .innerJoin(schema.pipelineRuns, eq(schema.runEvents.runId, schema.pipelineRuns.id))
      .innerJoin(schema.projects, eq(schema.pipelineRuns.projectId, schema.projects.id))
      .orderBy(desc(schema.runEvents.id))
      .limit(40),
    db()
      .select({
        id: schema.approvals.id,
        action: schema.approvals.action,
        projectId: schema.approvals.projectId,
        note: schema.approvals.note,
        createdAt: schema.approvals.createdAt,
        companyName: schema.projects.companyName,
      })
      .from(schema.approvals)
      .leftJoin(schema.projects, eq(schema.approvals.projectId, schema.projects.id))
      .orderBy(desc(schema.approvals.createdAt))
      .limit(20),
  ]);

  const prototypeSpendUsd = versionRows.reduce((sum, v) => sum + microsToUsd(v.costUsdMicros), 0);
  const ledgerSpendUsd = ledgerRows.reduce((sum, r) => sum + parseCostUsd(r.costUsd), 0);
  const trackedSpendUsd = ledgerSpendUsd > 0 ? ledgerSpendUsd : prototypeSpendUsd;

  const byProject = new Map<
    string,
    {
      projectId: string;
      companyName: string;
      periodLabel: string | null;
      status: string;
      prototypeSpendUsd: number;
      versionCount: number;
      models: Set<string>;
    }
  >();
  for (const v of versionRows) {
    let row = byProject.get(v.projectId);
    if (!row) {
      row = {
        projectId: v.projectId,
        companyName: v.companyName,
        periodLabel: v.periodLabel,
        status: v.status,
        prototypeSpendUsd: 0,
        versionCount: 0,
        models: new Set(),
      };
      byProject.set(v.projectId, row);
    }
    row.prototypeSpendUsd += microsToUsd(v.costUsdMicros);
    row.versionCount += 1;
    if (v.model) row.models.add(v.model);
  }

  const costByProject = [...byProject.values()]
    .map((r) => ({
      projectId: r.projectId,
      companyName: r.companyName,
      periodLabel: r.periodLabel,
      status: r.status,
      prototypeSpendUsd: r.prototypeSpendUsd,
      versionCount: r.versionCount,
      models: [...r.models],
    }))
    .sort((a, b) => b.prototypeSpendUsd - a.prototypeSpendUsd)
    .slice(0, 12);

  const dayMap = new Map<string, { day: string; prototypeUsd: number; ledgerUsd: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = dayKey(d);
    dayMap.set(key, { day: key, prototypeUsd: 0, ledgerUsd: 0 });
  }
  for (const v of versionRows) {
    if (!v.createdAt || v.createdAt < since) continue;
    const key = dayKey(v.createdAt);
    const bucket = dayMap.get(key);
    if (bucket) bucket.prototypeUsd += microsToUsd(v.costUsdMicros);
  }
  for (const r of ledgerRows) {
    if (!r.createdAt || r.createdAt < since) continue;
    const key = dayKey(r.createdAt);
    const bucket = dayMap.get(key);
    if (bucket) bucket.ledgerUsd += parseCostUsd(r.costUsd);
  }

  const prototypeModelMap = new Map<string, { spendUsd: number; calls: number }>();
  for (const v of versionRows) {
    const model = v.model || "unknown";
    const cur = prototypeModelMap.get(model) ?? { spendUsd: 0, calls: 0 };
    cur.spendUsd += microsToUsd(v.costUsdMicros);
    cur.calls += 1;
    prototypeModelMap.set(model, cur);
  }
  const ledgerModelMap = new Map<string, { spendUsd: number; calls: number }>();
  for (const r of ledgerRows) {
    const model = r.model || "unknown";
    const cur = ledgerModelMap.get(model) ?? { spendUsd: 0, calls: 0 };
    cur.spendUsd += parseCostUsd(r.costUsd);
    cur.calls += 1;
    ledgerModelMap.set(model, cur);
  }

  const costByModel = [
    ...[...prototypeModelMap.entries()].map(([model, v]) => ({
      model,
      source: "prototype" as const,
      spendUsd: v.spendUsd,
      calls: v.calls,
    })),
    ...[...ledgerModelMap.entries()].map(([model, v]) => ({
      model,
      source: "ledger" as const,
      spendUsd: v.spendUsd,
      calls: v.calls,
    })),
  ].sort((a, b) => b.spendUsd - a.spendUsd);

  const durations = runRows
    .filter((r) => r.completedAt && r.createdAt)
    .map((r) => r.completedAt!.getTime() - r.createdAt.getTime())
    .filter((ms) => ms > 0 && ms < 7 * 24 * 60 * 60 * 1000);

  const runsSucceeded = runRows.filter((r) =>
    ["succeeded", "completed", "exported"].includes(r.status),
  ).length;
  // Count from full run table statuses among the recent sample + a dedicated query for accuracy
  const [runStatusAgg] = await db()
    .select({
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${schema.pipelineRuns.status} in ('succeeded','completed','exported'))::int`,
      failed: sql<number>`count(*) filter (where ${schema.pipelineRuns.status} in ('failed','error'))::int`,
      running: sql<number>`count(*) filter (where ${schema.pipelineRuns.status} in ('running','queued'))::int`,
    })
    .from(schema.pipelineRuns);

  // Prefer durations from completed runs (broader than the recent list).
  const completedForDuration = await db()
    .select({
      createdAt: schema.pipelineRuns.createdAt,
      completedAt: schema.pipelineRuns.completedAt,
    })
    .from(schema.pipelineRuns)
    .where(and(isNotNull(schema.pipelineRuns.completedAt), gte(schema.pipelineRuns.createdAt, since)))
    .limit(200);
  const durationMsList = completedForDuration
    .map((r) => (r.completedAt && r.createdAt ? r.completedAt.getTime() - r.createdAt.getTime() : 0))
    .filter((ms) => ms > 0 && ms < 7 * 24 * 60 * 60 * 1000);
  const durationSource = durationMsList.length > 0 ? durationMsList : durations;

  const overview: AdminOverview = {
    generatedAt: new Date().toISOString(),
    authNote:
      "Gated to authenticated operators (same allowlist as Projects). No separate admin role exists yet.",
    coverage: {
      prototypeSpendLabel: "Prototype versions (studio / refine / KPI when recorded)",
      ledgerSpendLabel: "Model ledger (DNA + KPI + studio + refine)",
      gaps: [
        "Historical DNA vision spend was not persisted — only new runs write detect_dna to the model ledger.",
        "Older prototype rows may be studio/refine only (KPI + DNA missing).",
        ledgerSpendUsd === 0
          ? "Model ledger is empty so far — tracked spend falls back to prototype version totals."
          : "When the ledger has rows, tracked spend prefers the ledger (fuller coverage for new runs).",
      ].filter(Boolean),
    },
    kpis: {
      projectCount: projectRows.length,
      runCount: runStatusAgg?.total ?? runRows.length,
      runsSucceeded: runStatusAgg?.succeeded ?? runsSucceeded,
      runsFailed: runStatusAgg?.failed ?? 0,
      runsRunning: runStatusAgg?.running ?? 0,
      exportCount: exportRows.length,
      trackedSpendUsd,
      prototypeSpendUsd,
      ledgerSpendUsd,
      avgRunDurationMs:
        durationSource.length > 0
          ? durationSource.reduce((a, b) => a + b, 0) / durationSource.length
          : null,
      medianRunDurationMs: median(durationSource),
    },
    projectsByStatus: statusRows
      .map((r) => ({ status: r.status, count: Number(r.count) }))
      .sort((a, b) => b.count - a.count),
    costByProject,
    costByDay: [...dayMap.values()],
    costByModel,
    recentRuns: runRows.map((r) => ({
      runId: r.id,
      projectId: r.projectId,
      companyName: r.companyName,
      periodLabel: r.periodLabel,
      status: r.status,
      currentStep: r.currentStep,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      durationMs:
        r.completedAt && r.createdAt ? r.completedAt.getTime() - r.createdAt.getTime() : null,
    })),
    activity: eventRows.map((e) => ({
      id: Number(e.id),
      type: e.type,
      createdAt: e.createdAt.toISOString(),
      runId: e.runId,
      projectId: e.projectId,
      companyName: e.companyName,
      periodLabel: e.periodLabel,
    })),
    approvals: approvalRows.map((a) => ({
      id: a.id,
      action: a.action,
      projectId: a.projectId,
      companyName: a.companyName ?? "Unknown project",
      createdAt: a.createdAt.toISOString(),
      note: a.note,
    })),
  };

  return overview;
}

