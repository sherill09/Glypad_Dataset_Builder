"""Text extraction for region entity suggestions (app/services/text_extraction.py)."""

import pymupdf
import pytest

from app.services.callout_parser import callout_for_extraction
from app.services.text_extraction import (
    ExtractionUnavailable,
    extract_candidates,
    extract_pdf,
    extract_raster,
    point_in_polygon,
)


def _sheet_pdf() -> bytes:
    """A one-page sheet: a dimension line of text, and a GD&T frame drawn as a rectangle with its callout inside."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    page.insert_text((60, 80), "Ø12.5 ±0.1", fontsize=14)
    frame = pymupdf.Rect(60, 200, 260, 230)
    page.draw_rect(frame, color=(0, 0, 0), width=1)
    page.insert_text((70, 220), "⌖ Ø0.1 A B", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


def test_pdf_text_lines_become_candidates_scaled_to_viewer_width():
    candidates = extract_pdf(_sheet_pdf())
    texts = [c.text for c in candidates]
    assert any("12.5" in t for t in texts)
    dim = next(c for c in candidates if "12.5" in c.text)
    assert dim.source == "vector"
    assert not dim.is_frame
    # Viewer renders PDFs 2000px wide: text placed at x=60pt on a 600pt page starts at 60 * 2000/600
    assert min(p[0] for p in dim.bbox) == pytest.approx(60 * 2000 / 600, abs=3)


def test_gdt_callout_inside_drawn_rectangle_uses_the_frame_box():
    candidates = extract_pdf(_sheet_pdf())
    frame_candidates = [c for c in candidates if c.is_frame]
    assert len(frame_candidates) == 1
    xs = [p[0] for p in frame_candidates[0].bbox]
    # Frame is 200pt wide at scale 2000/600, so the box is about 667 units wide
    assert max(xs) - min(xs) == pytest.approx(200 * 2000 / 600, rel=0.02)
    assert callout_for_extraction(frame_candidates[0].text, is_frame=True).kind == "gdt"


def test_dimension_text_reads_as_a_dimension():
    candidates = extract_pdf(_sheet_pdf())
    dim = next(c for c in candidates if "12.5" in c.text)
    reading = callout_for_extraction(dim.text, is_frame=False)
    assert reading.kind == "dimension"
    assert reading.parsed["tolerance_plus"] == 0.1


def test_unreadable_pdf_is_unavailable():
    with pytest.raises(ExtractionUnavailable):
        extract_pdf(b"not a pdf")


def test_unsupported_format_falls_back():
    with pytest.raises(ExtractionUnavailable):
        extract_candidates(b"...", "dxf")


def test_raster_ocr_reads_rendered_text():
    # Render the sheet to a PNG and OCR it -- a real round trip through Tesseract.
    doc = pymupdf.open()
    page = doc.new_page(width=800, height=300)
    page.insert_text((80, 120), "DIAMETER 25 MM", fontsize=40)
    png = page.get_pixmap(dpi=150).tobytes("png")
    doc.close()

    candidates = extract_raster(png, "png")
    joined = " ".join(c.text for c in candidates).upper()
    assert "25" in joined
    assert all(c.source == "ocr" for c in candidates)


def test_point_in_polygon():
    square = [[0, 0], [10, 0], [10, 10], [0, 10]]
    assert point_in_polygon(5, 5, square)
    assert not point_in_polygon(15, 5, square)
    assert not point_in_polygon(5, -1, square)
