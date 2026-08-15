# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# results-studio portal (apps/portal) — Next.js 16 App Router + Workflow DevKit.
# Monorepo: pnpm@10.33 workspace (apps/*, packages/*). Deployed as a single,
# long-running Railway service via `next start` (NOT serverless, NOT standalone).
#
# Build context MUST be the repo root (the Dockerfile copies pnpm-lock.yaml,
# packages/* and apps/portal relative to it).
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
# Debian/glibc base: matches the glibc `sharp` binaries in pnpm-lock.yaml and
# avoids musl edge cases. Node 22 LTS matches `.nvmrc` / engines (">=20 <26").
# Node 26 breaks local `tsx` rebuilds (`util.deepClone` missing on undici).
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm pinned to the repo's "packageManager" field.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — populate the pnpm store from the lockfile, then link the WHOLE
# workspace offline. Dev deps are included on purpose: the build needs
# typescript (tsc for @rs/*) and tailwind/postcss.
# ---------------------------------------------------------------------------
FROM base AS deps
# Lockfile-only fetch: this layer is cached until pnpm-lock.yaml changes.
# (No BuildKit cache mounts — Railway's builder rejects unprefixed cache ids;
# the fetched store persists within this stage's layers anyway.)
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
# Copy every manifest (paths preserved) so the workspace resolves, then link.
COPY package.json ./
COPY apps/portal/package.json ./apps/portal/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/mapper/package.json ./packages/mapper/
COPY packages/render/package.json ./packages/render/
RUN pnpm install --frozen-lockfile --offline

# ---------------------------------------------------------------------------
# build — compile the @rs/* workspace packages (tsc -> dist) in dependency
# order (contracts -> render -> mapper), THEN `next build` the portal. The
# portal imports @rs/* via their "main": "./dist/index.js", so dist must exist
# before next build. withWorkflow() also runs workflow discovery/codegen here.
# ---------------------------------------------------------------------------
FROM base AS build
# Bring the linked workspace (root + per-package node_modules, with pnpm
# symlinks intact) from deps, then overlay the source tree. node_modules is
# excluded by .dockerignore, so `COPY . .` never clobbers the installed deps.
COPY --from=deps /app ./
COPY . .
# next-auth v5 initialises its config while Next collects routes during the
# build. A throwaway, NON-secret value keeps `next build` deterministic without
# real credentials. This ENV exists ONLY in the build stage and never reaches
# the runtime image (the runner stage does not inherit it).
ENV AUTH_SECRET="build-time-placeholder-not-a-real-secret"
RUN pnpm --filter @rs/contracts build \
 && pnpm --filter @rs/render build \
 && pnpm --filter @rs/mapper build
RUN pnpm --filter portal build

# ---------------------------------------------------------------------------
# runner — carry the built app + the full workspace node_modules and run
# `next start`. Copying the entire /app tree preserves pnpm's relative
# symlinks (apps/portal/node_modules/@rs/* -> ../../packages/*, and the
# node_modules/.pnpm store), which is exactly what makes plain `next start`
# work without standalone file-tracing.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
WORKDIR /app/apps/portal
# Railway injects $PORT and expects the app to listen on it, on all interfaces.
EXPOSE 3000
CMD ["sh", "-c", "exec pnpm exec next start -H 0.0.0.0 -p ${PORT:-3000}"]

