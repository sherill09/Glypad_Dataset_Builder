"""
Region geometry and merge helpers supporting MongoDB documents.
"""

from typing import Any


def bounding_box_points(regions: list[Any]) -> list[list[float]]:
    """The smallest axis-aligned box containing every point of every region."""
    xs = [p[0] for r in regions for p in (r["points"] if isinstance(r, dict) else r.points)]
    ys = [p[1] for r in regions for p in (r["points"] if isinstance(r, dict) else r.points)]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def merged_fields(regions: list[Any]) -> dict[str, Any]:
    """What the single region that replaces `regions` should look like."""
    first = regions[0]
    first_type = first["type"] if isinstance(first, dict) else first.type
    first_status = (
        first.get("status", "not_started")
        if isinstance(first, dict)
        else getattr(first, "status", "not_started")
    )
    first_entities_status = (
        first.get("entities_status", "not_started")
        if isinstance(first, dict)
        else getattr(first, "entities_status", "not_started")
    )

    captions = [(r["caption"] if isinstance(r, dict) else r.caption) for r in regions]
    caption = next((c for c in captions if c), None)

    notes: list[str] = []
    for r in regions:
        r_notes = r.get("notes") if isinstance(r, dict) else r.notes
        if r_notes and r_notes not in notes:
            notes.append(r_notes)

    return {
        "type": first_type,
        "caption": caption[:255] if caption else caption,
        "notes": "\n".join(notes) if notes else None,
        "status": first_status,
        "entities_status": first_entities_status,
        "points": bounding_box_points(regions),
    }
