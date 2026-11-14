"""Known workbook values for the sync.

Market, stage, service area, and segment group are checked while the workbook
is read. An unknown cell is recorded and the build continues. The data check
fails when any unknown value was recorded, or when a generated file already
contains one, so the sync pull request cannot be merged by accident.

Service-area classes follow scripts/service_area.py when that module is
present (pull request #81). Until then the known classes are the legacy
labels plus Inside, Near 0-5, Near 5-10, and Outside. A blank cell and a
sheet error such as #N/A are missing. They are not unknown. Any other
unrecognized text is reported. This module does not decide whether the row
passes the location gate.

SNA is a known market outside the map. LAS, PHX, and MIA are the map markets.
Phoenix, PHOENIX, and any other spelling are unknown. They are not renamed.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "generated"

MAP_MARKETS = {"PHX", "LAS", "MIA"}
# One existing deal sits outside the three map markets. It is listed on the
# sync pull request and does not fail the universe-gap check.
OUTSIDE_MARKETS = {"SNA"}
KNOWN_MARKETS = MAP_MARKETS | OUTSIDE_MARKETS

# Stage 3's workbook wording is shortened to "3 Site checks" before it is stored.
# Any stage number 3 is that stage. The other names have to match.
KNOWN_STAGES = {
    "1 desk screen",
    "2 financial screen",
    "3 site checks",
    "4 offer and close",
    "dropped",
    "financial screen",
    "off-market target",
    "off market (no lead)",
}

KNOWN_SEGMENT_GROUPS = {
    "car wash",
    "auto service",
    "auto repair",
    "general auto repair",
    "tire and lube",
    "tire and light auto service",
    "gas station",
    "c-store",
    "convenience store",
    "land",
    "land only",
    "vacant",
    "entitled",
    "yard or lot",
    "storage",
    "other",
}

_SERVICE_AREA = {
    "inside",
    "in",
    "yes",
    "true",
    "near 0-5",
    "near 0 to 5",
    "near 5-10",
    "near 5 to 10",
    "outside",
    "out",
    "no",
    "false",
    "edge",
    "unknown",
}

_SHEET_ERROR = re.compile(r"(?i)#(?:REF|N/A|VALUE|DIV/0|NAME|NULL|NUM|ERROR)!?")
_STAGE_NUMBER = re.compile(r"^\s*(\d+)\b")
_ID_KEYS = ("Site ID", "site_id", "Lead ID", "Universe ID")


def _normalize(value: str) -> str:
    text = value.replace("–", "-").replace("—", "-").replace("−", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


def known_market(value) -> bool:
    return str(value or "").strip() in KNOWN_MARKETS


def known_stage(value) -> bool:
    text = _normalize(str(value or ""))
    if not text:
        return False
    if text in KNOWN_STAGES:
        return True
    if _STAGE_NUMBER.match(text) and _STAGE_NUMBER.match(text).group(1) == "3":
        return True
    return False


def known_segment_group(value) -> bool:
    text = _normalize(str(value or ""))
    if not text:
        return True
    return text in KNOWN_SEGMENT_GROUPS


def _legacy_service_area_known(value) -> bool:
    if isinstance(value, bool) or value is None:
        return True
    text = str(value).strip()
    if not text or _SHEET_ERROR.search(text):
        return True
    return _normalize(text) in _SERVICE_AREA


def service_area_known(value) -> bool:
    """True when the cell is blank, a sheet error, or a known class.

    An unrecognized class is false. The caller records it and does not raise.
    """
    try:
        from scripts.service_area import classify_service_area
    except ImportError:
        return _legacy_service_area_known(value)
    _class_id, recognized = classify_service_area(value)
    return bool(recognized)


def _cell(row: dict, *names: str):
    wanted = {name.casefold() for name in names}
    for key, value in row.items():
        if str(key).strip().casefold() in wanted:
            return value, True
    return None, False


def _site_id(row: dict) -> str:
    for key in _ID_KEYS:
        value, present = _cell(row, key)
        if not present or value is None:
            continue
        text = str(value).strip()
        if text and text.casefold() not in {"none", "n/a", "#n/a"}:
            return text
    return ""


def _row_number(row: dict, index: int) -> int:
    number = row.get("_excel_row")
    if isinstance(number, int):
        return number
    return index + 2


def _add(found: list[dict], sheet: str, row: dict, index: int, field: str, value) -> None:
    found.append(
        {
            "sheet": sheet,
            "row": _row_number(row, index),
            "site_id": _site_id(row),
            "field": field,
            "value": str(value).strip(),
        }
    )


def _scan_market(found: list[dict], sheet: str, row: dict, index: int, *, blank_fails: bool) -> None:
    value, present = _cell(row, "Market")
    if not present:
        return
    text = str(value or "").strip()
    if not text:
        if blank_fails:
            _add(found, sheet, row, index, "market", "")
        return
    if not known_market(text):
        _add(found, sheet, row, index, "market", text)


def _scan_service_area(found: list[dict], sheet: str, row: dict, index: int) -> None:
    value, present = _cell(row, "Service area", "Inside the service area")
    if not present or service_area_known(value):
        return
    _add(found, sheet, row, index, "service_area", value)


def _scan_segment_group(found: list[dict], sheet: str, row: dict, index: int) -> None:
    value, present = _cell(row, "Segment group")
    if not present or known_segment_group(value):
        return
    _add(found, sheet, row, index, "segment_group", value)


def _scan_stage(found: list[dict], sheet: str, row: dict, index: int) -> None:
    value, present = _cell(row, "Stage")
    if not present:
        return
    text = str(value or "").strip()
    if not text or not known_stage(text):
        _add(found, sheet, row, index, "stage", text)


def collect_vocabulary(
    universe_rows: list[dict] | None = None,
    pipeline_rows: list[dict] | None = None,
    land_rows: list[dict] | None = None,
) -> dict:
    """Unknown cells from the three tabs. Never raises."""
    found: list[dict] = []
    for index, row in enumerate(universe_rows or []):
        counted = str(row.get("Counted in funnel") or "").strip().lower() == "yes"
        _scan_market(found, "Universe", row, index, blank_fails=counted)
        _scan_service_area(found, "Universe", row, index)
        _scan_segment_group(found, "Universe", row, index)
    for sheet, rows in (("Pipeline", pipeline_rows), ("Land Sites", land_rows)):
        for index, row in enumerate(rows or []):
            _scan_market(found, sheet, row, index, blank_fails=True)
            _scan_stage(found, sheet, row, index)
            _scan_service_area(found, sheet, row, index)
            _scan_segment_group(found, sheet, row, index)
    return {"violations": found}


def format_violation(item: dict) -> str:
    site = str(item.get("site_id") or "").strip() or "(no site id)"
    field = str(item.get("field") or "value").replace("_", " ")
    value = item.get("value")
    shown = "(blank)" if value is None or str(value).strip() == "" else repr(str(value).strip())
    return f"{item.get('sheet')} row {item.get('row')}, {site}: {field} {shown}"


def vocabulary_lines(report: dict | None) -> list[str]:
    """Pull-request lines. A clean export says zero."""
    items = []
    if isinstance(report, dict):
        block = report.get("vocabulary") or {}
        if isinstance(block, dict):
            raw = block.get("violations") or []
            if isinstance(raw, list):
                items = [item for item in raw if isinstance(item, dict)]
    lines = [f"Vocabulary check: {len(items)} unknown value(s)."]
    if not items:
        lines.append("Market, stage, service area, and segment group are known values.")
        return lines
    lines.append("The build did not stop. CI fails until these cells are corrected.")
    lines.extend(f"- {format_violation(item)}" for item in items[:80])
    if len(items) > 80:
        lines.append(f"- {len(items) - 80} more are in build_report.json.")
    return lines


def _feature_props(features: list[dict]) -> list[dict]:
    rows = []
    for feature in features:
        if isinstance(feature, dict) and "properties" in feature:
            props = feature.get("properties") or {}
        else:
            props = feature
        if isinstance(props, dict):
            rows.append(props)
    return rows


def shipped_problems(deal_features: list[dict], site_features: list[dict], report: dict | None = None) -> list[str]:
    """Unknown values already written into the generated files or the build report."""
    problems = []
    seen: set[tuple[str, str, str]] = set()
    block = (report or {}).get("vocabulary") if isinstance(report, dict) else None
    recorded = block.get("violations") if isinstance(block, dict) else None
    for item in recorded or []:
        if not isinstance(item, dict):
            continue
        key = (str(item.get("field") or ""), str(item.get("site_id") or ""), str(item.get("value") or ""))
        seen.add(key)
        problems.append(format_violation(item))
    for props in _feature_props(deal_features):
        site_id = str(props.get("deal_id") or "")
        city = str(props.get("city") or "").strip()
        if city and not known_market(city):
            key = ("market", site_id, city)
            if key not in seen:
                seen.add(key)
                problems.append(f"deal {site_id or '(no site id)'}: market {city!r} is not PHX, LAS, or MIA")
        stage = str(props.get("stage") or "").strip()
        if stage and not known_stage(stage):
            key = ("stage", site_id, stage)
            if key not in seen:
                seen.add(key)
                problems.append(f"deal {site_id or '(no site id)'}: stage {stage!r} is not a known stage")
    for props in _feature_props(site_features):
        site_id = str(props.get("site_id") or "")
        city = str(props.get("city") or "").strip()
        if city and not known_market(city):
            key = ("market", site_id, city)
            if key not in seen:
                seen.add(key)
                problems.append(f"site {site_id or '(no site id)'}: market {city!r} is not PHX, LAS, or MIA")
        stage = str(props.get("pipeline_stage") or "").strip()
        if stage and not known_stage(stage):
            key = ("stage", site_id, stage)
            if key not in seen:
                seen.add(key)
                problems.append(f"site {site_id or '(no site id)'}: stage {stage!r} is not a known stage")
    return problems


def check_generated(root: Path | None = None) -> list[str]:
    base = root or OUT
    report_path = base / "build_report.json"
    deals_path = base / "deals.geojson"
    sites_path = base / "sites.geojson"
    problems = []
    if not deals_path.exists() or not sites_path.exists():
        return ["vocabulary check is missing deals.geojson or sites.geojson"]
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    deals = json.loads(deals_path.read_text()).get("features") or []
    sites = json.loads(sites_path.read_text()).get("features") or []
    problems.extend(shipped_problems(deals, sites, report))
    return problems


def main() -> None:
    if "--check" not in sys.argv:
        raise SystemExit("Use python scripts/vocabulary.py --check")
    problems = check_generated()
    if problems:
        raise SystemExit("Vocabulary check failed.\n" + "\n".join(problems[:40]))
    print("Vocabulary check passed. 0 unknown values.")


if __name__ == "__main__":
    main()
