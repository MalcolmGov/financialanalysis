"""Unit tests for the deterministic DNA-probe helpers (no PDF needed)."""
from app.probe import (
    cluster_colors,
    cmyk_to_hex,
    gray_to_hex,
    map_font_family,
    normalize_color,
    rgb_to_hex,
    strip_subset_prefix,
)


def test_strip_subset_prefix():
    assert strip_subset_prefix("EAAAAA+SourceSansPro-Bold") == "SourceSansPro-Bold"
    assert strip_subset_prefix("SourceSansPro-Bold") == "SourceSansPro-Bold"
    # pikepdf emits a leading slash on the PDF Name — must be tolerated
    assert strip_subset_prefix("/AAAXCF+OpenSans-ExtraBold") == "OpenSans-ExtraBold"
    assert strip_subset_prefix("") == ""


def test_map_font_family_handles_slash_prefixed_opensans():
    # The bug the live DRDGOLD run caught: "/AAAXCF+OpenSans-ExtraBold" must map
    # to the exact Open Sans web family, not the generic fallback.
    m = map_font_family("/AAAXCF+OpenSans-ExtraBold")
    assert m["web_family"] == "Open Sans"
    assert m["match_quality"] == "exact"


def test_map_font_family_exact_match_is_license_safe():
    m = map_font_family("EAAAAA+SourceSansPro-Bold")
    assert m["web_family"] == "Source Sans 3"
    assert m["match_quality"] == "exact"
    assert m["licence"] == "OFL-1.1"
    assert m["confidence"] >= 0.9


def test_map_font_family_unknown_falls_back_low_confidence_not_generic():
    m = map_font_family("QWERTY+AcmeCorpSans-Regular")
    assert m["match_quality"] == "panose-nearest"
    assert m["confidence"] <= 0.6
    # deliberately NOT Inter / Arial default
    assert m["web_family"] == "Public Sans"


def test_map_font_family_serif_bit_routes_to_serif_fallback():
    m = map_font_family("ZZ+MysteryFace", serif=True)
    assert m["web_family"] == "Source Serif 4"


def test_color_conversions():
    assert rgb_to_hex((0, 0, 0)) == "#000000"
    assert rgb_to_hex((1, 1, 1)) == "#FFFFFF"
    assert gray_to_hex(0.5) == "#808080"
    # DRDGOLD-ish charcoal table header ~0.25 gray
    assert gray_to_hex(0.25) == "#404040"
    # pure black CMYK
    assert cmyk_to_hex((0, 0, 0, 1)) == "#000000"


def test_normalize_color_tolerates_pdfplumber_shapes():
    assert normalize_color(0.0) == "#000000"          # scalar gray
    assert normalize_color((1.0,)) == "#FFFFFF"        # 1-tuple gray
    assert normalize_color((0.72, 0.57, 0.16)).startswith("#")  # rgb
    assert normalize_color((0, 0, 0, 0)) == "#FFFFFF"  # cmyk white
    assert normalize_color(None) is None
    assert normalize_color("nonsense") is None


def test_cluster_colors_merges_near_duplicates_and_weights():
    samples = [
        ("#B8912A", 0.10, "vector-fill"),  # brand gold
        ("#B9922B", 0.05, "vector-fill"),  # ~same gold (should merge)
        ("#231F20", 0.40, "vector-fill"),  # ink (heaviest)
        ("#E77724", 0.02, "glyph"),        # accent orange
    ]
    out = cluster_colors(samples, tol=12.0)
    # gold pair merged -> 3 clusters, heaviest (ink) first
    assert len(out) == 3
    assert out[0]["hex"] == "#231F20"
    gold = next(c for c in out if abs(int(c["hex"][1:3], 16) - 0xB8) <= 2)
    assert gold["weight"] == 0.15  # 0.10 + 0.05 merged
    assert "vector-fill" in gold["sources"]
