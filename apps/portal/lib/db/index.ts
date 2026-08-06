import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

/**
 * Lazy singleton over a standard TCP Postgres connection (Railway Postgres).
 * No socket is opened at module load / build time. The portal always reaches
 * the database over its public TCP proxy (Vercel + local), so TLS is required;
 * `ssl: "require"` encrypts without verifying Railway's self-signed cert.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function db() {
  if (!_db) {
    _client = postgres(env.DATABASE_URL, {
      ssl: "require",
      max: 5,
      idle_timeout: 20,
    });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export { schema };
