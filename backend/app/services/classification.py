"""
Figures out what a newly-uploaded file *is* — its category (2D/3D), its
format, whether it's vector or raster, whether it has a text layer, and how
complex it looks — the same rules the original Claude artifact prototype
used, ported to Python.

One real simplification versus the artifact: the artifact's storage
capability only accepted a fixed list of file types, so formats like STEP,
IGES, DXF and binary STL had to be smuggled in mislabeled as plain text
(and binary STL couldn't be stored at all). A real backend has no such
restriction — every format here is stored as its real bytes with its real
content type, including binary STL. That whole workaround simply goes away.
"""

from dataclasses import dataclass

EXT_INFO: dict[str, dict[str, str]] = {
    "step": {"category": "3d"},
    "stp": {"category": "3d"},
    "iges": {"category": "3d"},
    "igs": {"category": "3d"},
    "stl": {"category": "3d"},
    "obj": {"category": "3d"},
    "dxf": {"category": "2d", "repr": "vector"},
    "svg": {"category": "2d", "repr": "vector"},
    "pdf": {"category": "2d", "repr": "vector"},
    "png": {"category": "2d", "repr": "raster"},
    "jpg": {"category": "2d", "repr": "raster"},
    "jpeg": {"category": "2d", "repr": "raster"},
    "tif": {"category": "2d", "repr": "raster"},
    "tiff": {"category": "2d", "repr": "raster"},
}

# Formats that get a live viewer + region tracer in the frontend.
TRACEABLE_FORMATS = {"png", "jpg", "jpeg", "svg", "pdf", "dxf"}

CONTENT_TYPES: dict[str, str] = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
    "dxf": "image/vnd.dxf",
    "step": "model/step",
    "stp": "model/step",
    "iges": "model/iges",
    "igs": "model/iges",
    "stl": "model/stl",
    "obj": "model/obj",
    "tif": "image/tiff",
    "tiff": "image/tiff",
}


@dataclass
class Classification:
    supported: bool
    category: str | None = None
    format: str | None = None
    repr_type: str | None = None
    text_layer: bool | None = None
    traceable: bool = False
    content_type: str = "application/octet-stream"
    complexity: str = "simple"
    page_count: int = 1
    has_vector_geo: bool = False
    has_raster_geo: bool = False
    has_vector_text: bool = False
    has_raster_text: bool = False


