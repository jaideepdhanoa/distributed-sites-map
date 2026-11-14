"""R-099 service-area classes for the workbook sync.

Four current classes replace the old in/out test. Inside, Near 0-5, and
Near 5-10 pass the location gate. Outside means more than 10.0 miles from
the operative polygon and is a location knock-out.

Legacy workbook values keep working. In and Yes are Inside. No and Out are
Outside. Unknown stays out.

Edge is not folded into Inside or a Near band. Those rows were not measured
again under R-099, so the class stays edge_legacy, "edge (not re-measured)",
and it still passes the gate.

The workbook score and the Location points cell are copied through. They are
not recomputed from this class. On the current 100-point scale, location is
40 points: Inside 40, Near 0-5 20, Near 5-10 10. That scale is recorded here
so a later sync can see the rule. This module does not apply it.
"""

from __future__ import annotations

import re

SERVICE_AREA_CLASSES = (
    "inside",
    "near_0_5",
    "near_5_10",
    "outside",
    "edge_legacy",
    "unknown",
)
PASSING_CLASSES = ("inside", "near_0_5", "near_5_10", "edge_legacy")
EXCLUDED_CLASSES = ("outside", "unknown")
# Documented point values. Not used to rewrite Score (of 100) or Location points.
LOCATION_POINTS = {"inside": 40, "near_0_5": 20, "near_5_10": 10}
EDGE_LABEL = "edge (not re-measured)"

CLASS_HEADERS = ("Inside the service area", "Service area")
DISTANCE_HEADER = "Distance to service area (mi)"
POLYGON_HEADER = "Service area polygon"
NOTE_HEADERS = (
    "Notes and next step",
    "What we know",
    "Land notes",
    "Land evidence",
    "Deal notes",
    "Basis",
    "Next step",
)

POLYGONS = {
    "phx_2026_v5": "phx_2026_v5",
    "vegas_100": "vegas_100",
    "mia extended odd": "MIA Extended ODD",
}

_ALIASES = {
    "inside": "inside",
    "in": "inside",
    "yes": "inside",
    "true": "inside",
    "near 0-5": "near_0_5",
    "near 0 to 5": "near_0_5",
    "near 5-10": "near_5_10",
    "near 5 to 10": "near_5_10",
    "outside": "outside",
    "out": "outside",
    "no": "outside",
    "false": "outside",
    "edge": "edge_legacy",
    "unknown": "unknown",
}

_SHEET_ERROR = re.compile(r"(?i)#(?:REF|N/A|VALUE|DIV/0|NAME|NULL|NUM|ERROR)!?")
_MILES = re.compile(r"(?i)^(\d+(?:\.\d+)?)\s*(?:mi(?:les)?)?$")
_PROVENANCE = re.compile(
    r"(?i)(\d+(?:\.\d+)?)\s*mi(?:les)?\s+to\s+(phx_2026_v5|vegas_100|mia\s+extended\s+odd)\b"
)
_POLYGON_NAME = re.compile(r"(?i)\b(phx_2026_v5|vegas_100|mia\s+extended\s+odd)\b")

SERVICE_AREA_NOTE = (
    "Service area comes from the Universe tab. Inside, Near 0-5, and Near 5-10 pass. "
    "Outside, more than 10.0 miles from the polygon, is a knock-out. "
    "Legacy In and Yes count as Inside. Legacy No and Out count as Outside. "
    f"Legacy Edge stays its own class, {EDGE_LABEL}, and passes, because those rows were not measured again under the four-class rule. "
    "Unknown stays out. The step is split by class so Near is not counted as Inside. "
    "Las Vegas rings 200 and 300 stay on the expansion horizon when they do not pass."
)

CITIES = ("LAS", "PHX", "MIA")


def passes_service_area(class_id: str) -> bool:
    return class_id in PASSING_CLASSES


