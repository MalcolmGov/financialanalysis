"""Rebuild Docling-mangled ops/KPI tables from the PDF text layer.

Docling TableFormer often vertically merges unit/value cells on dense IR
"Review of Operations" grids (e.g. "980 042 1 756", "US$ per oz R per t").
The born-digital text layer still has one clean line per metric row — we
reparse those lines into a 5-column FinTable grid:

  Label | Unit | Period A | Period B | % change

Only the character content present in the PDF text layer is used (NBSP is
normalized to a regular space to match Docling's usual digit grouping).
No numeric values are invented or recalculated.
"""
from __future__ import annotations

import re
from dataclasses import replace
from typing import Optional

from .postprocess import InCell, InTable

# Longest-first so "R per kg" wins over "kg". Unanchored — units sit mid-line.
_UNIT_RES = [
    re.compile(r'South African cents per share\s*\(\s*"cps"\s*\)', re.I),
    re.compile(r"US\$\s*per\s*oz", re.I),
    re.compile(r"R\s*per\s*kg", re.I),
    re.compile(r"R\s*per\s*t\b", re.I),
    re.compile(r"R/US\$", re.I),
    re.compile(r"R\s*million", re.I),
    re.compile(r"\bkg\b", re.I),
    re.compile(r"\boz\b", re.I),
    re.compile(r"%"),
]

_NUM = re.compile(
    r"^\(?\d{1,3}(?:[\s\u00a0]\d{3})+(?:\.\d+)?\)?$"  # grouped thousands
    r"|^\(?\d{1,3}(?:\.\d+)?\)?$"  # short int / decimal
    r"|^\(?\d+\.\d+\)?$"
)
_PCT = re.compile(r"^\(?\d{1,3}\)?$")
_OPS_TITLE = re.compile(r"review\s+of\s+operations", re.I)
_MERGE_HINT = re.compile(
    r"(US\$\s*per\s*oz\s*R\s*per)|(\bR\s*per\b(?!\s*kg|\s*t))"
    r"|(\d[\d\s]+\d\s+\d[\d\s]*\d)|share\s*\(\s*\"\s*cps",
    re.I,
)


def _norm_spaces(s: str) -> str:
    """NBSP / thin spaces → regular space (Docling convention); collapse runs."""
    s = s.replace("\u00a0", " ").replace("\u202f", " ").replace("\u2009", " ")
    return re.sub(r"[ \t]+", " ", s).strip()


def _is_num(tok: str) -> bool:
    return bool(_NUM.match(tok.strip()))


def _is_pct(tok: str) -> bool:
    t = tok.strip()
    return bool(_PCT.match(t)) and not re.search(r"\.", t)


def _join(parts: list[str]) -> str:
    return " ".join(parts)


def _split_period_values(parts: list[str]) -> Optional[tuple[str, str, str]]:
    """Partition digit tokens into (period_a, period_b, pct).

    SA thousands use spaces, so naive left-to-right merge turns '184 172 7'
    into one number. Prefer a bipartition of the non-pct tokens into two
    well-formed numbers.
    """
    if len(parts) < 2:
        return None
    pct = ""
    body = parts
    if len(parts) >= 3 and _is_pct(parts[-1]):
        pct = parts[-1]
        body = parts[:-1]
    if len(body) < 2:
        return None
    # Try every split of body into two contiguous groups.
    candidates: list[tuple[int, str, str]] = []
    for i in range(1, len(body)):
        a, b = _join(body[:i]), _join(body[i:])
        if _is_num(a) and _is_num(b):
            # Score: prefer grouped thousands / decimals over bare 3+3 merges.
            score = 0
            if " " in a or "." in a:
                score += 2
            if " " in b or "." in b:
                score += 2
            if len(body[:i]) >= len(body[i:]):
                score += 1  # slight preference for longer current-period value
            candidates.append((score, a, b))
    if not candidates:
        return None
    candidates.sort(key=lambda x: -x[0])
    _, a, b = candidates[0]
    return a, b, pct


