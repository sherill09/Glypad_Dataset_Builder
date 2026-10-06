"""
Tests for the Layer 1 metadata update schema (§5 step 3). Pure schema
validation — no database needed, matching the rest of this suite.

(The route's "un-approve on edit" behavior and the drawings.source_link
PATCH were verified separately against a real scratch database, same as
earlier slices.)

Run with: pytest   (from inside backend/, with the virtual environment active)
"""

import pytest
from pydantic import ValidationError

from app.schemas.annotation_version import AnnotationVersionUpdate
from app.schemas.drawing import DrawingUpdate


def test_accepts_iso_standard():
    assert AnnotationVersionUpdate(standard="iso").standard == "iso"


def test_accepts_asme_standard():
    assert AnnotationVersionUpdate(standard="asme").standard == "asme"


def test_standard_can_be_cleared_to_null():
    assert AnnotationVersionUpdate(standard=None).standard is None


def test_rejects_an_invalid_standard():
    with pytest.raises(ValidationError):
        AnnotationVersionUpdate(standard="din")


def test_units_discipline_scale_are_free_text():
    patch = AnnotationVersionUpdate(units="mm", discipline="mechanical", scale="1:50")
    assert patch.units == "mm"
    assert patch.discipline == "mechanical"
    assert patch.scale == "1:50"


def test_all_fields_optional_for_a_partial_patch():
    patch = AnnotationVersionUpdate(units="in")
    # exclude_unset is what the route actually applies — confirm the
    # unset fields really are absent, not defaulted to None and sent anyway.
    assert patch.model_dump(exclude_unset=True) == {"units": "in"}


def test_drawing_update_accepts_a_source_link():
    assert DrawingUpdate(source_link="https://drive.google.com/x").source_link == "https://drive.google.com/x"


def test_drawing_update_can_clear_the_source_link():
    assert DrawingUpdate(source_link=None).source_link is None


# --- general_tolerance_grade (ISO 2768 coarse/medium/fine/very-fine grade,
# Layer 1 field confirmed in PHASE2_IMPLEMENTATION_PLAN.md §4.2) ---
# Same disclosed limitation as above: DB-level persistence (column default,
# PATCH round-trip) was not re-verified here, no Postgres available in this
# environment — only the pure Pydantic validation is covered.

def test_accepts_each_valid_general_tolerance_grade():
    for grade in ["f", "m", "c", "v"]:
        assert AnnotationVersionUpdate(general_tolerance_grade=grade).general_tolerance_grade == grade


def test_general_tolerance_grade_can_be_cleared_to_null():
    assert AnnotationVersionUpdate(general_tolerance_grade=None).general_tolerance_grade is None


def test_rejects_an_invalid_general_tolerance_grade():
    with pytest.raises(ValidationError):
        AnnotationVersionUpdate(general_tolerance_grade="x")


def test_general_tolerance_grade_unset_by_default_on_partial_patch():
    patch = AnnotationVersionUpdate(units="in")
    assert "general_tolerance_grade" not in patch.model_dump(exclude_unset=True)
