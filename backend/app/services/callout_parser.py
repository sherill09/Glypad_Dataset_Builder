"""
Reads a callout's text the way a drafter would: works out what kind of
callout it is (dimension, GD&T frame, hole, thread, note...), its subtype,
and the values inside it (nominal, tolerances, quantity). Also flags text
that looks like a misread symbol, instead of storing it silently.

The parsed values are *derived* from the text the person confirms. Nobody
types them separately, so there is only one place to correct a mistake.
"""

import re
from dataclasses import dataclass, field

from app.services.entity_taxonomy import validate_kind_subtype

# Symbol variants that show up in the wild for diameter and friends.
_DIAMETER_VARIANTS = ("Ø", "Φ", "∅", "ø", "⌀")
_GDT_SYMBOLS = {
    "⊥": "perpendicularity",
    "∥": "parallelism",
    "⌖": "position",
    "⏥": "flatness",
    "⏤": "straightness",
    "○": "circularity",
    "⌭": "cylindricity",
    "⌒": "profile_line",
    "⌓": "profile_surface",
    "◎": "concentricity",
    "≡": "symmetry",
    "↗": "circular_runout",
    "⌰": "total_runout",
    "∠": "angularity",
}

_QTY = re.compile(r"^(\d+)X\b")
# A metric thread needs its pitch: M6x1.0, M8 x 1.25-6H, M3-0.5. "M3" alone is just a size word.
_THREAD = re.compile(r"\bM\d+(?:\.\d+)?\s*[xX×-]\s*\d+(?:\.\d+)?(?:\s*-\s*\d+[A-Za-z]?)?")
_UNIFIED_THREAD = re.compile(r"\b\d+/\d+\s*-\s*\d+\s*(?:UNC|UNF)\w*|\b#?\d+\s*-\s*\d+\s*(?:UNC|UNF)\w*", re.I)
_PIPE_THREAD = re.compile(r"\b(?:NPT|BSP|G)\s*\d+/\d+", re.I)
_FIT = re.compile(r"\b[A-Za-z]{1,2}\d{1,2}\b")  # H7, g6, js5
_NUMBER = re.compile(r"[-+]?\d+(?:\.\d+)?")
_TOL_SYM = re.compile(r"±\s*(\d+(?:\.\d+)?)")
_TOL_BI = re.compile(r"\+\s*(\d+(?:\.\d+)?)\s*/?\s*-\s*(\d+(?:\.\d+)?)")
_RADIUS = re.compile(r"(?:^|\s)R\s*\d")
_CHAMFER = re.compile(r"(?i)chamfer|(?:^|\s)C\d|[xX×]\s*\d+(?:\.\d+)?\s*°")


@dataclass
class ParsedCallout:
    kind: str
    subtype: str | None
    text: str
    parsed: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def normalize(text: str) -> str:
    """Single-character forms of the diameter symbol, and whitespace tidy-up.
    The stored text keeps what's on the sheet; this is only for reading it."""
    out = text
    for v in _DIAMETER_VARIANTS:
        out = out.replace(v, "⌀")
    out = out.replace("×", "x")
    return re.sub(r"\s+", " ", out).strip()


def _first_value(text: str) -> float | None:
    # Skip quantity ("2X") and thread designations ("M6X1.0") before taking the nominal.
    scrubbed = _QTY.sub("", text)
    scrubbed = _THREAD.sub("", scrubbed)
    scrubbed = _FIT.sub("", scrubbed)
    m = _NUMBER.search(scrubbed)
    return float(m.group(0)) if m else None


# Words that can sit beside a dimension's number without making it a sentence.
_DIMENSION_WORDS = re.compile(
    r"(?i)\b(?:TYP|REF|MAX|MIN|THRU|TAP|SLIP|FIT|DEG|MM|IN|DIA|B\.C\.|CHAMFER|DOWEL|PIN|RADIUS|DEPTH)\b"
)


def _is_number_like(text: str) -> bool:
    """True when the text is a number with dimension decorations -- not a sentence
    that happens to contain a number (e.g. "3rd ANGLE PROJECTION")."""
    if _THREAD.search(text) or _UNIFIED_THREAD.search(text):
        return True
    rest = re.sub(r"B\.C\.", " ", text, flags=re.I)  # bolt circle
    rest = re.sub(r"(?<=\d)[a-z](?![A-Za-z])", " ", rest)  # a misread suffix like "120n" stays a number, flagged below
    rest = _DIMENSION_WORDS.sub(" ", rest)
    rest = re.sub(r"(?<![A-Za-z])[A-Za-z]{1,2}\d{1,2}\b", " ", rest)  # fit codes like H7
    rest = re.sub(r"\bx\b", " ", rest, flags=re.I)
    letters = re.sub(r"[^A-Za-z]", "", rest)
    return not letters