def parse_ops_kpi_line(line: str, carry_label: str) -> Optional[tuple[str, str, str, str, str]]:
    """Parse one ops KPI line → (label, unit, a, b, pct). Uses carry_label when absent."""
    s = _norm_spaces(line)
    if not s or s.startswith("1 Percentage") or s.startswith("Percentage change"):
        return None
    if _OPS_TITLE.search(s) and len(s) < 40:
        return None
    if re.match(r"^Six months ended", s, re.I):
        return None
    if re.match(r"^31\s+\w+\s+\d{4}", s, re.I) and "change" in s.lower():
        return None
    if re.match(r"^%?\s*change", s, re.I):
        return None

    unit_m = None
    # Longest-first patterns; pick the match whose trailing side starts a number.
    for cre in _UNIT_RES:
        for m in cre.finditer(s):
            # Unit must be a standalone token (not mid-word).
            if m.start() > 0 and s[m.start() - 1].isalnum():
                continue
            rest = s[m.end() :].strip()
            if rest and (rest[0].isdigit() or rest[0] == "("):
                unit_m = m
                break
        if unit_m:
            break
    if not unit_m:
        return None

    explicit_label = _norm_spaces(s[: unit_m.start()])
    # Continuation unit rows leave the label cell blank (PDF rowspan look).
    label = explicit_label
    unit = _norm_spaces(unit_m.group(0))
    tail = _norm_spaces(s[unit_m.end() :])
    parts = tail.split(" ")
    split = _split_period_values(parts)
    if not split:
        return None
    a, b, pct = split
    # carry_label reserved for callers that want filled-forward labels.
    _ = carry_label
    return (label, unit, a, b, pct)


def parse_ops_kpi_lines(text: str) -> list[tuple[str, str, str, str, str]]:
    """Full text block → list of (label, unit, a, b, pct) rows."""
    rows: list[tuple[str, str, str, str, str]] = []
    for raw in re.split(r"[\r\n]+", text):
        line = _norm_spaces(raw)
        if not line:
            continue
        parsed = parse_ops_kpi_line(line, "")
        if not parsed:
            continue
        rows.append(parsed)
    return rows


def _table_title_text(table: InTable) -> str:
    cells = sorted((c for c in table.cells if c.r == 0), key=lambda c: c.c)
    if not cells:
        return ""
    return " ".join(c.text for c in cells)


