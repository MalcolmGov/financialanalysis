import { resolve } from "node:path";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // App lives at apps/portal; point tracing at the monorepo root so the
  // @rs/contracts workspace import resolves for workflow discovery.
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
};

export default withWorkflow(nextConfig);