def ext_of(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def suggest_complexity(size_bytes: int) -> str:
    if size_bytes < 150 * 1024:
        return "simple"
    if size_bytes < 2 * 1024 * 1024:
        return "medium"
    return "complex"


def inspect_layers_and_pages(fmt: str, data: bytes) -> tuple[int, bool, bool, bool, bool]:
    """Inspects file bytes to detect:
    (page_count, has_vector_geo, has_raster_geo, has_vector_text, has_raster_text)

    Handles pure vector, pure raster, and hybrid files (e.g. PDFs with both
    vector geometry lines and embedded raster images, or both vector font text
    and scanned raster text).
    """
    page_count = 1
    has_vector_geo = False
    has_raster_geo = False
    has_vector_text = False
    has_raster_text = False

    if fmt == "pdf":
        try:
            import io
            import pypdf

            reader = pypdf.PdfReader(io.BytesIO(data))
            page_count = max(1, len(reader.pages))

            for page in reader.pages:
                # 1. Vector text detection via native text extraction
                try:
                    txt = page.extract_text()
                    if txt and len(txt.strip()) > 0:
                        has_vector_text = True
                except Exception:
                    pass

                # 2. Raster images inspection in page /Resources /XObject
                try:
                    res = page.get("/Resources")
                    if res:
                        res_obj = res.get_object() if hasattr(res, "get_object") else res
                        xobjs = res_obj.get("/XObject") if res_obj else None
                        if xobjs:
                            xobjs_obj = xobjs.get_object() if hasattr(xobjs, "get_object") else xobjs
                            for _, xobj in xobjs_obj.items():
                                x = xobj.get_object() if hasattr(xobj, "get_object") else xobj
                                if x and x.get("/Subtype") == "/Image":
                                    has_raster_geo = True
                                    break
                except Exception:
                    pass

                # 3. Content streams inspection for vector operators and inline images
                try:
                    contents = page.get_contents()
                    stream_data = b""
                    if contents is not None:
                        if hasattr(contents, "get_data"):
                            stream_data = contents.get_data()
                        elif isinstance(contents, (list, tuple)):
                            parts = []
                            for c in contents:
                                c_obj = c.get_object() if hasattr(c, "get_object") else c
                                if hasattr(c_obj, "get_data"):
                                    parts.append(c_obj.get_data())
                            stream_data = b" ".join(parts)

                    if stream_data:
                        tokens = set(stream_data.split())
                        # Vector path construction and painting operators
                        if any(op in tokens for op in [b"m", b"l", b"c", b"v", b"y", b"re", b"s", b"S", b"f", b"F", b"b", b"B"]):
                            has_vector_geo = True
                        if any(op in tokens for op in [b"BT", b"Tj", b"TJ", b"'", b'"']):
                            has_vector_text = True
                        if b"BI" in tokens:
                            has_raster_geo = True
                except Exception:
                    pass

            # In engineering drawings, if the drawing sheet contains raster image data
            # (e.g. scanned sheet or bitmap drawings), it contains raster text.
            if has_raster_geo:
                has_raster_text = True

        except Exception:
            # Fallback byte heuristic if pypdf parsing encounters issues
            sample = data[:2_000_000].decode("latin-1", errors="ignore")
            has_vector_geo = any(f" {op}\n" in sample or f" {op} " in sample for op in ["m", "l", "c", "re", "S", "s", "f", "F"])
            has_raster_geo = ("/Subtype /Image" in sample) or ("/Subtype/Image" in sample) or ("\nBI\n" in sample)
            has_vector_text = (" Tj" in sample) or (" TJ" in sample) or ("BT\n" in sample) or ("/Font" in sample)
            if has_raster_geo:
                has_raster_text = True
            page_count = max(1, sample.count("/Type /Page") - sample.count("/Type /Pages"))

    elif fmt in {"png", "jpg", "jpeg", "tif", "tiff"}:
        page_count = 1
        has_vector_geo = False
        has_raster_geo = True
        has_vector_text = False
        has_raster_text = True

    elif fmt == "svg":
        page_count = 1
        try:
            text = data.decode("utf-8", errors="ignore")
            has_vector_geo = any(tag in text for tag in ["<path", "<line", "<rect", "<circle", "<polygon", "<polyline", "<ellipse"])
            has_raster_geo = "<image" in text
            has_vector_text = ("<text" in text) or ("<tspan" in text)
            has_raster_text = has_raster_geo
        except Exception:
            has_vector_geo = True

    elif fmt == "dxf":
        page_count = 1
        try:
            text = data.decode("utf-8", errors="ignore")
            has_vector_geo = True
            has_raster_geo = ("\nIMAGE\n" in text) or ("\r\nIMAGE\r\n" in text)
            has_vector_text = ("\nTEXT\n" in text) or ("\nMTEXT\n" in text) or ("\r\nTEXT\r\n" in text) or ("\r\nMTEXT\r\n" in text)
            has_raster_text = has_raster_geo
        except Exception:
            has_vector_geo = True

    elif fmt in {"step", "stp", "iges", "igs", "stl", "obj"}:
        page_count = 1
        has_vector_geo = True
        has_raster_geo = False
        has_vector_text = False
        has_raster_text = False

    return page_count, has_vector_geo, has_raster_geo, has_vector_text, has_raster_text


def classify(filename: str, data: bytes) -> Classification:
    fmt = ext_of(filename)
    info = EXT_INFO.get(fmt)
    if not info:
        return Classification(supported=False)

    pages, vec_geo, ras_geo, vec_txt, ras_txt = inspect_layers_and_pages(fmt, data)

    # Determine primary repr representation
    if vec_geo and ras_geo:
        repr_type = "hybrid"
    elif vec_geo:
        repr_type = "vector"
    elif ras_geo:
        repr_type = "raster"
    else:
        repr_type = info.get("repr")

    return Classification(
        supported=True,
        category=info["category"],
        format=fmt,
        repr_type=repr_type,
        text_layer=vec_txt,
        traceable=fmt in TRACEABLE_FORMATS,
        content_type=CONTENT_TYPES.get(fmt, "application/octet-stream"),
        complexity=suggest_complexity(len(data)),
        page_count=pages,
        has_vector_geo=vec_geo,
        has_raster_geo=ras_geo,
        has_vector_text=vec_txt,
        has_raster_text=ras_txt,
    )

