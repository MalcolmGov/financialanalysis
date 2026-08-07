/**
 * Starts the Workflow DevKit world on server boot. Required for the Postgres
 * world (@workflow/world-postgres): it polls graphile-worker for queued
 * step/workflow invocations, so nothing durable runs without this.
 * No-op under the Local World (dev) — start() is only defined by worlds that
 * need a background poller.
 * https://useworkflow.dev/docs/deploying/world/postgres-world
 *
 * Timeout note (studio / long steps): @workflow/world-postgres 4.3.x exposes
 * connectionString, queueConcurrency, maxPoolSize, streamFlushIntervalMs — not
 * a configurable per-step HTTP timeout. Graphile jobs stay leased until the
 * in-process fetch to `/.well-known/workflow/v1/step` completes (or returns
 * `{ timeoutSeconds }` to reschedule). Platform proxies (e.g. Railway ~300s
 * request limits) can still cut a single step; raising that requires platform
 * config or a package change — not an env var in this world version. Shell-gen
 * (lower maxTokens + slim brief) is the app-side mitigation.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { getWorld } = await import("workflow/runtime");
    await getWorld().start?.();
  }
}
