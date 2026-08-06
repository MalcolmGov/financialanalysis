import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db, schema } from "./lib/db";
import { env } from "./lib/env";
import { DUMMY_HASH, verifyPassword } from "./lib/password";
import { clearAttempts, isLockedOut, recordFailedAttempt } from "./lib/rate-limit";

/**
 * Operator auth: email + password, gated by an OPERATOR_EMAILS allowlist.
 * Credentials + JWT sessions need no Adapter (that was only required for the
 * old magic-link flow's verification-token persistence). Accounts are
 * provisioned out of band via scripts/set-operator-password.ts — there is no
 * public self-serve signup, matching the operator-only access model.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required behind Railway / reverse proxies so Auth.js trusts the public host.
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.toLowerCase().trim() : null;
        const password = typeof credentials?.password === "string" ? credentials.password : null;
        if (!email || !password) return null;
        if (isLockedOut(email)) return null;
        const [row] = await db().select().from(schema.users).where(eq(schema.users.email, email));
        if (!row?.passwordHash) {
          // Burn the same cost a real wrong-password check would, so this
          // path isn't distinguishable by timing from "account exists,
          // wrong password" — the result is intentionally never used.
          verifyPassword(password, DUMMY_HASH);
          recordFailedAttempt(email);
          return null;
        }
        if (!verifyPassword(password, row.passwordHash)) {
          recordFailedAttempt(email);
          return null;
        }
        clearAttempts(email);
        return { id: row.id, email: row.email };
      },
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
