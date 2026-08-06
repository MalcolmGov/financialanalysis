"""Docling extraction driver. Docling/torch are imported LAZILY so the API and
unit tests run without the heavy stack installed. OCR preflight is dependency-
light (pypdfium2 only) and independently testable."""
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
        idxs = list(range(0, n, max(1, n // sample_pages)))[:sample_pages]
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


def _docling_bbox(bbox) -> InBBox:
    # Docling BoundingBox: l, t, r, b in BOTTOMLEFT origin (t > b in page space).
    return InBBox(l=float(bbox.l), t=float(bbox.t), r=float(bbox.r), b=float(bbox.b))


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
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TableFormerMode,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc import DocItemLabel  # type: ignore

    need_ocr = force_ocr or ocr_preflight(pdf_bytes)

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_table_structure = True
    pipeline_options.table_structure_options.mode = TableFormerMode.ACCURATE
    pipeline_options.do_ocr = need_ocr
    pipeline_options.generate_page_images = True
    pipeline_options.images_scale = 2.0
    pipeline_options.generate_picture_images = True

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
    )
    result = converter.convert(io.BytesIO(pdf_bytes))
    doc = result.document

    warnings: list[dict] = []
    if need_ocr:
        warnings.append(
            {"code": "SCANNED_SOURCE", "message": "OCR applied; design-DNA fidelity is degraded on scans."}
        )

    # ── Pages + rendered PNGs at 2x ─────────────────────────────────────────────
    pages: list[InPage] = []
    for page_no, page in sorted(doc.pages.items()):
        img = page.image.pil_image if page.image else None
        w_px, h_px = (img.size if img else (0, 0))
        blob_path = f"{output_prefix}pages/p{page_no:03d}@2x.png"
        if img is not None:
            buf = io.BytesIO()
            img.save(buf, format="PNG")
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
            on_progress(page_no, len(doc.pages))

    # ── Body / furniture / tables / figures ─────────────────────────────────────
    body: list[InBlock] = []
    furniture: list[InBlock] = []
    tables: list[InTable] = []
    figures: list[InFigure] = []
    fig_i = 0

    furniture_labels = {DocItemLabel.PAGE_HEADER, DocItemLabel.PAGE_FOOTER}

    for idx, (item, _level) in enumerate(doc.iterate_items()):
        prov = [
            InProv(page_no=p.page_no, bbox=_docling_bbox(p.bbox))
            for p in getattr(item, "prov", []) or []
        ]
        label = getattr(item, "label", None)

        if hasattr(item, "data") and hasattr(item.data, "table_cells"):
            tid = f"tbl-{idx:04d}"
            cells = [
                InCell(
                    r=c.start_row_offset_idx,
                    c=c.start_col_offset_idx,
                    row_span=max(1, c.end_row_offset_idx - c.start_row_offset_idx),
                    col_span=max(1, c.end_col_offset_idx - c.start_col_offset_idx),
                    text=c.text,  # VERBATIM
                    is_col_header=bool(getattr(c, "column_header", False)),
                    is_row_header=bool(getattr(c, "row_header", False)),
                    is_section=bool(getattr(c, "row_section", False)),
                )
                for c in item.data.table_cells
            ]
            tables.append(
                InTable(
                    id=tid,
                    prov=prov,
                    num_rows=item.data.num_rows,
                    num_cols=item.data.num_cols,
                    cells=cells,
                )
            )
            body.append(InBlock(id=tid, type="table_ref", prov=prov, ref=tid))
            continue

        if label and "picture" in str(label).lower():
            fig_i += 1
            fid = f"fig-{fig_i:04d}"
            blob_path = f"{output_prefix}figures/{fid}.png"
            w_px = h_px = 0
            pil = getattr(getattr(item, "image", None), "pil_image", None)
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
        btype = "heading" if (label and "header" in str(label).lower() and label not in furniture_labels) else "paragraph"
        level = getattr(item, "level", None)
        block = InBlock(
            id=f"blk-{idx:04d}",
            type="page_footer" if label == DocItemLabel.PAGE_FOOTER else ("page_header" if label == DocItemLabel.PAGE_HEADER else btype),
            prov=prov,
            text=text,  # VERBATIM
            level=level,
            is_furniture=label in furniture_labels,
        )
        (furniture if label in furniture_labels else body).append(block)

    engine = {
        "docling_version": _docling_version(),
        "backend": "docling_parse_v4",
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


def _docling_version() -> str:
    try:
        from importlib.metadata import version

        return version("docling")
    except Exception:
        return "unknown"
