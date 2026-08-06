"""Step 3 — deterministic Design-DNA probe. Measures the PDF's own visual
identity: embedded fonts (pikepdf + fonttools) mapped to license-safe web
families, and the palette (pdfplumber vector fills + glyph colors + rules).

Produces the PROBE HALF of DesignDNA: measured colors and font mappings with
role assignment left empty — the vision pass (opus-5) assigns roles and motifs,
and the reconciler snaps vision colors to these measured values. The pure
helpers here are unit-tested without a PDF; the pdfplumber/pikepdf orchestration
is integration-tested against a real document.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# ── Font name → license-safe web family mapping ─────────────────────────────────
# Exact-name matches to self-hostable OFL/Apache families first; unknown faces
# fall back to a nearest open family, flagged low-confidence for human review.
_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")


def _strip_leading_slash(s: str) -> str:
    # pikepdf stringifies a Name as "/Foo"; drop the leading slash.
    return s[1:] if s.startswith("/") else s

_FONT_MAP: dict[str, tuple[str, str, str]] = {
    # normalized base name -> (web_family, provider, licence)
    "sourcesanspro": ("Source Sans 3", "fontsource-selfhost", "OFL-1.1"),
    "sourcesans3": ("Source Sans 3", "fontsource-selfhost", "OFL-1.1"),
    "opensans": ("Open Sans", "fontsource-selfhost", "OFL-1.1"),
    "roboto": ("Roboto", "fontsource-selfhost", "Apache-2.0"),
    "lato": ("Lato", "fontsource-selfhost", "OFL-1.1"),
    "notosans": ("Noto Sans", "fontsource-selfhost", "OFL-1.1"),
    "sourceserifpro": ("Source Serif 4", "fontsource-selfhost", "OFL-1.1"),
    "sourceserif4": ("Source Serif 4", "fontsource-selfhost", "OFL-1.1"),
    "merriweather": ("Merriweather", "fontsource-selfhost", "OFL-1.1"),
    "arial": ("Liberation Sans", "fontsource-selfhost", "OFL-1.1"),
    "helvetica": ("Liberation Sans", "fontsource-selfhost", "OFL-1.1"),
    "times": ("Liberation Serif", "fontsource-selfhost", "OFL-1.1"),
    "georgia": ("Gelasio", "fontsource-selfhost", "OFL-1.1"),
    "calibri": ("Carlito", "fontsource-selfhost", "OFL-1.1"),
}

# Nearest open equivalents when there is no exact match; chosen to avoid the
# generic-template defaults (Inter / plain Arial) — bias toward characterful
# but neutral open faces.
_FALLBACK_SANS = ("Public Sans", "fontsource-selfhost", "OFL-1.1")
_FALLBACK_SERIF = ("Source Serif 4", "fontsource-selfhost", "OFL-1.1")


def strip_subset_prefix(base_font: str) -> str:
    """'/EAAAAA+SourceSansPro-Bold' -> 'SourceSansPro-Bold' (also tolerates the
    leading slash pikepdf emits on a PDF Name)."""
    return _SUBSET_PREFIX.sub("", _strip_leading_slash(base_font or ""))


def _normalize_family(name: str) -> str:
    # Drop style suffix and non-alphanumerics: 'SourceSansPro-Bold' -> 'sourcesanspro'
    base = re.split(r"[-,]", name, 1)[0]
    return re.sub(r"[^a-z0-9]", "", base.lower())


def map_font_family(base_font: str, serif: bool = False) -> dict:
    """Map a PDF BaseFont to a license-safe web family."""
    stripped = strip_subset_prefix(base_font)
    key = _normalize_family(stripped)
    if key in _FONT_MAP:
        fam, provider, lic = _FONT_MAP[key]
        return {"web_family": fam, "provider": provider, "licence": lic, "match_quality": "exact", "confidence": 0.95}
    fam, provider, lic = _FALLBACK_SERIF if serif else _FALLBACK_SANS
    return {"web_family": fam, "provider": provider, "licence": lic, "match_quality": "panose-nearest", "confidence": 0.55}


# ── Color helpers ───────────────────────────────────────────────────────────────
def rgb_to_hex(rgb: tuple[float, float, float]) -> str:
    """Device RGB in 0..1 (pdfplumber) -> #RRGGBB."""
    r, g, b = (max(0.0, min(1.0, c)) for c in rgb)
    return "#{:02X}{:02X}{:02X}".format(round(r * 255), round(g * 255), round(b * 255))


