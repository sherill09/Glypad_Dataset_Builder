"""
Finds the text on a drawing sheet and returns one candidate per text line,
each with a bounding box in the same coordinate space the tracer canvas uses:

- PDFs: the native vector text layer (PyMuPDF). Coordinates are scaled to the
  same 2000px-wide render the viewer uses (see PdfBackground.tsx), so boxes
  line up with what the person sees. Rectangles drawn by the sheet itself
  (GD&T feature control frames) are detected and used as the box when a
  line of text sits inside one.
- PNG / JPG: OCR via the Tesseract binary. Pixel coordinates match the image.

Anything else (DXF, SVG, a PDF with no text layer) returns no candidates or
raises ExtractionUnavailable, and the caller falls back to manual boxes.
"""

import logging
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Same width PdfBackground.tsx renders PDFs at, so coordinates line up.
PDF_RENDER_WIDTH = 2000
OCR_MIN_CONFIDENCE = 30
OCR_TIMEOUT_SECONDS = 120


class ExtractionUnavailable(Exception):
    """Raised when this file type can't be read for text, or the OCR engine
    isn't available/fails. The caller falls back to manual boxes."""


class TransientExtractionError(ExtractionUnavailable):
    """A failure that may not happen next time (OCR engine not started, timeout, crash).
    The region is marked failed and retried, not given a permanent manual fallback."""


@dataclass
class TextCandidate:
    text: str
    bbox: list[list[float]]  # 4 corners, clockwise from top-left
    source: str  # "vector" | "ocr"
    is_frame: bool = False


