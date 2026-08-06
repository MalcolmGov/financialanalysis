import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "../env";
import * as schema from "./schema";

/** Lazy singleton — no connection is opened at module load / build time. */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!_db) {
    const client = neon(env.DATABASE_URL);
    _db = drizzle(client, { schema });
  }
  return _db;
}

export { schema };
