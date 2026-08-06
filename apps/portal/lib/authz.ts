import { headers } from "next/headers";
import { auth } from "../auth";
import { db, schema } from "./db";
import { env } from "./env";

export type Operator = { id: string; email: string };

/** Require an authenticated operator. Throws a Response on failure (routes catch). */
export async function requireOperator(): Promise<Operator> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw unauthorized();
  const allow = env.OPERATOR_EMAILS;
  if (allow.length > 0 && !allow.includes(email.toLowerCase())) throw forbidden();
  return { id: session!.user!.id ?? email, email };
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
export function forbidden() {
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

/** Append-only access log — the MNPI "who saw what, when" trail. */
export async function logAccess(
  actorType: "operator" | "review_token" | "system",
  actorId: string | null,
  action: string,
  resource: string,
) {
  if (env.MOCK_BLOB) return;
  const h = await headers();
  await db()
    .insert(schema.accessLog)
    .values({
      actorType,
      actorId,
      action,
      resource,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0] || null,
      userAgent: h.get("user-agent") ?? null,
    });
}
