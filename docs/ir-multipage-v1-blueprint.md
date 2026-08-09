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
| **IR theme preset** | Chrome/layout personality (`theme_id`: `classic` \| `editorial` \| `statutory`) via `data-theme` on `<html>` — **not** a separate codebase |
| **CSS fallbacks** | Neutral IR slate (`IR_NEUTRAL_FALLBACKS` in `@rs/render`) when a role is missing — **never** DRDGOLD `#FCAF17` / `#0F3B2E` |

### IR theme presets (shared engine)

One extraction → DocModel → SitePlan → composers pipeline. Themes only change composition and chrome CSS; **numbers stay verbatim from extraction** (Gate A/B unchanged).

| `theme_id` | Personality | Typical use |
|---|---|---|
| **`classic`** (default) | Dark masthead, statement-forward KPI stage in hero | Mining / industrial / traditional interim |
| **`editorial`** | Lighter nav/hero, commentary-first CTA, KPIs in body, airier cards | Retail / consumer / prose-led packs with a letter |
| **`statutory`** | Light hub chrome; Directors / Auditor first-class CTAs | Letter-less AFS (Spar, MTN-style) |

Operator picks at **DNA approve** or **site review** (console). Soft auto-suggest (e.g. retail/AFS → editorial, mining interim → classic) with override. Persist: `DesignDNA.theme_id` via `PUT /api/projects/:id/theme` (optional rebuild). Future: `minimal`, `bold`.

Brand DNA colors + Brand kit logo still apply on top of the preset.

### Before site draft / publish

