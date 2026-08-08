"""Ops KPI table repair — PDF text-layer reparse, no invented numbers."""
from app.repair_tables import (
    needs_ops_kpi_repair,
    parse_ops_kpi_lines,
    rebuild_ops_kpi_table,
)
from app.postprocess import InBBox, InCell, InProv, InTable


SAMPLE = """
Review Of Operations
Six months ended
31 Dec 2025
Six months ended
31 Dec 2024 % change1
Gold production kg 2\xa0337 2\xa0564 (9)
oz 75\xa0136 82\xa0434 (9)
Cash operating costs R per kg 980\xa0042 866\xa0221 13
US$ per oz 1\xa0756 1\xa0502 17
R per t 184 172 7
All-in sustaining costs R per kg 1\xa0094\xa0188 963\xa0316 14
US$ per oz 1\xa0960 1\xa0670 17
Headline earnings R million 1\xa0932.4 970.1 99
South African cents per share ("cps") 223.2 112.6 98
1 Percentage change is rounded
"""


def test_parse_splits_merged_ops_metrics():
    rows = parse_ops_kpi_lines(SAMPLE)
    by_unit = {(r[0], r[1]): r for r in rows}
    assert by_unit[("Cash operating costs", "R per kg")][2:] == ("980 042", "866 221", "13")
    assert by_unit[("", "US$ per oz")][2:4] == ("1 756", "1 502") or any(
        r[1] == "US$ per oz" and r[2] == "1 756" for r in rows
    )
    cash_usd = next(r for r in rows if r[1] == "US$ per oz" and r[2] == "1 756")
    assert cash_usd[3:] == ("1 502", "17")
    cash_t = next(r for r in rows if r[1] == "R per t")
    assert cash_t[2:] == ("184", "172", "7")
    aisc = next(r for r in rows if r[0] == "All-in sustaining costs" and r[1] == "R per kg")
    assert aisc[2:] == ("1 094 188", "963 316", "14")
    he = next(r for r in rows if r[0] == "Headline earnings" and "million" in r[1])
    assert he[2:] == ("1 932.4", "970.1", "99")
    cps = next(r for r in rows if "cps" in r[1])
    assert cps[2:] == ("223.2", "112.6", "98")
    # No concatenated ghosts
    flat = " ".join(x for r in rows for x in r)
    assert "980 042 1 756" not in flat
    assert "US$ per oz R per t" not in flat


def test_rebuild_produces_5_col_grid():
    broken = InTable(
        id="tbl-0001",
        prov=[InProv(1, InBBox(28, 210, 567, 401, coord_origin="TOPLEFT"))],
        num_rows=3,
        num_cols=5,
        cells=[
            InCell(0, 0, 1, 1, "Review Of Operations", is_col_header=True),
            InCell(0, 2, 1, 1, "Six months ended 31 Dec 2025", is_col_header=True),
            InCell(0, 3, 1, 1, "Six months ended 31 Dec 2024", is_col_header=True),
            InCell(0, 4, 1, 1, "% change 1", is_col_header=True),
            InCell(1, 0, 1, 1, "Cash operating costs", is_row_header=True),
            InCell(1, 1, 1, 1, "R per kg"),
            InCell(1, 2, 1, 1, "980 042 1 756"),
            InCell(1, 3, 1, 1, "866 221"),
            InCell(2, 1, 1, 1, "US$ per oz R per t"),
            InCell(2, 2, 1, 1, "184"),
        ],
    )
    assert needs_ops_kpi_repair(broken)
    fixed = rebuild_ops_kpi_table(broken, SAMPLE)
    assert fixed is not None
    assert fixed.num_cols == 5
    grid = {(c.r, c.c): c.text for c in fixed.cells}
    assert grid[(1, 2)] == "2 337"  # gold production first data row
    # Find cash operating R/kg
    for r in range(1, fixed.num_rows):
        if grid.get((r, 0)) == "Cash operating costs" and grid.get((r, 1)) == "R per kg":
            assert grid[(r, 2)] == "980 042"
            assert grid[(r, 3)] == "866 221"
            assert grid[(r, 4)] == "13"
            break
    else:
        raise AssertionError("cash operating R/kg row missing")
