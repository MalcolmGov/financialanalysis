import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import Resend from "next-auth/providers/resend";
import { db, schema } from "./lib/db";
import { env } from "./lib/env";

/**
 * The Email provider requires an adapter (it persists a verification token
 * and looks up/creates the signed-in user) even though sessions are JWT, not
 * database-backed — omitting one throws "MissingAdapter" the moment a magic
 * link is requested. Implemented directly against the existing users/
 * verification_tokens tables rather than pulling in @auth/drizzle-adapter,
 * which expects its own column shapes (this app's users table is org-scoped
 * with a role, not Auth.js's canonical User model). Only the methods the
 * Email provider + JWT sessions actually call are implemented — session
 * methods (createSession/getSessionAndUser/...) are intentionally omitted,
 * every Adapter method is optional, and they're never invoked under
 * `session: { strategy: "jwt" }`.
 */
function toAdapterUser(row: { id: string; email: string }): AdapterUser {
  return { id: row.id, email: row.email, emailVerified: null };
}

const adapter: Adapter = {
  async createVerificationToken(token) {
    await db().insert(schema.verificationTokens).values(token);
    return token;
  },
  async useVerificationToken({ identifier, token }) {
    const [row] = await db()
      .select()
      .from(schema.verificationTokens)
      .where(eq(schema.verificationTokens.identifier, identifier));
    if (!row || row.token !== token) return null;
    await db().delete(schema.verificationTokens).where(eq(schema.verificationTokens.identifier, identifier));
    return row;
  },
  async getUser(id) {
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, id));
    return row ? toAdapterUser(row) : null;
  },
  async getUserByEmail(email) {
    const [row] = await db().select().from(schema.users).where(eq(schema.users.email, email));
    return row ? toAdapterUser(row) : null;
  },
  async createUser(user) {
    const [row] = await db()
      .insert(schema.users)
      .values({ email: user.email })
      .returning();
    return toAdapterUser(row);
  },
};

/**
 * Operator auth: magic-link only, gated by an OPERATOR_EMAILS allowlist.
 * v1 has one account holder; client review is deliberately account-less
 * (hashed review tokens, added in v1.5). No passwords anywhere.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "jwt" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM ?? "studio@example.com",
    }),
  ],
  callbacks: {
    signIn({ user }) {
      const allow = env.OPERATOR_EMAILS;
      // Empty allowlist in dev => permit, so local sign-in works pre-config.
      if (allow.length === 0) return true;
      return !!user.email && allow.includes(user.email.toLowerCase());
    },
  },
  pages: { signIn: "/signin" },
});