1. Approve **issuer-specific** Design DNA (not another company's palette).
2. Choose **IR theme** (Classic or Editorial) — or accept the suggestion.
3. Upload Brand kit logo (SVG preferred) when the issuer is not the DRDGOLD reference.
4. Publish checklist item **`brand_differentiated`**: accent from DNA + logo; blocks sign-off when Brand kit is empty **and** DNA looks unset/generic for non-DRDGOLD issuers.

## Reference project

- **DRD Gold 1** — `444cd443-97cc-4b9c-b0f6-eef4f65c2f98`  
  Marked in `apps/portal/lib/reference-projects.ts`. Its DNA + Brand kit resolve to gold/olive; other projects must not clone that look via render defaults.

## How new PDFs differ

1. Probe + vision measure *that* PDF → Design DNA roles.
2. Token block emits those hexes; chrome/statement CSS use `var(--dna-*)`.
3. `theme_id` selects classic vs editorial chrome (`data-theme` + composer layout).
4. Brand kit logo/hero are project-scoped.
5. Missing DNA → neutral slate chrome, plus checklist warnings — not silent DRDGOLD styling.

---

## Multi-issuer study (2026-08-09)

Production evidence from three live uploads. Canvas: `world-class-ir-converter.canvas.tsx` (Cursor canvases).

| Issuer | Project ID | PDF | Doc shape | Prod site pages | Theme | Capture verdict |
|---|---|---|---|---|---|---|
| **DRDGOLD** | `444cd443-97cc-4b9c-b0f6-eef4f65c2f98` | 10 pp | Interim unaudited | **10** (draft v43) | `classic` | **Ready** — letter, ops, dividend, statements, notes; reliability pass |
| **SPAR** | `7947eb5f-d836-43b4-8779-8bfdcf164471` | 80 pp | AFS dual-entity | **15** (draft v32) | `statutory` | **Ready** — directors + auditor + policies + note groups; Gate A/B pass |
| **MTN** | `8ed9620c-804d-4370-882d-8df8c1243f0c` | 148 pp | AFS Group/Company split | **21** (draft v9) | `statutory` | **Ready** — Group+Company books + note groups; Gate A/B + reliability pass |

Prefer MTN `8ed9620c…` over older `f3cc2ac8…` (24 pp truncated stub; legal name resolved as “Group financial statements”; corporate reliability fail).

### What each PDF contains (summary)

- **DRDGOLD** — Condensed HY1: cover highlights, CEO shareholder letter, ops (Ergo/FWGR), cash dividend, four condensed consolidated statements, short notes, administration. Client SVG logo + hero in Brand kit.
- **SPAR** — Full audited AFS: approval/secretary/auditor (KAMs), directors’ report, audit committee, GROUP+COMPANY primary statements, accounting policies, large notes set. No shareholder letter. Dual-entity column bands render on statement pages.
- **MTN** — Large Group AFS: statutory reports, directors’ report (incl. litigation), auditor’s report, Group statements, Company statements, accounting framework / material policies, massive notes index. Brand yellow/black; no commissioned hero on latest draft.

### Failure modes observed

| Mode | Where | Implication |
|---|---|---|
| Blank commentary | MTN | Composer still waits for shareholder letter; AFS narrative is directors’ report |
| Fixed ~10-page IA | MTN prod | AFS sections extracted but site stays interim shell |
| Notes megapage | Spar + MTN | Split needs numbered note titles; MTN mostly “Notes … (continued)” |
| Auditor page absent | Spar prod | In PDF + local mapper; not on production draft |
| Bright-brand contrast | MTN `#FFCB04` | Accent OK; masthead/shading must not stay raw yellow |
| Legal-name / TOC garbage | MTN 24 pp stub | Cover title from TOC band — reject incomplete uploads |
| Thin AFS narrative | Spar commentary | Teaser + link only; operators still open the PDF for story |
| Entity model mismatch | Spar vs MTN | Spar = side-by-side GROUP\|COMPANY; MTN = separate Group vs Company books |

### Architecture north star

1. **Doc-shape classifier** → `interim_short` | `afs_dual_entity` | `afs_group_company_split` (drive SitePlan, not a fixed template).
2. **Never-drop capture** → legal name/period, KPIs, letter **or** directors’ report, dividend, auditor (+ KAMs), policies/framework, primary statements per entity book, every note table, admin, PDF+XLSX.
3. **Commentary rule** → if no letter, compose from directors’ report / statutory hub — **never** the empty placeholder on AFS.
4. **Brand stack** → DNA roles + Brand kit (SVG/hero) + `theme_id` + bright-brand contrast remap (`brand-contrast.ts`) before publish.
5. **Templates** → `classic` (interim/industrial), `editorial` (retail/prose), plus a **statutory hub** layout for letter-less AFS; dual-entity skin ≠ Group/Company split books.
6. **Complete-IR gates** → shape-complete checklist on top of Gate A/B + corporate reliability (narrative non-empty, auditor/policies when present, notes UX, entity coverage, brand AA, legal name).

### Recommended next build phases

| Week | Ship | Proof on issuers |
|---|---|---|
| **1** | Deploy adaptive sitemap + AFS commentary fallback; rebuild MTN/Spar | MTN: directors/auditor pages; no blank commentary |
| **2** | Note numbering from notes index; policies lexicon (`ACCOUNTING FRAMEWORK`); Group/Company IA branch | Spar notes paginated; MTN policies + Company statements reachable |
| **3** | Enforce bright-brand contrast in publish gate; statutory-hub theme suggest for letter-less AFS | MTN yellow AA; Spar hub feels intentional |
| **4** | Complete-IR checklist + operator SLA (rebuild ≤2 clicks; ≤15 min polish after extract) | All three export-ready without PDF babysitting |

Local mapper work already expands Spar/MTN SitePlans beyond production drafts — **deploy + rebuild** is the immediate unlock before deeper note/Company-book work.

### Phase status (2026-08-09)

| Phase | Status | Notes |
|---|---|---|
| **1** Adaptive sitemap + commentary never-drop | **Done** — Spar v30 / MTN v7 verified post-deploy | `classifyDocShape`, directors/auditor/policies pages, directors→commentary fallback, ACCOUNTING FRAMEWORK lexicon (`1 ACCOUNTING…`), bright-brand tokens via `buildIrTokenBlock` |
| **2** Note numbering + Group/Company IA + brand contrast gate | **Done** — MTN v8 / Spar v31 | Continued-stub note inheritance; separate entity books; letter-less AFS theme suggest → editorial (later `statutory`) |
| **3** Dedicated statutory-hub theme_id | **Done** — Spar v32 / MTN v9 on `statutory` | Contracts + CSS + composers + console picker; suggest for letter-less AFS |
| **4** Complete-IR checklist + operator SLA + DRD reliability | **Done** — DRD v43 classic | Shape checklist on publish readiness; ≤2-click / ≤15 min SLA copy; DRD statement-title binding fix (ops marker no longer steals IS/BS/CF/equity) |

### Phase 2 verification matrix (2026-08-09)

| Check | Spar `7947eb5f…` | MTN `8ed9620c…` (local map) |
|---|---|---|
| Note groups / index | yes (pre-existing) | yes — Group notes 1–10 / 11; Company notes 2–14 |
| Group statement book | dual-column (unchanged) | `financials/group/*` |
| Company statement book | dual-column (unchanged) | `financials/company/*` |
| Bright-brand publish gate | n/a (editorial green) | pass when chrome remapped |
| Commentary blank placeholder | no | no |
