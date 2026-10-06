"""
The entity vocabulary: a *kind* (what sort of callout a box is) and an
optional *subtype* (which specific kind of that callout). Subtypes can be
added here without changing the database or the API shape.

The frontend mirrors this in frontend/src/types/annotation.ts -- keep the two
in step. Old entities stored with the previous flat `category` are read back
through LEGACY_CATEGORY_MAP, so no data migration is needed.
"""

KINDS: dict[str, str] = {
    "dimension": "Dimension",
    "gdt": "GD&T frame",
    "datum": "Datum",
    "thread": "Thread",
    "hole": "Hole callout",
    "surface_finish": "Surface finish",
    "weld": "Weld",
    "fit": "Fit code",
    "symbol": "Symbol",
    "note": "Note / label",
    "title_block": "Title block field",
    "view_label": "View label",
    "other": "Other",
}

SUBTYPES: dict[str, dict[str, str]] = {
    "dimension": {
        "linear": "Linear",
        "diameter": "Diameter ⌀",
        "radius": "Radius R",
        "angular": "Angular °",
        "chamfer": "Chamfer",
        "depth": "Depth",
        "bolt_circle": "Bolt circle B.C.",
        "spherical_diameter": "Spherical ⌀",
    },
    "gdt": {
        "position": "Position",
        "flatness": "Flatness",
        "straightness": "Straightness",
        "circularity": "Circularity",
        "cylindricity": "Cylindricity",
        "perpendicularity": "Perpendicularity",
        "parallelism": "Parallelism",
        "angularity": "Angularity",
        "profile_line": "Profile of a line",
        "profile_surface": "Profile of a surface",
        "concentricity": "Concentricity",
        "symmetry": "Symmetry",
        "circular_runout": "Circular runout",
        "total_runout": "Total runout",
    },
    "datum": {
        "feature": "Datum feature",
        "target": "Datum target",
    },
    "thread": {
        "metric": "Metric (M)",
        "unified": "Unified (UNC/UNF)",
        "pipe": "Pipe (NPT/BSP)",
    },
    "hole": {
        "thru": "Thru",
        "tapped": "Tapped",
        "counterbore": "Counterbore",
        "countersink": "Countersink",
        "spot_face": "Spot face",
        "slip_fit": "Slip fit",
    },
    "surface_finish": {
        "ra": "Ra",
        "rz": "Rz",
        "symbol": "Finish symbol",
    },
    "weld": {
        "fillet": "Fillet",
        "groove": "Groove",
        "plug": "Plug",
        "spot": "Spot",
        "seam": "Seam",
    },
    "fit": {
        "hole": "Hole fit",
        "shaft": "Shaft fit",
    },
    "symbol": {
        "counterbore": "Counterbore ⌴",
        "countersink": "Countersink ⌵",
        "depth": "Depth ↧",
        "square": "Square □",
        "centerline": "Centerline",
        "break_line": "Break line",
        "arrow": "Arrow / leader",
        "other": "Other symbol",
    },
    "note": {
        "general": "General note",
        "reference": "Note reference",
        "qualifier": "Qualifier (TYP, Equally Spaced…)",
        "material": "Material / process",
        "label": "Feature label",
    },
    "title_block": {
        "drawing_number": "Drawing number",
        "title": "Title",
        "revision": "Revision",
        "scale": "Scale",
        "size": "Size",
        "sheet": "Sheet",
        "date": "Date",
        "drawn_by": "Drawn by",
        "checked_by": "Checked by",
        "material": "Material",
    },
    "view_label": {
        "view": "View",
        "section": "Section",
        "detail": "Detail",
    },
    "other": {},
}

# Old flat categories -> (kind, subtype). Used when reading entities saved
# before the kind/subtype split.
LEGACY_CATEGORY_MAP: dict[str, tuple[str, str | None]] = {
    "dimension": ("dimension", "linear"),
    "gdt_frame": ("gdt", None),
    "fit_code": ("fit", None),
    "surface_finish": ("surface_finish", None),
    "thread": ("thread", None),
    "weld_symbol": ("weld", None),
    "datum_symbol": ("datum", "feature"),
    "title_block_field": ("title_block", None),
    "other": ("other", None),
}


def validate_kind_subtype(kind: str, subtype: str | None) -> None:
    """Raises ValueError when the kind is unknown or the subtype doesn't belong to it."""
    if kind not in KINDS:
        raise ValueError(f"Unknown kind '{kind}'")
    if subtype is None:
        return
    if subtype not in SUBTYPES[kind]:
        raise ValueError(f"'{subtype}' isn't a subtype of {KINDS[kind]}")


def resolve_stored(e: dict) -> tuple[str, str | None]:
    """The (kind, subtype) of a stored entity, whether it was saved before or after the split."""
    if e.get("kind"):
        return e["kind"], e.get("subtype")
    return LEGACY_CATEGORY_MAP.get(e.get("category", "other"), ("other", None))