def _normalize(value: str) -> str:
    text = value.replace("–", "-").replace("—", "-").replace("−", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


def _polygon_key(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def classify_service_area(value) -> tuple[str, bool]:
    """Return the enum and whether the cell was a known class.

    A blank cell and a sheet error such as #N/A are missing. They become
    unknown and are not flagged. Any other unrecognized text becomes unknown
    and is flagged by the caller.
    """
    if isinstance(value, bool):
        return ("inside" if value else "outside"), True
    if value is None:
        return "unknown", True
    text = str(value).strip()
    if not text or _SHEET_ERROR.search(text):
        return "unknown", True
    found = _ALIASES.get(_normalize(text))
    if found:
        return found, True
    return "unknown", False


def _cell(row: dict, header: str):
    if header in row:
        return row.get(header), True
    folded = header.casefold()
    for key, value in row.items():
        if str(key).strip().casefold() == folded:
            return value, True
    return None, False


def _class_cell(row: dict):
    found = None
    for header in CLASS_HEADERS:
        value, present = _cell(row, header)
        if not present:
            continue
        if value is not None and str(value).strip() and not _SHEET_ERROR.search(str(value)):
            return value
        if found is None:
            found = value
    return found


def _miles(value):
    """One decimal mile. Zero is a real distance. Sheet errors are missing."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number != number or number < 0:
            return None
        return round(number, 1)
    text = str(value).strip()
    if not text or _SHEET_ERROR.search(text):
        return None
    match = _MILES.fullmatch(text)
    if not match:
        return None
    return round(float(match.group(1)), 1)


def _polygon(value) -> str:
    if value is None or isinstance(value, bool):
        return ""
    text = str(value).strip()
    if not text or _SHEET_ERROR.search(text):
        return ""
    return POLYGONS.get(_polygon_key(text), "")


def _notes_text(row: dict) -> str:
    parts = []
    for header in NOTE_HEADERS:
        value, present = _cell(row, header)
        if present and value is not None:
            parts.append(str(value))
    return "\n".join(parts)


def _from_notes(text: str) -> tuple[float | None, str]:
    """Last provenance mention wins. A depot distance is not a service-area distance."""
    matches = list(_PROVENANCE.finditer(text or ""))
    if matches:
        last = matches[-1]
        return round(float(last.group(1)), 1), POLYGONS[_polygon_key(last.group(2))]
    names = list(_POLYGON_NAME.finditer(text or ""))
    if names:
        return None, POLYGONS[_polygon_key(names[-1].group(1))]
    return None, ""


def service_area_fields(row: dict, *, where: str = "") -> tuple[dict, str | None]:
    """Class, distance, polygon, and the gate boolean for one workbook row.

    Distance and polygon columns win when the header is present and the cell
    parses. A missing header, a blank cell, or #N/A falls back to the row
    notes. A value that cannot be parsed stays blank. An unrecognized class
    becomes unknown, does not pass, and returns a warning instead of raising.
    """
    raw = _class_cell(row)
    class_id, recognized = classify_service_area(raw)
    warning = None
    if not recognized:
        place = f"{where} " if where else ""
        warning = f"{place}service area {str(raw).strip()!r} is not a known class"

    distance_cell, has_distance = _cell(row, DISTANCE_HEADER)
    polygon_cell, has_polygon = _cell(row, POLYGON_HEADER)
    distance = _miles(distance_cell) if has_distance else None
    polygon = _polygon(polygon_cell) if has_polygon else ""
    if distance is None or not polygon:
        noted_distance, noted_polygon = _from_notes(_notes_text(row))
        if distance is None:
            distance = noted_distance
        if not polygon:
            polygon = noted_polygon
    return {
        "service_area_class": class_id,
        "service_area_distance_mi": distance,
        "service_area_polygon": polygon,
        "in_area": passes_service_area(class_id),
    }, warning


def _by_city(rows: list[dict]) -> dict:
    return {city: sum(1 for row in rows if row.get("city") == city) for city in CITIES}


def _split(rows: list[dict], keys: tuple[str, ...]) -> dict:
    grouped: dict[str, list[dict]] = {key: [] for key in keys}
    for row in rows:
        key = row.get("service_area_class") or "unknown"
        grouped.setdefault(key, [])
        grouped[key].append(row)
    ordered = list(keys) + [key for key in grouped if key not in keys]
    return {
        key: {"total": len(grouped.get(key) or []), "by_city": _by_city(grouped.get(key) or [])}
        for key in ordered
    }


def service_area_breakdown(sites: list[dict]) -> dict:
    """Funnel split for counted universe sites. The step total is the gate."""
    countable = [site for site in sites if site.get("counts_as_site") and site.get("origin") == "universe"]
    passing = [site for site in countable if site.get("in_area")]
    excluded = [site for site in countable if not site.get("in_area")]
    return {
        "name": "Service area",
        "total": len(passing),
        "by_city": _by_city(passing),
        "by_service_area": _split(passing, PASSING_CLASSES),
        "service_area_excluded": _split(excluded, EXCLUDED_CLASSES),
    }


def service_area_record_problems(label: str, props: dict) -> list[str]:
    """Stored classes have to be the enum. A missing field is an older build."""
    if "service_area_class" not in props:
        return []
    class_id = props.get("service_area_class")
    if class_id not in SERVICE_AREA_CLASSES:
        return [f"{label} service area class {class_id!r} is not a known class"]
    if bool(props.get("in_area")) != passes_service_area(str(class_id)):
        return [f"{label} in_area does not match service area class {class_id}"]
    return []