def needs_ops_kpi_repair(table: InTable) -> bool:
    """True when this looks like a Review-of-Operations KPI grid that Docling mangled."""
    if table.num_cols < 4:
        return False
    title = _table_title_text(table)
    texts = " ".join(c.text for c in table.cells)
    if not (_OPS_TITLE.search(title) or _OPS_TITLE.search(texts[:200])):
        # Also catch untitled grids that already show classic merge damage.
        if not _MERGE_HINT.search(texts):
            return False
        if not re.search(r"%\s*change", texts, re.I):
            return False
    # Damage signals: merged units/values, or missing unit header with sparse body.
    if _MERGE_HINT.search(texts):
        return True
    # Tall cells (bbox height >> peers) imply vertical merges.
    heights = []
    for c in table.cells:
        if c.bbox is None:
            continue
        heights.append(abs(c.bbox.b - c.bbox.t))
    if heights:
        heights.sort()
        med = heights[len(heights) // 2]
        if med > 0 and any(h > med * 1.8 for h in heights):
            return True
    return False


def rebuild_ops_kpi_table(table: InTable, lines_text: str) -> Optional[InTable]:
    """Replace table cells with a clean 5-col grid parsed from PDF lines."""
    parsed = parse_ops_kpi_lines(lines_text)
    if len(parsed) < 4:
        return None

    # Header periods from original when present.
    hdr = sorted((c for c in table.cells if c.r == 0), key=lambda c: c.c)
    period_a = next((c.text for c in hdr if re.search(r"20\d{2}", c.text) and "change" not in c.text.lower()), "Six months ended 31 Dec 2025")
    periods = [c.text for c in hdr if re.search(r"20\d{2}", c.text) and "change" not in c.text.lower()]
    if len(periods) >= 2:
        period_a, period_b = periods[0], periods[1]
    else:
        period_b = "Six months ended 31 Dec 2024"
    pct_h = next((c.text for c in hdr if "change" in c.text.lower()), "% change 1")
    title = next((c.text for c in hdr if _OPS_TITLE.search(c.text)), "Review Of Operations")

    cells: list[InCell] = [
        InCell(0, 0, 1, 1, title, is_col_header=True, is_row_header=False),
        InCell(0, 1, 1, 1, "", is_col_header=True),
        InCell(0, 2, 1, 1, period_a, is_col_header=True),
        InCell(0, 3, 1, 1, period_b, is_col_header=True),
        InCell(0, 4, 1, 1, pct_h, is_col_header=True),
    ]
    for i, (label, unit, a, b, pct) in enumerate(parsed, start=1):
        cells.append(InCell(i, 0, 1, 1, label, is_row_header=bool(label)))
        cells.append(InCell(i, 1, 1, 1, unit))
        cells.append(InCell(i, 2, 1, 1, a))
        cells.append(InCell(i, 3, 1, 1, b))
        cells.append(InCell(i, 4, 1, 1, pct))

    return replace(
        table,
        num_rows=1 + len(parsed),
        num_cols=5,
        cells=cells,
    )


def repair_ops_tables_from_pdf(tables: list[InTable], pdf_bytes: bytes) -> list[InTable]:
    """For each mangled ops KPI table, rebuild cells from pdfium text in its bbox."""
    import pypdfium2 as pdfium

    if not any(needs_ops_kpi_repair(t) for t in tables):
        return tables

    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        out: list[InTable] = []
        for table in tables:
            if not needs_ops_kpi_repair(table) or not table.prov:
                out.append(table)
                continue
            p = table.prov[0]
            page_idx = max(0, p.page_no - 1)
            if page_idx >= len(pdf):
                out.append(table)
                continue
            page = pdf[page_idx]
            try:
                tp = page.get_textpage()
                try:
                    h = float(page.get_height())
                    bb = p.bbox
                    # InBBox may be TOPLEFT (post-extract) or BOTTOMLEFT (raw Docling).
                    if bb.coord_origin == "TOPLEFT":
                        top, bottom = h - bb.t, h - bb.b
                        # get_text_bounded wants bottom-left origin: top > bottom in PDF y.
                        left, right = bb.l, bb.r
                        pdf_bottom, pdf_top = h - bb.b, h - bb.t
                    else:
                        left, right = bb.l, bb.r
                        pdf_bottom, pdf_top = bb.b, bb.t
                    # Pad slightly — Docling table bboxes can clip the last row.
                    pad = 4.0
                    text = tp.get_text_bounded(
                        left=left - pad,
                        bottom=min(pdf_bottom, pdf_top) - pad,
                        right=right + pad,
                        top=max(pdf_bottom, pdf_top) + pad,
                    )
                finally:
                    tp.close()
            finally:
                page.close()

            rebuilt = rebuild_ops_kpi_table(table, text or "")
            out.append(rebuilt if rebuilt is not None else table)
        return out
    finally:
        pdf.close()


def repair_extraction_tables_dict(tables: dict, pdf_bytes: bytes) -> dict:
    """In-place-style repair for serialized ExtractionResult['tables']."""
    from .postprocess import InBBox, InProv

    in_tables: list[InTable] = []
    order: list[str] = []
    for tid, t in tables.items():
        order.append(tid)
        prov = []
        for p in t.get("prov") or []:
            bb = p.get("bbox") or {}
            prov.append(
                InProv(
                    page_no=int(p["page_no"]),
                    bbox=InBBox(
                        l=float(bb.get("l", 0)),
                        t=float(bb.get("t", 0)),
                        r=float(bb.get("r", 0)),
                        b=float(bb.get("b", 0)),
                        coord_origin="TOPLEFT",  # extraction JSON is top-left
                    ),
                )
            )
        cells = [
            InCell(
                r=int(c["r"]),
                c=int(c["c"]),
                row_span=int(c.get("row_span", 1)),
                col_span=int(c.get("col_span", 1)),
                text=c.get("text", ""),
                is_col_header=bool(c.get("is_col_header")),
                is_row_header=bool(c.get("is_row_header")),
                is_section=bool(c.get("is_section")),
                bbox=(
                    InBBox(
                        l=float(c["bbox"]["l"]),
                        t=float(c["bbox"]["t"]),
                        r=float(c["bbox"]["r"]),
                        b=float(c["bbox"]["b"]),
                        coord_origin="TOPLEFT",
                    )
                    if c.get("bbox")
                    else None
                ),
            )
            for c in t.get("cells") or []
        ]
        in_tables.append(
            InTable(
                id=tid,
                prov=prov,
                num_rows=int(t["num_rows"]),
                num_cols=int(t["num_cols"]),
                cells=cells,
                caption_block=t.get("caption_block"),
            )
        )

    repaired = repair_ops_tables_from_pdf(in_tables, pdf_bytes)
    out = {}
    for tid, table in zip(order, repaired):
        src = tables[tid]
        out[tid] = {
            **src,
            "num_rows": table.num_rows,
            "num_cols": table.num_cols,
            "cells": [
                {
                    "r": c.r,
                    "c": c.c,
                    "row_span": c.row_span,
                    "col_span": c.col_span,
                    "text": c.text,
                    "is_col_header": c.is_col_header,
                    "is_row_header": c.is_row_header,
                    "is_section": c.is_section,
                    **({"bbox": {"l": c.bbox.l, "t": c.bbox.t, "r": c.bbox.r, "b": c.bbox.b}} if c.bbox else {}),
                }
                for c in table.cells
            ],
        }
    return out
