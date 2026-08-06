import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { env } from "./lib/env";

/**
 * Operator auth: magic-link only, gated by an OPERATOR_EMAILS allowlist.
 * v1 has one account holder; client review is deliberately account-less
 * (hashed review tokens, added in v1.5). No passwords anywhere.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
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
