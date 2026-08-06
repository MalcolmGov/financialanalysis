import { NextResponse } from "next/server";
import { auth } from "./auth";

/**
 * Next.js 16 proxy (formerly middleware; defaults to the Node.js runtime as
 * of v16, so this can safely import ./auth's full config). Two jobs:
 *
 * 1. Ensure Workflow's internal /.well-known/workflow/ paths are never
 *    intercepted (see the WDK Next.js guide — missing this exclusion breaks
 *    workflow resumption).
 * 2. Defense-in-depth: redirect an unauthenticated visitor away from the
 *    pages that render real project data (home, project console) before
 *    they even render. This is a SECOND layer, not the authoritative one —
 *    Next.js's own proxy docs warn that matcher coverage can silently break
 *    on a route refactor, so each page also calls
 *    lib/authz.ts's requireOperatorOrRedirect() itself. (That page-level gap
 *    is exactly what shipped without it: the home and project-detail pages
 *    rendered real data to anyone before this fix.)
 *
 * API routes are NOT re-gated here — they already call requireOperator()
 * individually and are proven working; broadening this matcher to /api/*
 * risks breaking the HMAC-verified worker webhook and the NextAuth routes
 * themselves, which must stay reachable without a session.
 */
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isProtectedPage = pathname === "/" || pathname.startsWith("/projects/");
  if (isProtectedPage && !req.auth) {
    return NextResponse.redirect(new URL("/signin", req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
    },
  ],
};
