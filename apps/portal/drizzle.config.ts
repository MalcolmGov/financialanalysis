import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/placeholder",
  },
  // Emit the immutability trigger + partial unique index as a companion
  // migration; see drizzle/0001_blueprint_immutability.sql.
} satisfies Config;
