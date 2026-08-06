"""The verbatim post-processor — the heart of extraction integrity.

Assembles ExtractionResult v1 from already-normalized Python structures. This
module is intentionally free of any Docling dependency so it is unit-testable
against synthetic fixtures. The Docling driver (extract.py) maps a real
DoclingDocument into these inputs and calls build_extraction_result().

INVARIANTS ENFORCED HERE:
  * Cell and text values are copied byte-for-byte. No numeric parsing, no
    whitespace collapsing, no locale normalization. "2 712.8", "(23.9)",
    "R million" survive exactly.
  * Bboxes are converted to top-left origin PDF points EXACTLY ONCE, with
    px_per_pt attached to each page image so any consumer maps bbox → pixel
    with no further transform.
  * furniture (page headers/footers) is separated from body and never rendered
    as body copy downstream.
  * numeric_annotations are advisory candidates; they never replace strings.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

SCHEMA_VERSION = "1.0"

# Matches a numeric token for the advisory annotation pass only. Never used to
# rewrite a cell value.
_NUMERIC_RE = re.compile(r"^[\(\-]?\s*[\d    ,.]*\d[\d    ,.]*\)?$")


@dataclass
class InBBox:
    """Bottom-left origin bbox as Docling provides it, plus the page height so
    we can flip the y-axis exactly once."""

    l: float
    t: float
    r: float
    b: float


@dataclass
class InProv:
    page_no: int
    bbox: InBBox
    charspan: Optional[tuple[int, int]] = None


@dataclass
class InBlock:
    id: str
    type: str
    prov: list[InProv]
    text: Optional[str] = None
    level: Optional[int] = None
    ref: Optional[str] = None
    is_furniture: bool = False
    children: list["InBlock"] = field(default_factory=list)


@dataclass
class InCell:
    r: int
    c: int
    row_span: int
    col_span: int
    text: str
    is_col_header: bool = False
    is_row_header: bool = False
    is_section: bool = False
    bbox: Optional[InBBox] = None
    confidence: Optional[float] = None


@dataclass
class InTable:
    id: str
    prov: list[InProv]
    num_rows: int
    num_cols: int
    cells: list[InCell]
    caption_block: Optional[str] = None


@dataclass
class InFigure:
    id: str
    prov: list[InProv]
    image_blob_path: str
    width_px: int
    height_px: int
    mime: str = "image/png"
    caption_block: Optional[str] = None


@dataclass
class InPage:
    page_no: int
    width_pt: float
    height_pt: float
    image_blob_path: str
    image_width_px: int
    image_height_px: int
    scale: float


def _flip_bbox(b: InBBox, page_height_pt: float) -> dict:
    """Bottom-left origin (Docling: t is the top edge, larger y; b the bottom
    edge, smaller y) → top-left origin, y increasing downward. Each edge's new
    coordinate is its distance from the page top."""
    return {
        "l": b.l,
        "t": page_height_pt - b.t,
        "r": b.r,
        "b": page_height_pt - b.b,
    }


def _prov(prov: list[InProv], page_heights: dict[int, float]) -> list[dict]:
    out = []
    for p in prov:
        h = page_heights.get(p.page_no, 0.0)
        entry: dict = {"page_no": p.page_no, "bbox": _flip_bbox(p.bbox, h)}
        if p.charspan is not None:
            entry["charspan"] = list(p.charspan)
        out.append(entry)
    return out


def _block(node: InBlock, page_heights: dict[int, float]) -> dict:
    out: dict = {"id": node.id, "type": node.type, "prov": _prov(node.prov, page_heights)}
    if node.level is not None:
        out["level"] = node.level
    if node.text is not None:
        out["text"] = node.text  # VERBATIM — copied as-is
    if node.ref is not None:
        out["ref"] = node.ref
    out["children"] = [_block(c, page_heights) for c in node.children]
    return out


def parse_numeric_annotation(raw: str) -> Optional[dict]:
    """Advisory only. Returns a parsed candidate or None; never mutates `raw`."""
    s = raw.strip()
    if s in ("—", "–", "-", ""):
        return {"value": None, "negative": False, "nil": s in ("—", "–", "-")}
    if not _NUMERIC_RE.match(s):
        return None
    negative = s.startswith("(") and s.endswith(")")
    core = s.strip("()")
    # Strip all Unicode spacing used as thousands separators; keep the decimal point.
    cleaned = re.sub(r"[    ,]", "", core)
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return {"value": -value if negative else value, "negative": negative, "nil": False}


def build_extraction_result(
    *,
    extraction_id: str,
    org_id: str,
    project_id: str,
    source: dict,
    engine: dict,
    pages: list[InPage],
    body: list[InBlock],
    furniture: list[InBlock],
    tables: list[InTable],
    figures: list[InFigure],
    warnings: list[dict] | None = None,
    sections: list[dict] | None = None,
) -> dict:
    page_heights = {p.page_no: p.height_pt for p in pages}

    pages_out = [
        {
            "page_no": p.page_no,
            "width_pt": p.width_pt,
            "height_pt": p.height_pt,
            "image": {
                "blob_path": p.image_blob_path,
                "width_px": p.image_width_px,
                "height_px": p.image_height_px,
                "scale": p.scale,
                "px_per_pt": p.scale,
            },
        }
        for p in pages
    ]

    tables_out: dict[str, dict] = {}
    numeric_annotations: dict[str, dict] = {}
    for t in tables:
        cells_out = []
        for cell in t.cells:
            cell_out: dict = {
                "r": cell.r,
                "c": cell.c,
                "row_span": cell.row_span,
                "col_span": cell.col_span,
                "text": cell.text,  # VERBATIM
                "is_col_header": cell.is_col_header,
                "is_row_header": cell.is_row_header,
                "is_section": cell.is_section,
            }
            if cell.bbox is not None:
                cell_out["bbox"] = _flip_bbox(cell.bbox, page_heights.get(t.prov[0].page_no, 0.0))
            if cell.confidence is not None:
                cell_out["confidence"] = cell.confidence
            cells_out.append(cell_out)
            # Advisory numeric annotation, keyed by cell ref.
            if not (cell.is_col_header or cell.is_row_header):
                ann = parse_numeric_annotation(cell.text)
                if ann is not None:
                    numeric_annotations[f"ext:{t.id}:r{cell.r}c{cell.c}"] = ann
        tables_out[t.id] = {
            "id": t.id,
            "caption_block": t.caption_block,
            "prov": _prov(t.prov, page_heights),
            "num_rows": t.num_rows,
            "num_cols": t.num_cols,
            "cells": cells_out,
            "column_roles": None,
        }

    figures_out: dict[str, dict] = {
        f.id: {
            "id": f.id,
            "caption_block": f.caption_block,
            "prov": _prov(f.prov, page_heights),
            "image": {
                "blob_path": f.image_blob_path,
                "mime": f.mime,
                "width_px": f.width_px,
                "height_px": f.height_px,
            },
            "classification": None,
        }
        for f in figures
    }

    return {
        "schema_version": SCHEMA_VERSION,
        "extraction_id": extraction_id,
        "org_id": org_id,
        "project_id": project_id,
        "source": source,
        "engine": engine,
        "pages": pages_out,
        "body": [_block(b, page_heights) for b in body],
        "furniture": [_block(f, page_heights) for f in furniture],
        "tables": tables_out,
        "figures": figures_out,
        "warnings": warnings or [],
        "enrichment": {
            "sections": sections or _derive_sections(body),
            "key_figures": [],  # populated by a later enrichment pass
            "numeric_annotations": numeric_annotations,
        },
    }


def _derive_sections(body: list[InBlock]) -> list[dict]:
    """Cheap section map from the heading tree: each top-level heading opens a
    section spanning until the next same-or-higher heading."""
    sections: list[dict] = []
    flat: list[InBlock] = []

    def walk(nodes: list[InBlock]) -> None:
        for n in nodes:
            flat.append(n)
            walk(n.children)

    walk(body)
    current: Optional[dict] = None
    for n in flat:
        if n.type == "heading" and (n.level or 1) <= 2:
            if current:
                sections.append(current)
            pages = [p.page_no for p in n.prov]
            current = {
                "id": f"sec-{n.id}",
                "title": n.text or "",
                "level": n.level or 1,
                "page_span": [min(pages) if pages else 1, max(pages) if pages else 1],
                "block_ids": [n.id],
            }
        elif current:
            current["block_ids"].append(n.id)
            if n.prov:
                last = max(p.page_no for p in n.prov)
                current["page_span"][1] = max(current["page_span"][1], last)
    if current:
        sections.append(current)
    return sections
