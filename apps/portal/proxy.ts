import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware). Auth gating lives in route handlers /
 * server components via requireOperator(); this proxy only ensures Workflow's
 * internal /.well-known/workflow/ paths are never intercepted (see the WDK
 * Next.js guide — missing this exclusion breaks workflow resumption).
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
    },
  ],
};
