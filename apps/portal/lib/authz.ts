import { redirect } from "next/navigation";
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

/**
 * Same check as requireOperator(), for Server Component PAGES rather than
 * route handlers — a page render can't "return a Response", so this calls
 * next/navigation's redirect() to /signin instead of throwing one. Every page
 * that renders real project data must call this itself; proxy.ts also gates
 * these routes, but Next.js's own docs warn that proxy matcher coverage can
 * silently break on a refactor, so the authoritative check has to live here,
 * not only at the proxy layer (this is exactly the gap that shipped without
 * it — home page and project detail page rendered real data to anyone).
 */
export async function requireOperatorOrRedirect(): Promise<Operator> {
  const session = await auth();
  const email = session?.user?.email;
  const allow = env.OPERATOR_EMAILS;
  if (!email || (allow.length > 0 && !allow.includes(email.toLowerCase()))) {
    redirect("/signin");
  }
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
