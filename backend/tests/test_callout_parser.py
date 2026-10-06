"""Reading callout text into kind, subtype, parsed values and warnings (app/services/callout_parser.py)."""

import pytest

from app.services.callout_parser import parse_text


@pytest.mark.parametrize(
    "text, kind, subtype",
    [
        ("⌀12.5", "dimension", "diameter"),
        ("Ø12.5", "dimension", "diameter"),          # Ø normalises to ⌀
        ("R2.5 TYP", "dimension", "radius"),
        ("120°", "dimension", "angular"),
        ("22.5°", "dimension", "angular"),
        ("28.750±0.025", "dimension", "linear"),
        ("Chamfer 1 x 45°", "dimension", "chamfer"),
        ("C2", "dimension", "chamfer"),
        ("B.C. ⌀63", "dimension", "bolt_circle"),
        ("B.C. 50", "dimension", "bolt_circle"),
        ("2X ⌀6 Slip Fit", "hole", "slip_fit"),
        ("4X ⌀6.8 Thru", "hole", "thru"),
        ("4X Tap M6X1.0 ▽ 7.6", "hole", "tapped"),
        ("(8) Tap M3-0.5 ▽ 6", "hole", "tapped"),
        ("M8x1.25-6H", "thread", "metric"),
        ("1/4-20 UNC-2B", "thread", "unified"),
        ("Ra 3.2", "surface_finish", "ra"),
        ("Rz 12.5", "surface_finish", "rz"),
        ("SECTION A-A", "view_label", "section"),
        ("DETAIL B 2:1", "view_label", "detail"),
        ("Equally Spaced", "note", "qualifier"),
        ("Customer Interface", "note", "qualifier"),
        ("(See Note 4)", "note", "reference"),
        ("Aluminum", "note", "material"),
    ],
)
def test_kind_and_subtype(text, kind, subtype):
    reading = parse_text(text)
    assert (reading.kind, reading.subtype) == (kind, subtype)


def test_frame_symbol_sets_the_gdt_subtype():
    reading = parse_text("⊥ 6.35", is_frame=True)
    assert (reading.kind, reading.subtype) == ("gdt", "perpendicularity")


def test_position_frame_symbol():
    assert parse_text("⌖ ⌀0.1 A B", is_frame=True).subtype == "position"


def test_bilateral_tolerance_is_parsed():
    reading = parse_text("+0.05 / -0.00")
    assert reading.parsed["tolerance_plus"] == 0.05
    assert reading.parsed["tolerance_minus"] == 0.0


def test_plus_minus_tolerance_is_parsed_symmetrically():
    reading = parse_text("28.750±0.025")
    assert reading.parsed["value"] == 28.75
    assert reading.parsed["tolerance_plus"] == 0.025
    assert reading.parsed["tolerance_minus"] == 0.025


def test_quantity_and_value_for_a_hole_callout():
    reading = parse_text("2X ⌀6 Slip Fit")
    assert reading.parsed["quantity"] == 2
    assert reading.parsed["value"] == 6
    assert reading.parsed["is_diameter"] is True


def test_thread_designation_is_not_read_as_the_value():
    reading = parse_text("4X Tap M6X1.0 ▽ 7.6")
    assert reading.parsed["thread"] == "M6X1.0"
    assert reading.parsed["value"] == 7.6


def test_fit_code_is_kept_for_a_diameter():
    reading = parse_text("⌀61 H7")
    assert reading.parsed["fit_code"] == "H7"
    assert reading.parsed["value"] == 61


def test_degree_sign_reads_cleanly_with_no_warning():
    reading = parse_text("120°")
    assert reading.kind == "dimension" and reading.subtype == "angular"
    assert reading.parsed["value"] == 120
    assert reading.warnings == []


def test_misread_degree_as_n_is_flagged():
    reading = parse_text("120n")
    assert reading.parsed["value"] == 120
    assert any("misread" in w for w in reading.warnings)


def test_a_clean_dimension_has_no_warnings():
    assert parse_text("⌀12.5 ±0.1").warnings == []


def test_a_dimension_with_no_number_is_flagged():
    reading = parse_text("⌀ ±")
    assert reading.kind == "dimension"
    assert any("No number" in w for w in reading.warnings)


def test_bolt_circle_implies_a_diameter():
    assert parse_text("B.C. 63").parsed["is_diameter"] is True
