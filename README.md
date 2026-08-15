# Results Studio

Converts a company's published financial-results PDF into a verified, brand-faithful, interactive HTML microsite through a nine-step pipeline with human gates. **No generic templates** — every visual decision derives from the source PDF's measured design DNA. **The AI never touches a number** — numeric content flows through references only, verified by blocking gates before export.

Architecture: `~/Documents/results-studio-architecture/` (canonical: `00-consolidated-architecture.html`).
IR multipage v1 engine blueprint: [`docs/ir-multipage-v1-blueprint.md`](docs/ir-multipage-v1-blueprint.md) — shared IA/composers/gates; brand per issuer via Design DNA + Brand kit.
Reference/golden project: DRDGOLD HY1 FY2026 (`444cd443-97cc-4b9c-b0f6-eef4f65c2f98`, “DRD Gold 1”) — reference marker only, not the global theme.

## Layout

| Path | What | Runs on |
|---|---|---|
| `packages/contracts` | **Source of truth** for every cross-boundary artifact shape (zod, authoritative) + emitted JSON Schemas. Built first; portal and worker consume it. | — |
| `apps/portal` | Next.js App Router portal: auth, upload lane, review workspace, run timeline, Workflow DevKit pipeline. | Railway (daily extract/rebuild). Vercel clone is UI-only. |
| `services/worker` | Python FastAPI: Docling extraction, design-DNA probe, asset extraction, Playwright render/QA. One container. | Railway (EU) |

## Non-negotiable invariants (from the adversarial review)

1. Contracts change only in `packages/contracts`; consumers never fork shapes. TS zod is authoritative; JSON Schemas are emitted; Python models are generated.
2. Extraction values are **verbatim strings** end-to-end. Nothing downstream parses-and-reformats a number for display.
3. AI composition (SitePlan) uses **references only** for numerics — slots are regex-typed `^(ext:|doc:)`. Free-text slots may contain no numerals.
4. Workflow steps exchange small `ArtifactRef`s, never bodies. Postgres is the system of record; WDK is the engine.
5. All Blob storage is **private**; browsers reach artifacts only through the authz proxy route. MNPI is the design center.
6. Prototypes exist in two stored forms: placeholder (≤250 KB, the refinement/LLM form) and assembled (data-URI assets, the preview form). Refinement always patches the placeholder form.
7. QA rejection unlocks the blueprint and returns to review — it never kills the run.

## Environments

Copy `.env.example` → `apps/portal/.env.local` and `services/worker/.env`. Pending provisioning decisions (EU region recommended, fixed at store creation): Neon Postgres (Frankfurt), Vercel Blob private store (EU), Resend domain, Anthropic API key.

**Hosts**

| Host | URL | Use for |
|---|---|---|
| Railway portal + worker | https://portal-production-518a.up.railway.app | Daily production: extract, rebuild, Studio Chat, sign-off, export |
| Vercel UI | https://portal-alpha-drab.vercel.app | Sign-in / console chrome only. Worker is Railway-internal, so pipeline from this host will fail. |

**Node:** pin to 22 LTS (`.nvmrc`, `engines`: `>=20 <26`). Railway's portal image is `node:22-bookworm-slim`. Node 26 breaks local `tsx` rebuilds (`util.deepClone` missing). Prefer console **Rebuild** over local scripts.

**Deploy:** pushing `main` runs `.github/workflows/deploy-portal.yml`. Set repo secret `RAILWAY_TOKEN` (Railway project token for `e0fa0025-0d95-4203-bc88-be2fa705de06`) to auto-deploy; without it the workflow skips. Until then: `railway up --service portal --ci` from the repo root. Railway vs Vercel stay dual-host — pipeline work is Railway-only.

## Dev

```bash
pnpm install
pnpm contracts:build && pnpm contracts:schemas && pnpm contracts:test
pnpm portal:dev
# worker: cd services/worker && uv sync && uv run uvicorn app.main:app --reload
```