def gray_to_hex(g: float) -> str:
    v = round(max(0.0, min(1.0, g)) * 255)
    return "#{:02X}{:02X}{:02X}".format(v, v, v)


def cmyk_to_hex(cmyk: tuple[float, float, float, float]) -> str:
    """Naive CMYK->RGB (device, no ICC). Flagged cmyk_source downstream."""
    c, m, y, k = cmyk
    r = 255 * (1 - min(1.0, c)) * (1 - min(1.0, k))
    g = 255 * (1 - min(1.0, m)) * (1 - min(1.0, k))
    b = 255 * (1 - min(1.0, y)) * (1 - min(1.0, k))
    return "#{:02X}{:02X}{:02X}".format(round(r), round(g), round(b))


def normalize_color(color, colorspace: Optional[str] = None) -> Optional[str]:
    """pdfplumber non_stroking_color / fill -> hex, tolerating its shapes
    (float, (r,g,b), (c,m,y,k), or a 1-tuple gray)."""
    if color is None:
        return None
    if isinstance(color, (int, float)):
        return gray_to_hex(float(color))
    try:
        vals = tuple(float(x) for x in color)
    except (TypeError, ValueError):
        return None
    if len(vals) == 1:
        return gray_to_hex(vals[0])
    if len(vals) == 3:
        return rgb_to_hex((vals[0], vals[1], vals[2]))
    if len(vals) == 4:
        return cmyk_to_hex((vals[0], vals[1], vals[2], vals[3]))
    return None


def _hex_to_rgb(hx: str) -> tuple[int, int, int]:
    hx = hx.lstrip("#")
    return int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)