def parse_text(raw: str, is_frame: bool = False, region_type: str | None = None) -> ParsedCallout:
    text = normalize(raw)
    parsed: dict = {}
    warnings: list[str] = []

    qty = _QTY.match(text)
    if qty:
        parsed["quantity"] = int(qty.group(1))

    thread = _THREAD.search(text)
    if thread:
        parsed["thread"] = thread.group(0).replace(" ", "")

    fit = _FIT.search(text)
    if fit and not thread:
        parsed["fit_code"] = fit.group(0)

    value = _first_value(text)
    if value is not None:
        parsed["value"] = value
    tol_sym = _TOL_SYM.search(text)
    tol_bi = _TOL_BI.search(text)
    if tol_sym:
        parsed["tolerance_plus"] = float(tol_sym.group(1))
        parsed["tolerance_minus"] = float(tol_sym.group(1))
    elif tol_bi:
        parsed["tolerance_plus"] = float(tol_bi.group(1))
        parsed["tolerance_minus"] = float(tol_bi.group(2))
    if "REF" in text.upper():
        parsed["is_reference"] = True
    if text.startswith("[") or text.endswith("]"):
        parsed["is_basic"] = True

    kind, subtype = _infer_kind(text, is_frame, parsed, region_type)
    if kind == "gdt" and subtype is None:
        warnings.append("GD&T symbol isn't in the file's text. Pick the characteristic yourself.")
    if kind == "dimension" and not _is_number_like(text):
        kind, subtype = "note", "label"
    if kind == "dimension" and fit_code_without_diameter(text):
        warnings.append("Fit codes like H7 usually describe a diameter, but the ⌀ symbol isn't in the text. Confirm.")
    if "⌀" in text or subtype in {"diameter", "bolt_circle", "spherical_diameter"} or (
        kind == "hole" and subtype in {"slip_fit", "thru"}
    ):
        parsed["is_diameter"] = True
    if kind == "dimension":
        if value is None:
            warnings.append("No number found in this callout.")

    # A lowercase letter glued to a number is almost always a misread symbol
    # (e.g. the degree sign read as 'n': "120n"). Checked whatever the kind is.
    bad = re.search(r"\d([a-wyz])(?![A-Za-z])", text)
    if bad:
        warnings.append(f"'{bad.group(1)}' right after the number looks like a misread symbol. Check it against the sheet.")

    validate_kind_subtype(kind, subtype)
    return ParsedCallout(kind=kind, subtype=subtype, text=raw, parsed=parsed, warnings=warnings)


def fit_code_without_diameter(text: str) -> bool:
    return bool(re.search(r"(?<![A-Za-z])[HhgfjJk]\d{1,2}\b", text)) and "⌀" not in text and not _THREAD.search(text)


_TABLE_REGIONS = {"title block", "notes", "revision table", "parts list"}


def _infer_kind(text: str, is_frame: bool, parsed: dict, region_type: str | None = None) -> tuple[str, str | None]:
    # The title block and notes are read as what they are on the sheet: a number in
    # the title block is a drawing number, scale or revision, not a dimension.
    if region_type == "title block":
        if re.search(r"\d{4}-\d{2}-\d{4}", text):
            return "title_block", "drawing_number"
        if re.search(r"\b\d+\s*:\s*\d+\b", text):
            return "title_block", "scale"
        if re.search(r"(?i)\brev", text):
            return "title_block", "revision"
        return "title_block", None
    if region_type == "notes":
        return "note", "general"
    if is_frame and region_type not in _TABLE_REGIONS:
        for sym, sub in _GDT_SYMBOLS.items():
            if sym in text:
                return "gdt", sub
        return "gdt", None
    for sym, sub in _GDT_SYMBOLS.items():
        if sym in text:
            return "gdt", sub

    upper = text.upper()
    if "TAP" in upper and parsed.get("thread"):
        return "hole", "tapped"
    if "THRU" in upper and "SLIP" in upper:
        return "hole", "slip_fit"
    if "THRU" in upper:
        return "hole", "thru"
    if "SLIP FIT" in upper:
        return "hole", "slip_fit"
    if "COUNTERBORE" in upper or "CBORE" in upper:
        return "hole", "counterbore"
    if "COUNTERSINK" in upper or "CSK" in upper:
        return "hole", "countersink"
    if _UNIFIED_THREAD.search(text):
        return "thread", "unified"
    if parsed.get("thread"):
        return "thread", "metric"
    if _PIPE_THREAD.search(text):
        return "thread", "pipe"
    if re.search(r"\bRa\s*\d", text):
        return "surface_finish", "ra"
    if re.search(r"\bRz\s*\d", text):
        return "surface_finish", "rz"
    if "DATUM" in upper and re.search(r"\b[A-Z]\b", text):
        return "datum", "feature"
    if re.search(r"\b(?:SECTION|DETAIL)\b", upper):
        return "view_label", "section" if "SECTION" in upper else "detail"
    if "B.C." in upper or "BOLT CIRCLE" in upper:
        return "dimension", "bolt_circle"
    if re.search(r"\bSPHERICAL\b|\bSR\s*\d", upper):
        return "dimension", "spherical_diameter"
    if _RADIUS.search(text):
        return "dimension", "radius"
    if _CHAMFER.search(text):
        return "dimension", "chamfer"
    if "°" in text:
        return "dimension", "angular"
    if "⌀" in text or "DOWEL" in upper:
        return "dimension", "diameter"
    if "DEPTH" in upper or "▽" in text or "↧" in text:
        return "dimension", "depth"
    if re.search(r"(?i)\bsee note\b|\bnote\s*\d", text):
        return "note", "reference"
    if re.match(r"^\d+\.\s+\S", text):  # numbered list item, e.g. "1. Material: Aluminum"
        return "note", "general"
    if _NUMBER.search(text) and re.search(r"\d", text):
        return "dimension", "linear"
    if re.search(r"(?i)\b(?:TYP|equally spaced|customer interface|optional)\b", text):
        return "note", "qualifier"
    if re.search(r"(?i)\b(?:aluminum|steel|plastic|anodize|passivate|paint)\b", text):
        return "note", "material"
    return "note", "label"


def callout_for_extraction(raw: str, is_frame: bool, region_type: str | None = None) -> ParsedCallout:
    """What extraction stores for a new suggestion. Never raises: anything the
    parser can't read is kept as a plain note, so the person still sees it."""
    try:
        return parse_text(raw, is_frame=is_frame, region_type=region_type)
    except ValueError:
        return ParsedCallout(kind="note", subtype="label", text=raw, parsed={}, warnings=[])
