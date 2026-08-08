# IR multipage v1 — reusable engine blueprint

**Shared engine, brand/content per project.** DRDGOLD HY1 FY2026 is a *reference project*, not the global theme.

## Engine (reusable)

| Layer | Responsibility |
|---|---|
| **IA / SitePlan** | Deterministic page tree from extraction + DNA (`@rs/mapper` → `buildSitePlan`) |
| **Composers** | Home KPIs, commentary, downloads, nav chrome (`@rs/render` composers) |
| **Statement skin** | Table IR CSS driven by `--dna-*` tokens |
| **Delivery pack** | Multipage HTML + Excel + source PDF + README + `_meta/export.json` |
| **Gates** | Gate A (provenance), Gate B (fidelity), corporate reliability, publish sign-off |

Pipeline entry: `buildMultipageExport` → persist `runs/{runId}/site-draft/vN/`.

## Per-issuer DNA (differentiation)

| Source | What it controls |
|---|---|
| **Design DNA** | Palette roles (`brand`, `masthead-bg`, table headers, fonts) → `:root` token block |
| **Brand kit** | Official logo + hero photo (assets only; overrides extraction) |
| **CSS fallbacks** | Neutral IR slate (`IR_NEUTRAL_FALLBACKS` in `@rs/render`) when a role is missing — **never** DRDGOLD `#FCAF17` / `#0F3B2E` |

### Before site draft / publish

1. Approve **issuer-specific** Design DNA (not another company's palette).
2. Upload Brand kit logo (SVG preferred) when the issuer is not the DRDGOLD reference.
3. Publish checklist item **`brand_differentiated`**: accent from DNA + logo; blocks sign-off when Brand kit is empty **and** DNA looks unset/generic for non-DRDGOLD issuers.

## Reference project

- **DRD Gold 1** — `444cd443-97cc-4b9c-b0f6-eef4f65c2f98`  
  Marked in `apps/portal/lib/reference-projects.ts`. Its DNA + Brand kit resolve to gold/olive; other projects must not clone that look via render defaults.

## How new PDFs differ

1. Probe + vision measure *that* PDF → Design DNA roles.
2. Token block emits those hexes; chrome/statement CSS use `var(--dna-*)`.
3. Brand kit logo/hero are project-scoped.
4. Missing DNA → neutral slate chrome, plus checklist warnings — not silent DRDGOLD styling.