def _rgb_dist(a: str, b: str) -> float:
    ra, ga, ba = _hex_to_rgb(a)
    rb, gb, bb = _hex_to_rgb(b)
    return ((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) ** 0.5


@dataclass
class WeightedColor:
    hex: str
    weight: float = 0.0
    sources: set = field(default_factory=set)


def cluster_colors(samples: list[tuple[str, float, str]], tol: float = 12.0) -> list[dict]:
    """Merge near-identical colors (Euclidean RGB) weighted by area/frequency.
    samples: (hex, weight, source). Returns measured entries, heaviest first."""
    clusters: list[WeightedColor] = []
    for hx, w, src in samples:
        if hx is None:
            continue
        placed = False
        for c in clusters:
            if _rgb_dist(c.hex, hx) <= tol:
                # keep the heavier representative hex
                if w > c.weight:
                    c.hex = hx
                c.weight += w
                c.sources.add(src)
                placed = True
                break
        if not placed:
            clusters.append(WeightedColor(hex=hx, weight=w, sources={src}))
    clusters.sort(key=lambda c: c.weight, reverse=True)
    return [
        {"hex": c.hex, "weight": round(c.weight, 4), "sources": sorted(c.sources), "provenance": "probe", "confidence": 0.9}
        for c in clusters
    ]


# ── PDF probe orchestration (integration path) ──────────────────────────────────
def probe_fonts(pdf_bytes: bytes) -> list[dict]:
    """Enumerate embedded fonts via pikepdf; classify + map to web families."""
    import pikepdf

    faces: dict[str, dict] = {}
    with pikepdf.open(pdf_bytes if isinstance(pdf_bytes, str) else _bytesio(pdf_bytes)) as pdf:
        for page in pdf.pages:
            res = page.get("/Resources")
            fonts = res.get("/Font") if res else None
            if not fonts:
                continue
            for _, font in fonts.items():
                base = str(font.get("/BaseFont", ""))
                if not base or base in faces:
                    continue
                stripped = strip_subset_prefix(base)
                descr = font.get("/FontDescriptor")
                flags = int(descr.get("/Flags", 0)) if descr else 0
                serif = bool(flags & 2)  # PDF FontDescriptor serif bit
                weight = 700 if re.search(r"bold", stripped, re.I) else 400
                italic = bool(re.search(r"italic|oblique", stripped, re.I))
                embedded = bool(descr and (descr.get("/FontFile") or descr.get("/FontFile2") or descr.get("/FontFile3")))
                faces[base] = {
                    "pdf_name": stripped,
                    "family": re.split(r"[-,]", stripped, 1)[0],
                    "weight": weight,
                    "italic": italic,
                    "role": "body",
                    "glyph_share": 0.0,
                    "embedded": embedded,
                    "mapping": map_font_family(base, serif=serif),
                }
    return list(faces.values())


def probe_palette(pdf_bytes: bytes, max_pages: int = 12) -> list[dict]:
    """Collect vector fills, glyph colors, and rule strokes; cluster to a
    weighted measured palette."""
    import pdfplumber

    samples: list[tuple[str, float, str]] = []
    with pdfplumber.open(_bytesio(pdf_bytes)) as pdf:
        for page in pdf.pages[:max_pages]:
            page_area = float(page.width) * float(page.height)
            for rect in page.rects:
                hx = normalize_color(rect.get("non_stroking_color"))
                if hx is None:
                    continue
                area = abs(float(rect.get("width", 0)) * float(rect.get("height", 0)))
                # Ignore full-page background rects (recorded as paper elsewhere).
                if area > 0.85 * page_area:
                    continue
                samples.append((hx, area / page_area, "vector-fill"))
            for ch in page.chars:
                hx = normalize_color(ch.get("non_stroking_color"))
                if hx is not None:
                    samples.append((hx, 0.0002, "glyph"))
            for line in page.lines:
                hx = normalize_color(line.get("stroking_color"))
                if hx is not None:
                    samples.append((hx, 0.0001, "rule"))
    return cluster_colors(samples)


def probe_design_dna(pdf_bytes: bytes, project_id: str, sha256: str, pages: int) -> dict:
    """Assemble the probe half of DesignDNA. Roles/motifs/theme are filled by the
    vision pass; here we supply measured ground truth only."""
    faces = probe_fonts(pdf_bytes)
    measured = probe_palette(pdf_bytes)
    # crude glyph-share: even split across faces (vision + reconciler refine)
    if faces:
        share = round(1.0 / len(faces), 3)
        for f in faces:
            f["glyph_share"] = share
    heading_stack = _stack(faces, prefer_bold=True)
    body_stack = _stack(faces, prefer_bold=False)
    return {
        "schema_version": "dna/1",
        "dna_id": f"dna_{project_id}",
        "project_id": project_id,
        "revision": 1,
        "source_pdf": {"sha256": sha256, "pages": pages},
        "confidence": {"overall": 0.6, "flags": []},  # low until vision + human
        "palette": {"roles": {}, "measured": measured, "imagery": []},
        "type": {
            "faces": faces,
            "stack": {"heading": heading_stack, "body": body_stack},
            "scale": {"observed_pt": [], "web_base_px": 16, "ratio": 1.25},
            "heading_treatment": {"color": "accent", "case": "sentence", "weight": 700},
        },
        "spacing": {"rhythm_px": [4, 8, 12, 16, 24, 40], "page_margins_pt": [], "columns": {}},
        "table_style": {
            "header_bg": "table-header-bg", "header_text": "table-header-text", "header_case": "sentence",
            "rules": {}, "zebra": False, "period_shading": None,
            "numeric_alignment": "right", "negative_format": "parentheses",
            "thousands_separator": "thin-space", "decimal_places": "as-source",
        },
        "components": [], "motifs": [], "tone_words": [],
        "theme": {"mode": "single-light", "rationale": "probe default; confirmed by vision"},
        "human_edits": [],
    }


def _stack(faces: list[dict], prefer_bold: bool) -> str:
    if not faces:
        return "'Public Sans', 'Segoe UI', sans-serif"
    fam = faces[0]["mapping"]["web_family"]
    return f"'{fam}', 'Segoe UI', sans-serif"


def _bytesio(b):
    import io

    return io.BytesIO(b)
