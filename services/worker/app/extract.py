"""Docling extraction driver. Docling/torch are imported LAZILY so the API and
unit tests run without the heavy stack installed. OCR preflight is dependency-
light (pypdfium2 only) and independently testable.

Verified against the current docling / docling-core API (Aug 2026):
  - bytes input via DocumentStream(name=, stream=BytesIO(...))
  - PdfPipelineOptions + TableFormerMode.ACCURATE
  - page images: page.image.pil_image ; picture images: item.get_image(doc)
  - TableItem.data.table_cells with start/end_{row,col}_offset_idx,
    row_span/col_span, column_header/row_header/row_section, text
  - item.prov[i].page_no / .bbox (.l/.t/.r/.b + .coord_origin)
"""
from __future__ import annotations

import io
from typing import Optional

from .postprocess import (
    InBBox,
    InBlock,
    InCell,
    InFigure,
    InPage,
    InProv,
    InTable,
    build_extraction_result,
)


def ocr_preflight(pdf_bytes: bytes, sample_pages: int = 20, min_chars: int = 200) -> bool:
    """Return True if OCR is needed (median extractable chars/page below the
    threshold => scanned source). pypdfium2 only."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        n = len(pdf)
        if n == 0:
            return True
        step = max(1, n // sample_pages)
        idxs = list(range(0, n, step))[:sample_pages]
        counts = []
        for i in idxs:
            page = pdf[i]
            textpage = page.get_textpage()
            counts.append(len(textpage.get_text_range().strip()))
            textpage.close()
            page.close()
        counts.sort()
        median = counts[len(counts) // 2] if counts else 0
        return median < min_chars
    finally:
        pdf.close()


def _in_bbox(bbox) -> InBBox:
    origin = getattr(getattr(bbox, "coord_origin", None), "value", "BOTTOMLEFT")
    return InBBox(l=float(bbox.l), t=float(bbox.t), r=float(bbox.r), b=float(bbox.b), coord_origin=str(origin))


def _prov_of(item) -> list[InProv]:
    return [InProv(page_no=p.page_no, bbox=_in_bbox(p.bbox)) for p in getattr(item, "prov", []) or []]


def extract_document(
    *,
    pdf_bytes: bytes,
    extraction_id: str,
    org_id: str,
    project_id: str,
    output_prefix: str,
    source_meta: dict,
    put_asset,  # callable(blob_path, bytes, content_type) -> None
    force_ocr: bool = False,
    on_progress=None,
) -> dict:
    """Convert a PDF to ExtractionResult v1. Heavy imports are local."""
    from docling.datamodel.base_models import DocumentStream, InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc.labels import DocItemLabel
    from docling_core.types.doc.items.table.table import TableItem
    from docling_core.types.doc.items.picture.picture import PictureItem

    need_ocr = force_ocr or ocr_preflight(pdf_bytes)

    pipeline_options = PdfPipelineOptions(do_table_structure=True)
    pipeline_options.table_structure_options.mode = TableFormerMode.ACCURATE
    pipeline_options.do_ocr = need_ocr
    pipeline_options.generate_page_images = True
    pipeline_options.images_scale = 2.0
    pipeline_options.generate_picture_images = True

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
    )
    source = DocumentStream(name="source.pdf", stream=io.BytesIO(pdf_bytes))
    result = converter.convert(source)
    doc = result.document

    warnings: list[dict] = []
    if need_ocr:
        warnings.append(
            {"code": "SCANNED_SOURCE", "message": "OCR applied; design-DNA fidelity is degraded on scans."}
        )

    # ── Pages + rendered PNGs at 2x ─────────────────────────────────────────────
    pages: list[InPage] = []
    total_pages = len(doc.pages)
    for page_no, page in sorted(doc.pages.items()):
        pil = page.image.pil_image if getattr(page, "image", None) else None
        w_px, h_px = (pil.size if pil else (0, 0))
        blob_path = f"{output_prefix}pages/p{page_no:03d}@2x.png"
        if pil is not None:
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            put_asset(blob_path, buf.getvalue(), "image/png")
        size = page.size
        pages.append(
            InPage(
                page_no=page_no,
                width_pt=float(size.width),
                height_pt=float(size.height),
                image_blob_path=blob_path,
                image_width_px=w_px,
                image_height_px=h_px,
                scale=2.0,
            )
        )
        if on_progress:
            on_progress(page_no, total_pages)

    # ── Body / furniture / tables / figures, in reading order ───────────────────
    body: list[InBlock] = []
    furniture: list[InBlock] = []
    tables: list[InTable] = []
    figures: list[InFigure] = []
    tbl_i = 0
    fig_i = 0

    HEADINGS = {DocItemLabel.SECTION_HEADER, DocItemLabel.TITLE}
    FURNITURE = {DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER}
    LIST_LABELS = {DocItemLabel.LIST_ITEM}

    for item, _level in doc.iterate_items():
        prov = _prov_of(item)
        label = getattr(item, "label", None)

        if isinstance(item, TableItem):
            tbl_i += 1
            tid = f"tbl-{tbl_i:04d}"
            cells = [
                InCell(
                    r=c.start_row_offset_idx,
                    c=c.start_col_offset_idx,
                    row_span=int(getattr(c, "row_span", 1)),
                    col_span=int(getattr(c, "col_span", 1)),
                    text=c.text,  # VERBATIM
                    is_col_header=bool(getattr(c, "column_header", False)),
                    is_row_header=bool(getattr(c, "row_header", False)),
                    is_section=bool(getattr(c, "row_section", False)),
                    bbox=_in_bbox(c.bbox) if getattr(c, "bbox", None) else None,
                )
                for c in item.data.table_cells
            ]
            tables.append(
                InTable(id=tid, prov=prov, num_rows=item.data.num_rows, num_cols=item.data.num_cols, cells=cells)
            )
            body.append(InBlock(id=tid, type="table_ref", prov=prov, ref=tid))
            continue

        if isinstance(item, PictureItem):
            fig_i += 1
            fid = f"fig-{fig_i:04d}"
            blob_path = f"{output_prefix}figures/{fid}.png"
            w_px = h_px = 0
            try:
                pil = item.get_image(doc)
            except Exception:
                pil = None
            if pil is not None:
                w_px, h_px = pil.size
                buf = io.BytesIO()
                pil.save(buf, format="PNG")
                put_asset(blob_path, buf.getvalue(), "image/png")
            figures.append(InFigure(id=fid, prov=prov, image_blob_path=blob_path, width_px=w_px, height_px=h_px))
            body.append(InBlock(id=fid, type="figure_ref", prov=prov, ref=fid))
            continue

        text = getattr(item, "text", None)
        if text is None:
            continue

        if label in FURNITURE:
            furniture.append(
                InBlock(
                    id=f"blk-{_seq(body, furniture)}",
                    type="page_footer" if label == DocItemLabel.PAGE_FOOTER else "page_header",
                    prov=prov,
                    text=text,
                    is_furniture=True,
                )
            )
            continue

        if label in HEADINGS:
            btype = "heading"
            level = int(getattr(item, "level", 1) or 1)
        elif label in LIST_LABELS:
            btype = "list_item"
            level = None
        elif label == DocItemLabel.CAPTION:
            btype = "caption"
            level = None
        elif label == DocItemLabel.FOOTNOTE:
            btype = "footnote"
            level = None
        else:
            btype = "paragraph"
            level = None
        body.append(InBlock(id=f"blk-{_seq(body, furniture)}", type=btype, prov=prov, text=text, level=level))

    engine = {
        "docling_version": _docling_version(),
        "backend": "docling_default",
        "table_mode": "accurate",
        "ocr_applied": need_ocr,
        "ocr_engine": "easyocr" if need_ocr else None,
    }
    return build_extraction_result(
        extraction_id=extraction_id,
        org_id=org_id,
        project_id=project_id,
        source=source_meta,
        engine=engine,
        pages=pages,
        body=body,
        furniture=furniture,
        tables=tables,
        figures=figures,
        warnings=warnings,
    )


def _seq(body: list, furniture: list) -> str:
    return f"{len(body) + len(furniture):04d}"


def _docling_version() -> str:
    try:
        from importlib.metadata import version

        return version("docling")
    except Exception:
        return "unknown"