def _rect_points(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
    return [[round(x0, 1), round(y0, 1)], [round(x1, 1), round(y0, 1)], [round(x1, 1), round(y1, 1)], [round(x0, 1), round(y1, 1)]]


def _group_lines(words: list[tuple[float, float, float, float, str, int]]) -> list[tuple[str, tuple[float, float, float, float]]]:
    """words: (x0, y0, x1, y1, text, line_key). Returns (joined text, union bbox) per line, left to right."""
    by_line: dict[int, list] = {}
    for w in words:
        by_line.setdefault(w[5], []).append(w)
    lines = []
    for items in by_line.values():
        items.sort(key=lambda w: w[0])
        text = " ".join(w[4] for w in items)
        bbox = (
            min(w[0] for w in items),
            min(w[1] for w in items),
            max(w[2] for w in items),
            max(w[3] for w in items),
        )
        lines.append((text, bbox))
    return lines


INK_THRESHOLD = 200  # grey level below which a pixel counts as drawn ink


def _ink_map(page, matrix):
    """The rendered sheet as grey pixels, for checking that text is actually drawn."""
    import pymupdf

    pix = page.get_pixmap(matrix=matrix, colorspace=pymupdf.csGRAY, alpha=False)
    return (pix.samples, pix.stride, pix.width, pix.height)


def _has_ink(ink, rect) -> bool:
    samples, stride, width, height = ink
    x0, y0 = max(0, int(rect.x0)), max(0, int(rect.y0))
    x1, y1 = min(width - 1, int(rect.x1)), min(height - 1, int(rect.y1))
    if x1 < x0 or y1 < y0:
        return False
    step = 1  # every pixel: thin strokes must not slip between samples
    for y in range(y0, y1 + 1, step):
        row = y * stride
        for x in range(x0, x1 + 1, step):
            if samples[row + x] < INK_THRESHOLD:
                return True
    return False


def _merge_neighbours(lines: list[tuple[str, tuple[float, float, float, float]]]) -> list[tuple[str, tuple[float, float, float, float]]]:
    """Joins text lines that sit side by side on one baseline and are close
    together -- e.g. "B.C." and "63", or "4X Tap M6X1.0" and "7.6", which a PDF
    often stores as separate text blocks. Lines in different table cells
    are far apart and stay separate."""
    items = sorted(lines, key=lambda t: (round(t[1][1]), t[1][0]))
    merged = True
    while merged:
        merged = False
        out: list[tuple[str, tuple[float, float, float, float]]] = []
        used = [False] * len(items)
        for i, (ta, ba) in enumerate(items):
            if used[i]:
                continue
            text, box = ta, ba
            for j in range(i + 1, len(items)):
                if used[j]:
                    continue
                tb, bb = items[j]
                h = min(box[3] - box[1], bb[3] - bb[1]) or 1.0
                overlap = min(box[3], bb[3]) - max(box[1], bb[1])
                gap = bb[0] - box[2]
                if overlap >= 0.5 * h and -0.2 * h <= gap <= 1.0 * h:
                    text = f"{text} {tb}"
                    box = (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
                    used[j] = True
                    merged = True
            out.append((text, box))
        items = out
    return items


# --- PDF (native vector text) -------------------------------------------------

def extract_pdf(data: bytes) -> list[TextCandidate]:
    import pymupdf

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ExtractionUnavailable(f"Could not open the PDF: {exc}") from exc
    if doc.page_count == 0:
        raise ExtractionUnavailable("The PDF has no pages")

    page = doc[0]
    scale = PDF_RENDER_WIDTH / page.rect.width
    matrix = pymupdf.Matrix(scale, scale)

    # Each word: (x0, y0, x1, y1, text, line_key). PyMuPDF's (block, line)
    # numbers identify which words sit on the same printed line.
    # Text placed outside the visible sheet (off the page edge) isn't on the drawing,
    # so it isn't a callout. Keep only words whose centre lies on the page.
    sheet_w, sheet_h = page.rect.width * scale, page.rect.height * scale
    # Some PDFs carry text that never draws (no ink where the text sits: clipped,
    # missing glyphs, or stale layers). Check the rendered sheet for ink under each word.
    ink = _ink_map(page, matrix)
    words = []
    for x0, y0, x1, y1, text, block_no, line_no, _word_no in page.get_text("words"):
        r = pymupdf.Rect(x0, y0, x1, y1) * matrix
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        if not (0 <= cx <= sheet_w and 0 <= cy <= sheet_h):
            continue
        if not _has_ink(ink, r):
            continue
        words.append((r.x0, r.y0, r.x1, r.y1, text, hash((block_no, line_no))))

    # Closed rectangles the sheet itself draws (GD&T frames, title-block cells).
    rects = []
    for drawing in page.get_drawings():
        r = drawing.get("rect")
        if r is None or r.width < 2 or r.height < 2:
            continue
        rr = r * matrix
        rects.append((rr.x0, rr.y0, rr.x1, rr.y1))

    candidates: list[TextCandidate] = []
    for text, (x0, y0, x1, y1) in _merge_neighbours(_group_lines(words)):
        if not text.strip():
            continue
        line_h = max(y1 - y0, 1.0)
        frame = _enclosing_frame(rects, (x0, y0, x1, y1), line_h)
        if frame is not None:
            fx0, fy0, fx1, fy1 = frame
            candidates.append(TextCandidate(text=text, bbox=_rect_points(fx0, fy0, fx1, fy1), source="vector", is_frame=True))
        else:
            candidates.append(TextCandidate(text=text, bbox=_rect_points(x0, y0, x1, y1), source="vector"))
    doc.close()
    return candidates


def _enclosing_frame(rects, text_box, line_h):
    """The smallest sheet rectangle that contains this text line, if it's
    frame-sized (a few text-heights tall, not the whole sheet or a title
    block). Returns None when the text isn't inside a frame."""
    tx0, ty0, tx1, ty1 = text_box
    best = None
    for rx0, ry0, rx1, ry1 in rects:
        contains = rx0 <= tx0 and ry0 <= ty0 and rx1 >= tx1 and ry1 >= ty1
        if not contains:
            continue
        h = ry1 - ry0
        if h > line_h * 3:  # too tall to be a single frame row
            continue
        area = (rx1 - rx0) * h
        if best is None or area < best[0]:
            best = (area, (rx0, ry0, rx1, ry1))
    return best[1] if best else None


# --- Raster (OCR via Tesseract) -------------------------------------------------

def extract_raster(data: bytes, extension: str) -> list[TextCandidate]:
    if extension not in {"png", "jpg", "jpeg"}:
        raise ExtractionUnavailable(f"OCR isn't available for .{extension} files")

    fd, path = tempfile.mkstemp(suffix=f".{extension}")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        try:
            # psm 11: sparse text, which suits drawings (labels scattered on a sheet)
            proc = subprocess.run(
                ["tesseract", path, "stdout", "--psm", "11", "tsv"],
                capture_output=True,
                text=True,
                timeout=OCR_TIMEOUT_SECONDS,
            )
        except FileNotFoundError as exc:
            raise ExtractionUnavailable("The Tesseract OCR engine isn't installed on this server") from exc
        except subprocess.TimeoutExpired as exc:
            raise TransientExtractionError("OCR took too long on this sheet") from exc
    finally:
        os.remove(path)

    if proc.returncode != 0:
        logger.warning("tesseract failed: %s", proc.stderr.strip())
        raise TransientExtractionError("OCR failed on this sheet")

    words = []
    lines = proc.stdout.splitlines()
    header = lines[0].split("\t") if lines else []
    idx = {name: i for i, name in enumerate(header)}
    for row in lines[1:]:
        cols = row.split("\t")
        if len(cols) < len(header):
            continue
        if cols[idx["level"]] != "5":  # word-level rows only
            continue
        text = cols[idx["text"]].strip()
        try:
            conf = float(cols[idx["conf"]])
        except ValueError:
            continue
        if not text or conf < OCR_MIN_CONFIDENCE:
            continue
        left, top = float(cols[idx["left"]]), float(cols[idx["top"]])
        width, height = float(cols[idx["width"]]), float(cols[idx["height"]])
        line_key = hash((cols[idx["block_num"]], cols[idx["par_num"]], cols[idx["line_num"]]))
        words.append((left, top, left + width, top + height, text, line_key))

    return [
        TextCandidate(text=text, bbox=_rect_points(*bbox), source="ocr")
        for text, bbox in _merge_neighbours(_group_lines(words))
    ]


def extract_candidates(data: bytes, file_format: str) -> list[TextCandidate]:
    if file_format == "pdf":
        return extract_pdf(data)
    if file_format in {"png", "jpg", "jpeg"}:
        return extract_raster(data, file_format)
    raise ExtractionUnavailable(f"Text extraction isn't available for {file_format} drawings")


def point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    """Ray casting. Points exactly on an edge count as inside, which matters
    for text sitting right on a region border."""
    inside = False
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            x_cross = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < x_cross:
                inside = not inside
    return inside
