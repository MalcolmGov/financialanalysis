"""Full worker-side run on a real PDF: REAL Docling extraction (the extract.py
driver, exercised against Docling for the first time) + deterministic probe +
page renders. Writes extraction.json, probe-dna.json and pages/*.png to <out>,
so the portal's DNA/studio/gate chain can run against genuine extracted output.

    PYTHONPATH=. .venv/bin/python scripts/extract_and_probe.py <pdf> <out>
"""
import hashlib
import json
import sys
from pathlib import Path

from app.extract import extract_document
from app.probe import probe_design_dna
from app.render_pages import render_page_pngs


def main() -> None:
    pdf_path = Path(sys.argv[1])
    out = Path(sys.argv[2])
    (out / "pages").mkdir(parents=True, exist_ok=True)

    pdf_bytes = pdf_path.read_bytes()
    sha = hashlib.sha256(pdf_bytes).hexdigest()

    def put_asset(blob_path: str, body: bytes, content_type: str) -> None:
        dest = out / blob_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)

    source_meta = {
        "blob_path": "source/original.pdf",
        "sha256": sha,
        "size_bytes": len(pdf_bytes),
        "page_count": 0,
        "pdf_meta": {"title": "", "producer": "", "created": "", "modified": ""},
    }

    print("Running REAL Docling extraction (TableFormer ACCURATE)…", flush=True)
    result = extract_document(
        pdf_bytes=pdf_bytes,
        extraction_id="drd",
        org_id="demo",
        project_id="drd",
        output_prefix="",  # write assets directly under <out>
        source_meta=source_meta,
        put_asset=put_asset,
        on_progress=lambda done, total: print(f"  page {done}/{total}", flush=True),
    )
    result["source"]["page_count"] = len(result["pages"])
    (out / "extraction.json").write_text(json.dumps(result))

    dna = probe_design_dna(pdf_bytes, project_id="drd", sha256=sha, pages=len(result["pages"]))
    (out / "probe-dna.json").write_text(json.dumps(dna, indent=2))

    for i, b in enumerate(render_page_pngs(pdf_bytes, scale=2.0, max_pages=10), 1):
        (out / "pages" / f"p{i:03d}.png").write_bytes(b)

    n_tables = len(result["tables"])
    n_blocks = len(result["body"])
    n_fig = len(result["figures"])
    print(f"\nExtraction: {len(result['pages'])} pages, {n_tables} tables, {n_fig} figures, {n_blocks} body blocks")
    # Show one statement-ish table's first data cells (verbatim check).
    for tid, t in list(result["tables"].items())[:6]:
        vals = [c["text"] for c in t["cells"] if not c["is_col_header"]][:6]
        print(f"  {tid}: {t['num_rows']}x{t['num_cols']} | sample cells: {vals}")
    print(f"Probe: {len(dna['palette']['measured'])} colors, fonts -> "
          f"{', '.join(sorted({f['mapping']['web_family'] for f in dna['type']['faces']}))}")


if __name__ == "__main__":
    main()
