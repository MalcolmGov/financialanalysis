"""The integrity tests: verbatim preservation, bbox origin flip, furniture
separation, advisory-only numeric annotations."""
from app.postprocess import (
    InBBox,
    InBlock,
    InCell,
    InPage,
    InProv,
    InTable,
    build_extraction_result,
    parse_numeric_annotation,
)

A4_H = 841.9


def _pages():
    return [
        InPage(
            page_no=1,
            width_pt=595.3,
            height_pt=A4_H,
            image_blob_path="pages/p001@2x.png",
            image_width_px=1191,
            image_height_px=1684,
            scale=2.0,
        )
    ]


def _result(body, furniture, tables):
    return build_extraction_result(
        extraction_id="ext_1",
        org_id="org_1",
        project_id="prj_1",
        source={"blob_path": "s.pdf", "sha256": "a" * 64, "size_bytes": 10, "page_count": 1,
                "pdf_meta": {"title": "", "producer": "Workiva", "created": "", "modified": ""}},
        engine={"docling_version": "2.x", "backend": "docling_parse_v4", "table_mode": "accurate",
                "ocr_applied": False, "ocr_engine": None},
        pages=_pages(),
        body=body,
        furniture=furniture,
        tables=tables,
        figures=[],
    )


def test_verbatim_cells_preserved_exactly():
    table = InTable(
        id="tbl-1",
        prov=[InProv(1, InBBox(36, 700, 559, 430))],
        num_rows=2,
        num_cols=2,
        cells=[
            InCell(0, 0, 1, 1, "Operating profit", is_row_header=True),
            InCell(0, 1, 1, 1, "2 712.8"),          # thin-space thousands
            InCell(1, 1, 1, 1, "(23.9)"),           # parenthesised negative
        ],
    )
    res = _result([], [], [table])
    cells = {(c["r"], c["c"]): c["text"] for c in res["tables"]["tbl-1"]["cells"]}
    assert cells[(0, 1)] == "2 712.8"   # byte-for-byte, space intact
    assert cells[(1, 1)] == "(23.9)"    # parens intact, not converted to -23.9


def test_numeric_annotations_are_advisory_not_replacements():
    table = InTable(
        id="tbl-1", prov=[InProv(1, InBBox(36, 700, 559, 430))], num_rows=1, num_cols=2,
        cells=[InCell(0, 0, 1, 1, "Rev", is_row_header=True), InCell(0, 1, 1, 1, "5 053.2")],
    )
    res = _result([], [], [table])
    ann = res["enrichment"]["numeric_annotations"]["ext:tbl-1:r0c1"]
    assert ann == {"value": 5053.2, "negative": False, "nil": False}
    # The cell string is still exactly the source.
    assert res["tables"]["tbl-1"]["cells"][1]["text"] == "5 053.2"


def test_parse_numeric_annotation_variants():
    assert parse_numeric_annotation("2 712.8")["value"] == 2712.8
    assert parse_numeric_annotation("(23.9)") == {"value": -23.9, "negative": True, "nil": False}
    assert parse_numeric_annotation("—") == {"value": None, "negative": False, "nil": True}
    assert parse_numeric_annotation("R million") is None  # not numeric => no candidate


def test_bbox_flipped_to_top_left_origin_once():
    # A block near the TOP of the page in bottom-left coords has a HIGH t/b.
    block = InBlock(
        id="blk-1", type="heading", level=1, text="Highlights",
        prov=[InProv(1, InBBox(l=36, t=A4_H - 200, r=559, b=A4_H - 220))],
    )
    res = _result([block], [], [])
    bbox = res["body"][0]["prov"][0]["bbox"]
    # top-left origin: t should be ~200 (distance from the top), t < b.
    assert abs(bbox["t"] - 200) < 0.01
    assert abs(bbox["b"] - 220) < 0.01
    assert bbox["t"] < bbox["b"]


def test_furniture_separated_from_body():
    heading = InBlock(id="blk-1", type="heading", level=1, text="Cash Dividend",
                      prov=[InProv(1, InBBox(36, 600, 300, 580))])
    footer = InBlock(id="blk-foot", type="page_footer", text="DRDGOLD ... 4",
                     prov=[InProv(1, InBBox(36, 40, 559, 20))], is_furniture=True)
    res = _result([heading], [footer], [])
    assert [b["id"] for b in res["body"]] == ["blk-1"]
    assert [b["id"] for b in res["furniture"]] == ["blk-foot"]
    assert res["furniture"][0]["type"] == "page_footer"


def test_sections_derived_from_headings():
    body = [
        InBlock(id="h1", type="heading", level=1, text="Highlights", prov=[InProv(1, InBBox(36, 800, 559, 780))]),
        InBlock(id="p1", type="paragraph", text="body", prov=[InProv(1, InBBox(36, 770, 559, 700))]),
        InBlock(id="h2", type="heading", level=1, text="Review of Operations", prov=[InProv(1, InBBox(36, 690, 559, 670))]),
    ]
    res = _result(body, [], [])
    titles = [s["title"] for s in res["enrichment"]["sections"]]
    assert titles == ["Highlights", "Review of Operations"]
