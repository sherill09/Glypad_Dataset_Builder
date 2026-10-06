"""
Tests for the entity schema -- the kind/subtype vocabulary and the shared bbox
point validation. No database needed.

(Region-ownership checks, the un-approve-on-edit rule, and the entities CRUD
endpoints themselves are exercised against a real database by test_mongo_flow.)

Run with: pytest   (from inside backend/, with the virtual environment active)
"""

import pytest
from pydantic import ValidationError

from app.schemas.entity import EntityCreate, EntityUpdate
from app.services.entity_taxonomy import KINDS, SUBTYPES, LEGACY_CATEGORY_MAP, resolve_stored

BOX = [[10, 10], [50, 10], [50, 40], [10, 40]]


def test_every_kind_is_accepted_with_no_subtype():
    for kind in KINDS:
        assert EntityCreate(kind=kind, bbox=BOX).kind == kind


def test_every_subtype_is_accepted_for_its_own_kind():
    for kind, subtypes in SUBTYPES.items():
        for sub in subtypes:
            assert EntityCreate(kind=kind, subtype=sub, bbox=BOX).subtype == sub


def test_rejects_an_unknown_kind():
    with pytest.raises(ValidationError):
        EntityCreate(kind="balloon", bbox=BOX)


def test_rejects_a_subtype_from_another_kind():
    with pytest.raises(ValidationError):
        EntityCreate(kind="dimension", subtype="position", bbox=BOX)  # "position" is a GD&T subtype


def test_update_rejects_an_unknown_kind_too():
    with pytest.raises(ValidationError):
        EntityUpdate(kind="not_a_real_kind")


def test_default_kind_is_other_and_status_is_confirmed():
    entity = EntityCreate(bbox=BOX)
    assert entity.kind == "other"
    assert entity.status == "confirmed"


def test_rejects_bbox_with_fewer_than_three_points():
    with pytest.raises(ValidationError):
        EntityCreate(kind="other", bbox=[[0, 0], [1, 1]])


def test_legacy_category_entities_read_back_as_kind_and_subtype():
    assert resolve_stored({"category": "dimension"}) == ("dimension", "linear")
    assert resolve_stored({"category": "gdt_frame"}) == ("gdt", None)
    assert resolve_stored({"category": "weld_symbol"}) == ("weld", None)
    assert resolve_stored({"category": "something_old"}) == ("other", None)
    assert set(LEGACY_CATEGORY_MAP.values()) <= {(k, s) for k, subs in SUBTYPES.items() for s in list(subs) + [None]}


def test_new_entities_read_back_as_stored():
    assert resolve_stored({"kind": "hole", "subtype": "tapped", "category": "dimension"}) == ("hole", "tapped")
