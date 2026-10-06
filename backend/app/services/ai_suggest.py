"""
Calls Google's Gemini vision model to suggest regions on a drawing sheet —
the same task the original Claude artifact prototype did with its built-in
"sample" capability (a feature that only exists inside an artifact), now
done with a real API call so it works in the real application.

How it works: the frontend renders whatever's on screen (the traced sheet —
an image, or a PDF/DXF page already rendered to a canvas) to a PNG and
sends it here. That PNG, plus a prompt describing exactly what to look for
and what shape to answer in, goes to Gemini. Gemini's reply is parsed as
JSON and turned into the same kind of Region rows a person creates by hand,
tagged `source="ai"` so they're visually distinguishable in the tracer and
still require a human review pass.
"""

import json
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

REGION_TYPES = [
    "view",
    "section view",
    "detail view",
    "title block",
    "parts list",
    "dimension block",
    "notes",
    "other",
]

PROMPT = (
    "You are labeling one sheet of a mechanical/engineering drawing for a computer-vision "
    "training dataset. Look at the attached image and find the distinct regions on the sheet: "
    "individual views (top/front/side/isometric), section views, detail views, the title block, "
    "parts list or BOM tables, dimension or notes blocks. "
    "Reply with ONLY a JSON array, at most 12 items, of objects shaped exactly like "
    '{"type": "view|section view|detail view|title block|parts list|dimension block|notes|other", '
    '"caption": "short label or empty string", "box": [xMin, yMin, xMax, yMax]} '
    "where box values are fractions of the image width and height, from 0 to 1, with (0,0) at "
    "the top-left corner. Only include regions whose boundary you can actually see. If you "
    "cannot identify any, reply with []."
)


class AiSuggestUnavailable(Exception):
    """Raised when Gemini isn't configured, or the request to it fails for
    any reason (network, bad API key, the model refused, an unparseable
    reply, ...). The route layer turns this into a 503 with the message
    here, rather than a raw 500 — this is an expected, recoverable
    condition ("AI suggestions aren't available right now"), not a bug."""


def suggest_regions(image_bytes: bytes, width: int, height: int) -> list[dict]:
    """Returns a list of region dicts ready to hand to app.services.regions.add_region
    (type/caption/notes/source/points), or raises AiSuggestUnavailable."""

    if not settings.GEMINI_API_KEY:
        raise AiSuggestUnavailable(
            "AI region suggestions aren't configured — add GEMINI_API_KEY to the backend's .env to enable this."
        )

    # Imported here rather than at module load time: importing this only
    # when a suggestion is actually requested means the rest of the app
    # works fine even if this package were ever missing or broken.
    import google.generativeai as genai

    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(settings.GEMINI_MODEL)

    try:
        response = model.generate_content(
            [PROMPT, {"mime_type": "image/png", "data": image_bytes}],
            generation_config={"response_mime_type": "application/json"},
        )
        raw = response.text
    except Exception as exc:  # network error, bad key, safety block, quota, etc.
        logger.warning("Gemini request failed: %s", exc)
        raise AiSuggestUnavailable(f"The request to Gemini failed: {exc}") from exc

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise AiSuggestUnavailable("Gemini's reply wasn't valid JSON — couldn't parse any regions from it.") from exc

    if not isinstance(data, list):
        raise AiSuggestUnavailable("Gemini's reply wasn't a JSON array — couldn't parse any regions from it.")

    regions: list[dict] = []
    for item in data[:12]:
        region = _parse_one(item, width, height)
        if region is not None:
            regions.append(region)
    return regions


def _parse_one(item: object, width: int, height: int) -> dict | None:
    if not isinstance(item, dict):
        return None
    box = item.get("box")
    if not isinstance(box, list) or len(box) != 4:
        return None
    try:
        x0, y0, x1, y1 = (_clamp01(float(v)) for v in box)
    except (TypeError, ValueError):
        return None

    x_min, x_max = sorted((x0, x1))
    y_min, y_max = sorted((y0, y1))
    if (x_max - x_min) < 0.01 or (y_max - y_min) < 0.01:
        return None  # too thin/tall a sliver to be a real region

    region_type = item.get("type")
    if region_type not in REGION_TYPES:
        region_type = "other"

    px0, py0 = round(x_min * width), round(y_min * height)
    px1, py1 = round(x_max * width), round(y_max * height)

    return {
        "type": region_type,
        "caption": str(item.get("caption") or ""),
        "notes": "",
        "source": "ai",
        "points": [[px0, py0], [px1, py0], [px1, py1], [px0, py1]],
    }


def _clamp01(n: float) -> float:
    return max(0.0, min(1.0, n))
