"""Produce the real probe-half DesignDNA + page PNGs from a PDF, so the portal's
vision pass + reconciler can run against genuine inputs. Not part of the served
API — a bridge for the light-stack (no-Docling) design-DNA demo.

    .venv/bin/python scripts/probe_and_render.py <pdf> <out_dir>
"""
import hashlib
import json
import sys
from pathlib import Path

from app.probe import probe_design_dna
from app.render_pages import render_page_pngs


def main() -> None:
    pdf_path = Path(sys.argv[1])
    out = Path(sys.argv[2])
    (out / "pages").mkdir(parents=True, exist_ok=True)

    pdf_bytes = pdf_path.read_bytes()
    sha = hashlib.sha256(pdf_bytes).hexdigest()

    dna = probe_design_dna(pdf_bytes, project_id="drd", sha256=sha, pages=0)
    (out / "probe-dna.json").write_text(json.dumps(dna, indent=2))

    pngs = render_page_pngs(pdf_bytes, scale=2.0, max_pages=10)
    for i, b in enumerate(pngs, 1):
        (out / "pages" / f"p{i:03d}.png").write_bytes(b)

    measured = dna["palette"]["measured"]
    faces = dna["type"]["faces"]
    print(f"probe: {len(measured)} measured colors, {len(faces)} font faces, {len(pngs)} page PNGs")
    print("top colors:", ", ".join(c["hex"] for c in measured[:8]))
    print("fonts:", ", ".join(f"{f['pdf_name']}→{f['mapping']['web_family']}" for f in faces[:6]))


if __name__ == "__main__":
    main()
