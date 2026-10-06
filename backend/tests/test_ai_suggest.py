"""
Tests for app/services/ai_suggest.py's own logic — the parsing/clamping of
whatever Gemini replies with, and the "not configured" guard. None of this
needs a database or real network access to Gemini: the actual Gemini call
is mocked, so these run anywhere (including this sandbox, which has no real
GEMINI_API_KEY) and still catch real bugs in how a reply gets turned into
regions.

Run with: pytest   (from inside backend/, with the virtual environment active)
"""

from unittest.mock import MagicMock, patch

import pytest

from app.services.ai_suggest import AiSuggestUnavailable, _clamp01, _parse_one, suggest_regions


# --- _clamp01 ---------------------------------------------------------------


def test_clamp01_keeps_in_range_values():
    assert _clamp01(0.5) == 0.5


def test_clamp01_clamps_below_zero():
    assert _clamp01(-0.3) == 0.0


def test_clamp01_clamps_above_one():
    assert _clamp01(1.7) == 1.0


# --- _parse_one ---------------------------------------------------------------


def test_parse_one_normal_box():
    item = {"type": "title block", "caption": "Title", "box": [0.1, 0.2, 0.4, 0.5]}
    region = _parse_one(item, width=1000, height=800)
    assert region is not None
    assert region["type"] == "title block"
    assert region["caption"] == "Title"
    assert region["source"] == "ai"
    # box fractions * (width, height), rounded, as a closed 4-point rectangle
    assert region["points"] == [[100, 160], [400, 160], [400, 400], [100, 400]]


def test_parse_one_unknown_type_falls_back_to_other():
    item = {"type": "spaceship", "box": [0, 0, 0.5, 0.5]}
    region = _parse_one(item, width=100, height=100)
    assert region is not None
    assert region["type"] == "other"


def test_parse_one_missing_caption_becomes_empty_string():
    item = {"type": "view", "box": [0, 0, 0.5, 0.5]}
    region = _parse_one(item, width=100, height=100)
    assert region["caption"] == ""


def test_parse_one_handles_swapped_min_max():
    # A model could reply with a box where the "min" corner is actually the
    # larger number — this should still produce a normalized rectangle
    # rather than a region with negative width/height.
    item = {"type": "view", "box": [0.5, 0.5, 0.1, 0.1]}
    region = _parse_one(item, width=100, height=100)
    assert region is not None
    assert region["points"] == [[10, 10], [50, 10], [50, 50], [10, 50]]


def test_parse_one_clamps_out_of_range_fractions():
    item = {"type": "view", "box": [-0.5, -0.5, 1.5, 1.5]}
    region = _parse_one(item, width=100, height=100)
    assert region is not None
    assert region["points"] == [[0, 0], [100, 0], [100, 100], [0, 100]]


def test_parse_one_rejects_too_thin_sliver():
    item = {"type": "view", "box": [0.1, 0.1, 0.105, 0.9]}  # width fraction ~0.005
    assert _parse_one(item, width=1000, height=1000) is None


def test_parse_one_rejects_non_dict_item():
    assert _parse_one("not a dict", width=100, height=100) is None


def test_parse_one_rejects_missing_box():
    assert _parse_one({"type": "view"}, width=100, height=100) is None


def test_parse_one_rejects_wrong_length_box():
    assert _parse_one({"type": "view", "box": [0, 0, 1]}, width=100, height=100) is None


def test_parse_one_rejects_non_numeric_box_values():
    assert _parse_one({"type": "view", "box": [0, 0, "a", 1]}, width=100, height=100) is None


# --- suggest_regions (with the actual Gemini call mocked out) ---------------


def test_suggest_regions_raises_when_no_api_key():
    with patch("app.services.ai_suggest.settings") as mock_settings:
        mock_settings.GEMINI_API_KEY = ""
        with pytest.raises(AiSuggestUnavailable, match="configured"):
            suggest_regions(b"fake-png-bytes", width=100, height=100)


def test_suggest_regions_parses_a_well_formed_reply():
    fake_response = MagicMock()
    fake_response.text = (
        '[{"type": "view", "caption": "Front", "box": [0, 0, 0.5, 0.5]}, '
        '{"type": "title block", "caption": "", "box": [0.6, 0.8, 0.95, 0.95]}]'
    )
    fake_model = MagicMock()
    fake_model.generate_content.return_value = fake_response

    fake_genai_module = MagicMock()
    fake_genai_module.GenerativeModel.return_value = fake_model

    with patch("app.services.ai_suggest.settings") as mock_settings, patch.dict(
        "sys.modules", {"google.generativeai": fake_genai_module}
    ):
        mock_settings.GEMINI_API_KEY = "fake-key"
        mock_settings.GEMINI_MODEL = "gemini-2.0-flash"
        regions = suggest_regions(b"fake-png-bytes", width=200, height=200)

    assert len(regions) == 2
    assert regions[0]["type"] == "view"
    assert regions[1]["type"] == "title block"


def test_suggest_regions_raises_on_non_json_reply():
    fake_response = MagicMock()
    fake_response.text = "not json at all"
    fake_model = MagicMock()
    fake_model.generate_content.return_value = fake_response

    fake_genai_module = MagicMock()
    fake_genai_module.GenerativeModel.return_value = fake_model

    with patch("app.services.ai_suggest.settings") as mock_settings, patch.dict(
        "sys.modules", {"google.generativeai": fake_genai_module}
    ):
        mock_settings.GEMINI_API_KEY = "fake-key"
        mock_settings.GEMINI_MODEL = "gemini-2.0-flash"
        with pytest.raises(AiSuggestUnavailable, match="valid JSON"):
            suggest_regions(b"fake-png-bytes", width=200, height=200)


def test_suggest_regions_raises_when_the_api_call_itself_fails():
    fake_model = MagicMock()
    fake_model.generate_content.side_effect = RuntimeError("network exploded")

    fake_genai_module = MagicMock()
    fake_genai_module.GenerativeModel.return_value = fake_model

    with patch("app.services.ai_suggest.settings") as mock_settings, patch.dict(
        "sys.modules", {"google.generativeai": fake_genai_module}
    ):
        mock_settings.GEMINI_API_KEY = "fake-key"
        mock_settings.GEMINI_MODEL = "gemini-2.0-flash"
        with pytest.raises(AiSuggestUnavailable, match="request to Gemini failed"):
            suggest_regions(b"fake-png-bytes", width=200, height=200)


def test_suggest_regions_ignores_unparseable_items_in_an_otherwise_valid_list():
    fake_response = MagicMock()
    fake_response.text = '[{"type": "view", "box": [0, 0, 0.5, 0.5]}, {"no_box_here": true}, "garbage"]'
    fake_model = MagicMock()
    fake_model.generate_content.return_value = fake_response

    fake_genai_module = MagicMock()
    fake_genai_module.GenerativeModel.return_value = fake_model

    with patch("app.services.ai_suggest.settings") as mock_settings, patch.dict(
        "sys.modules", {"google.generativeai": fake_genai_module}
    ):
        mock_settings.GEMINI_API_KEY = "fake-key"
        mock_settings.GEMINI_MODEL = "gemini-2.0-flash"
        regions = suggest_regions(b"fake-png-bytes", width=200, height=200)

    assert len(regions) == 1
