/**
 * Starts the Workflow DevKit world on server boot. Required for the Postgres
 * world (@workflow/world-postgres): it polls graphile-worker for queued
 * step/workflow invocations, so nothing durable runs without this.
 * No-op under the Local World (dev) — start() is only defined by worlds that
 * need a background poller.
 * https://useworkflow.dev/docs/deploying/world/postgres-world
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { getWorld } = await import("workflow/runtime");
    await getWorld().start?.();
  }
}
