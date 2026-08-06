import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { env } from "../env";
import * as schema from "./schema";

/**
 * Workflow-safe DB accessor. Same connection as ../db, but the `postgres`
 * driver (which pulls in Node built-ins) is imported DYNAMICALLY so this
 * module carries no top-level node-dependent import. That matters because it
 * is reachable from the Workflow build graph, whose analyzer rejects static
 * node-module imports in reachable modules (see ../blob.ts for the same
 * pattern). These bodies only ever run inside step executions, where Node is
 * fully available. App routes keep using ../db (synchronous) instead.
 */
let _db: PostgresJsDatabase<typeof schema> | null = null;

export async function getDb(): Promise<PostgresJsDatabase<typeof schema>> {
  if (!_db) {
    const postgres = (await import("postgres")).default;
    const client = postgres(env.DATABASE_URL, {
      ssl: "require",
      max: 5,
      idle_timeout: 20,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export { schema };
