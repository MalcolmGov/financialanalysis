/**
 * In-memory per-email lockout for the credentials sign-in endpoint. The old
 * magic-link flow had no durable secret to brute-force; passwords do, and
 * nothing else in this app throttles login attempts. This is a single-process
 * heuristic (Railway runs the portal as one long-lived Node process, not
 * per-request serverless, so a module-level Map persists across requests) —
 * it resets on redeploy/restart and won't share state across replicas if the
 * service is ever scaled horizontally. A durable (Postgres- or Redis-backed)
 * limiter would be needed at that point; fine for the current single-replica
 * deployment.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const failedAttempts = new Map<string, number[]>();

function recentAttempts(key: string): number[] {
  const now = Date.now();
  const list = (failedAttempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failedAttempts.set(key, list);
  return list;
}

export function isLockedOut(key: string): boolean {
  return recentAttempts(key).length >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string): void {
  const list = recentAttempts(key);
  list.push(Date.now());
  failedAttempts.set(key, list);
}

export function clearAttempts(key: string): void {
  failedAttempts.delete(key);
}
