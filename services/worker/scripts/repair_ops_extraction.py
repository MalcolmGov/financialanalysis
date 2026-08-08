#!/usr/bin/env python3
"""Repair mangled Review-of-Operations tables in an ExtractionResult JSON file.

Usage:
  .venv/bin/python scripts/repair_ops_extraction.py \\
      --extraction /path/to/extraction.json \\
      --pdf /path/to/source.pdf \\
      --out /path/to/extraction.repaired.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.repair_tables import needs_ops_kpi_repair, repair_extraction_tables_dict
from app.postprocess import InBBox, InCell, InProv, InTable


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--extraction", required=True)
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    ext = json.loads(Path(args.extraction).read_text())
    pdf = Path(args.pdf).read_bytes()
    before = {tid: t["cells"] for tid, t in ext["tables"].items()}
    ext["tables"] = repair_extraction_tables_dict(ext["tables"], pdf)
    for tid, t in ext["tables"].items():
        if before[tid] != t["cells"]:
            print(f"repaired {tid}: rows={t['num_rows']} cols={t['num_cols']}")
            # show a few body rows
            for c in t["cells"]:
                if c["r"] == 0:
                    continue
                if c["c"] == 0 and c["text"]:
                    print(f"  r{c['r']}: {c['text']}")
    Path(args.out).write_text(json.dumps(ext))
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
