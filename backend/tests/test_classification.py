"""
A first, small test file — this doesn't need a database or a running
server, so it's a good example to start from when you add more tests later.

Run with: pytest   (from inside backend/, with the virtual environment active)
"""

from app.services.classification import classify, ext_of, suggest_complexity


def test_ext_of():
    assert ext_of("drawing.DXF") == "dxf"
    assert ext_of("no_extension") == ""


def test_suggest_complexity():
    assert suggest_complexity(1000) == "simple"
    assert suggest_complexity(500_000) == "medium"
    assert suggest_complexity(5_000_000) == "complex"


def test_classify_unsupported_extension():
    result = classify("model.blend", b"not a real file")
    assert result.supported is False


def test_classify_svg_with_text():
    svg_bytes = b'<svg><text x="0" y="0">Hello</text></svg>'
    result = classify("sheet.svg", svg_bytes)
    assert result.supported is True
    assert result.category == "2d"
    assert result.repr_type == "vector"
    assert result.text_layer is True
    assert result.traceable is True


def test_classify_step_file():
    result = classify("bracket.step", b"ISO-10303-21;")
    assert result.category == "3d"
    assert result.traceable is False
    assert result.page_count == 1
    assert result.has_vector_geo is True
    assert result.has_raster_geo is False


def test_classify_raster_image():
    result = classify("drawing.png", b"\x89PNG\r\n\x1a\n")
    assert result.category == "2d"
    assert result.format == "png"
    assert result.page_count == 1
    assert result.has_vector_geo is False
    assert result.has_raster_geo is True
    assert result.has_vector_text is False
    assert result.has_raster_text is True


def test_classify_svg_hybrid_and_vector():
    svg_pure = b'<svg><path d="M 0 0 L 10 10"/><text>CAD</text></svg>'
    r_pure = classify("pure.svg", svg_pure)
    assert r_pure.page_count == 1
    assert r_pure.has_vector_geo is True
    assert r_pure.has_raster_geo is False
    assert r_pure.has_vector_text is True
    assert r_pure.has_raster_text is False

    svg_hybrid = b'<svg><path d="M 0 0 L 10 10"/><image href="test.png"/><text>Hybrid</text></svg>'
    r_hybrid = classify("hybrid.svg", svg_hybrid)
    assert r_hybrid.page_count == 1
    assert r_hybrid.has_vector_geo is True
    assert r_hybrid.has_raster_geo is True
    assert r_hybrid.has_vector_text is True
    assert r_hybrid.has_raster_text is True

