"""Lightweight page rasterizer (pypdfium2) for the vision DNA pass. In the full
pipeline Docling produces the 2x page images during extraction; this standalone
renderer covers the design-DNA path when only a light stack is available."""
from __future__ import annotations

import io


def render_page_pngs(pdf_bytes: bytes, scale: float = 2.0, max_pages: int = 12) -> list[bytes]:
    """Render up to max_pages pages to PNG bytes at the given scale (2.0 ≈ 144dpi)."""
    import pypdfium2 as pdfium

    pngs: list[bytes] = []
    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        n = min(len(pdf), max_pages)
        for i in range(n):
            page = pdf[i]
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil()
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            pngs.append(buf.getvalue())
            page.close()
        return pngs
    finally:
        pdf.close()
