# Results Studio — Extraction Worker

FastAPI + Docling service (Railway-bound). Owns pipeline steps 2–3: PDF
extraction now, design-DNA probe + render/QA later (routes stubbed at 501).

## The integrity contract

`app/postprocess.py` is the heart. It assembles `ExtractionResult v1` and holds
the invariants under test in `tests/test_postprocess.py`:

- **Verbatim strings** — cell/text values copied byte-for-byte; no numeric
  parsing, no whitespace collapse. `"2 712.8"`, `"(23.9)"`, `"R million"` survive.
- **Bbox origin flip once** — Docling bottom-left → top-left PDF points, with
  `px_per_pt` on each page image so consumers map bbox → pixel with no further math.
- **Furniture separated** — page headers/footers never become body copy.
- **Numeric annotations advisory** — parsed candidates never replace strings.

## Dev (credential-free)

```bash
uv venv --python 3.12
uv pip install fastapi "uvicorn[standard]" pydantic httpx pytest pypdfium2 pillow
QUEUE_BACKEND=memory BLOB_BACKEND=fs .venv/bin/python -m pytest -q
QUEUE_BACKEND=memory BLOB_BACKEND=fs .venv/bin/uvicorn app.main:app --reload
```

Docling/torch (~2 GB) are declared in `pyproject.toml` but imported lazily —
install the full stack (`uv sync`) only to run real extractions or the golden run.

## Generated models

`scripts/gen_models.sh` regenerates pydantic models from
`packages/contracts/jsonschema/*.json`. Generated models are the only shapes the
API speaks — never hand-edit `app/contracts_gen/`.

## Golden run (pending full stack)

With Docling installed, extract the DRDGOLD reference PDF and diff future runs
against `tests/fixtures/` to catch Docling version drift.
