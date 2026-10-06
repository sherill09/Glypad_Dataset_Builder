"""
Tests for the region-merge logic (app/services/regions.py) and the point
validation on the region schemas. Like the other tests here, none of this
needs a database — merged_fields works on any objects with the right
attributes, so plain SimpleNamespace stand-ins are enough.

(Constraints that genuinely need a real Postgres — the new drawings/
annotation_versions/entities tables, the content_hash uniqueness, the
partial-unique "one current version per drawing" index, and the repointed
regions API endpoints end-to-end — were verified separately against a real
scratch database, the same way the rest of this project's DB-touching
features have been checked all along; this file stays dependency-free like
the rest of the suite.)

Run with: pytest   (from inside backend/, with the virtual environment active)
"""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.region import RegionCreate, RegionUpdate
from app.services.regions import bounding_box_points, merged_fields

VALID_POINTS = [[10.0, 10.0], [50.0, 10.0], [50.0, 40.0], [10.0, 40.0]]


def _region(points, type="view", caption=None, notes=None, status="not_started"):
    return SimpleNamespace(points=points, type=type, caption=caption, notes=notes, status=status)


BOX_A = [[10, 10], [50, 10], [50, 40], [10, 40]]
BOX_B = [[30, 20], [90, 20], [90, 80], [30, 80]]


# --- bounding_box_points ------------------------------------------------------


def test_bounding_box_covers_all_regions():
    assert bounding_box_points([_region(BOX_A), _region(BOX_B)]) == [[10, 10], [90, 10], [90, 80], [10, 80]]


def test_bounding_box_of_a_polygon():
    triangle = _region([[0, 0], [100, 20], [40, 60]])
    assert bounding_box_points([triangle]) == [[0, 0], [100, 0], [100, 60], [0, 60]]


# --- merged_fields ------------------------------------------------------------


def test_merge_takes_first_type_and_first_non_empty_caption():
    a = _region(BOX_A, type="section view", caption=None)
    b = _region(BOX_B, type="notes", caption="SECTION A-A")
    fields = merged_fields([a, b])
    assert fields["type"] == "section view"
    assert fields["caption"] == "SECTION A-A"


def test_merge_keeps_distinct_notes_once_each():
    a = _region(BOX_A, notes="front view")
    b = _region(BOX_B, notes="front view")
    c = _region(BOX_B, notes="with hidden lines")
    assert merged_fields([a, b, c])["notes"] == "front view\nwith hidden lines"


def test_merge_with_no_notes_or_caption_stays_empty():
    fields = merged_fields([_region(BOX_A), _region(BOX_B)])
    assert fields["notes"] is None
    assert fields["caption"] is None


def test_merge_truncates_caption_to_column_size():
    fields = merged_fields([_region(BOX_A, caption="x" * 400), _region(BOX_B)])
    assert len(fields["caption"]) == 255


def test_merge_takes_first_regions_status():
    a = _region(BOX_A, status="done")
    b = _region(BOX_B, status="not_started")
    assert merged_fields([a, b])["status"] == "done"


def test_merge_defaults_status_when_missing():
    # merged_fields tolerates objects without a `status` attribute at all
    # (e.g. a stand-in in some other caller) by falling back sensibly.
    bare = SimpleNamespace(points=BOX_A, type="view", caption=None, notes=None)
    assert merged_fields([bare, _region(BOX_B)])["status"] == "not_started"


# --- schema: status field ------------------------------------------------------


def test_region_create_defaults_status_to_not_started():
    assert RegionCreate(points=BOX_A).status == "not_started"


def test_region_create_accepts_a_valid_status():
    assert RegionCreate(points=BOX_A, status="in_progress").status == "in_progress"


def test_region_create_rejects_an_invalid_status():
    with pytest.raises(ValidationError):
        RegionCreate(points=BOX_A, status="done_done")


def test_region_update_accepts_a_valid_status():
    assert RegionUpdate(status="done").status == "done"


# --- point validation ---------------------------------------------------------


def test_update_accepts_a_valid_box():
    patch = RegionUpdate(points=BOX_A)
    assert patch.points == [[10, 10], [50, 10], [50, 40], [10, 40]]


def test_update_without_points_is_fine():
    assert RegionUpdate(caption="hi").points is None


@pytest.mark.parametrize(
    "points",
    [
        [[0, 0], [10, 10]],  # only two points
        [[0, 0], [10, 10], [5]],  # a point with one coordinate
        [[0, 0], [10, 10], [5, 5, 5]],  # a point with three
        [[0, 0], [10, 10], [float("inf"), 5]],  # not finite
    ],
)
def test_bad_points_are_rejected(points):
    with pytest.raises(ValidationError):
        RegionUpdate(points=points)
    with pytest.raises(ValidationError):
        RegionCreate(points=points)


# --- entities_status (PHASE2_IMPLEMENTATION_PLAN.md §4.1) ---
# Same validation shape as the existing `status` field, tracked separately
# for Layer 3 (entity annotation inside a region) instead of Layer 2 (the
# region box itself). The route-level behavior (the DB column's default,
# PATCH actually persisting it) needs a real Postgres to verify end to
# end, same as the rest of this file's own admitted limitation above —
# these tests cover the schema layer only.

def test_region_create_defaults_entities_status_to_not_started():
    region = RegionCreate(points=VALID_POINTS)
    assert region.entities_status == "not_started"


def test_region_create_accepts_an_explicit_entities_status():
    region = RegionCreate(points=VALID_POINTS, entities_status="done")
    assert region.entities_status == "done"


def test_region_create_rejects_an_invalid_entities_status():
    with pytest.raises(ValidationError):
        RegionCreate(points=VALID_POINTS, entities_status="finished")


def test_region_update_leaves_entities_status_unset_by_default():
    patch = RegionUpdate(caption="A new caption")
    # exclude_unset is what the route actually applies — confirm a patch
    # that doesn't mention entities_status doesn't silently reset it.
    assert "entities_status" not in patch.model_dump(exclude_unset=True)


def test_region_update_can_mark_entities_status_done():
    patch = RegionUpdate(entities_status="done")
    assert patch.model_dump(exclude_unset=True) == {"entities_status": "done"}
