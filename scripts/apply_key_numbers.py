"""Attach key-number fields from a Pipeline workbook export.

Does not rebuild the universe. Pass the exported xlsx. Rows already on the map
keep their stage. A full address that the city-qualified geocoder misses, such
as 7520 W McNab Rd, is tried again with the state alone.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import (  # noqa: E402
    GEOCODE_CACHE,
    business_type_from_row,
    clean_deal_note,
    deal_source,
    deal_text_problems,
    geocode_address,
    listing_url_from_row,
    money,
    nearest_depot_miles,
    parse_price,
    scrub,
    sheet_rows,
    split_broker,
    stage_group,
)
from scripts.key_numbers import FIGURE_FIELDS, coverage, key_figures  # noqa: E402

DEALS = ROOT / "data" / "generated" / "deals.geojson"
STAGES = ROOT / "data" / "workbook_stages.json"
DEPOTS = ROOT / "data" / "generated" / "depots.geojson"
# The financial-screen row whose street geocodes once the city is not forced.
ADD_IDS = {"PIPE-MIA-0080"}


def _blank() -> dict:
    return key_figures({}, "pipeline")


def _address(label: str) -> str:
    import re

    return re.sub(r"^(PHX|LAS|MIA|SNA)\s+", "", label, flags=re.I).strip()


def _new_deal(row: dict, kind: str, depots: list[dict], cache: dict) -> dict:
    label = str(row.get("Site") or "").strip()
    city = str(row.get("Market") or "").strip() or "UNK"
    deal_id = str(row.get("Site ID") or "").strip()
    broker, firm = split_broker(row.get("Broker"))
    price = parse_price(row.get("Asking price ($)"))
    url = listing_url_from_row(row)
    source_line, source_kind = deal_source(row, url)
    query_label = _address(label)
    place = {"PHX": "Phoenix, AZ", "LAS": "Las Vegas, NV", "MIA": "Miami, FL"}.get(city, "")
    coords = geocode_address(f"{query_label}, {place}".strip(", "), cache) if query_label else None
    miles = None
    if coords:
        miles = nearest_depot_miles(coords[0], coords[1], depots)
    props = {
        "deal_id": deal_id,
        "kind": kind,
        "name": scrub(row.get("Name") or query_label)[:160],
        "address": scrub(query_label)[:180],
        "city": city,
        "stage": scrub(row.get("Stage"))[:80],
        "stage_group": stage_group(row.get("Stage")),
        "broker": broker[:120],
        "firm": firm[:160],
        "listing_url": url[:400],
        "asking_price": price,
        "asking_price_display": money(price) if price else None,
        "asking_price_source": scrub(firm or broker or ("Listing" if url else ""))[:160],
        "next_step": clean_deal_note(row.get("Next step"))[:400],
        "universe_id": "",
        "coord_status": "geocoded" if coords else "failed",
        "miles_to_depot": miles,
        "listed": str(row.get("Listing status") or "").strip() == "Listed",
        "parcel_match": "",
        "parcel_acres": None,
        "source_line": source_line,
        "source_kind": source_kind,
        "business_type": business_type_from_row(row),
        **key_figures(row, kind),
    }
    problems = deal_text_problems(deal_id, props)
    if problems:
        raise SystemExit("Deal text still has internal wording: " + "; ".join(problems[:3]))
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [coords[0], coords[1]]} if coords else None,
        "properties": props,
    }


def _place_failed(feature: dict, row: dict, depots: list[dict], cache: dict) -> None:
    """Retry a full street that was stored with no coordinates."""
    if feature.get("geometry"):
        return
    props = feature["properties"]
    label = _address(str(row.get("Site") or props.get("address") or ""))
    if not re.search(r"\b\d{2,6}\s+[A-Za-z]", label):
        return
    city = str(props.get("city") or row.get("Market") or "")
    place = {"PHX": "Phoenix, AZ", "LAS": "Las Vegas, NV", "MIA": "Miami, FL"}.get(city, "")
    coords = geocode_address(f"{label}, {place}".strip(", "), cache)
    if not coords:
        return
    feature["geometry"] = {"type": "Point", "coordinates": [coords[0], coords[1]]}
    props["coord_status"] = "geocoded"
    props["address"] = scrub(label)[:180]
    props["miles_to_depot"] = nearest_depot_miles(coords[0], coords[1], depots)


def apply(workbook: Path) -> dict:
    deals = json.loads(DEALS.read_text())
    by_id = {feature["properties"]["deal_id"]: feature for feature in deals["features"]}
    depots = json.loads(DEPOTS.read_text())["features"]
    cache = json.loads(GEOCODE_CACHE.read_text()) if GEOCODE_CACHE.exists() else {}
    rows = {
        "pipeline": sheet_rows(workbook, "Pipeline", 3),
        "land": sheet_rows(workbook, "Land Sites", 3),
    }
    seen = set()
    for kind, table in rows.items():
        for row in table:
            deal_id = str(row.get("Site ID") or "").strip()
            if not deal_id:
                continue
            feature = by_id.get(deal_id)
            if feature is None:
                if deal_id not in ADD_IDS:
                    continue
                feature = _new_deal(row, kind, depots, cache)
                deals["features"].append(feature)
                by_id[deal_id] = feature
            else:
                feature["properties"].update(key_figures(row, kind))
                _place_failed(feature, row, depots, cache)
            seen.add(deal_id)
    for feature in deals["features"]:
        props = feature["properties"]
        if props["deal_id"] in seen:
            continue
        for key, value in _blank().items():
            props.setdefault(key, value)
    DEALS.write_text(json.dumps(deals, separators=(", ", ": ")))
    GEOCODE_CACHE.write_text(json.dumps(cache, indent=2) + "\n")
    stages = json.loads(STAGES.read_text())
    known = {row["deal_id"] for row in stages["rows"]}
    for feature in deals["features"]:
        props = feature["properties"]
        if props["deal_id"] in known:
            continue
        stages["rows"].append({"deal_id": props["deal_id"], "kind": props["kind"], "stage": props["stage"]})
    from collections import Counter

    stages["pipeline"] = dict(Counter(row["stage"] for row in stages["rows"] if row["kind"] == "pipeline"))
    stages["land"] = dict(Counter(row["stage"] for row in stages["rows"] if row["kind"] == "land"))
    STAGES.write_text(json.dumps(stages, indent=2) + "\n")
    return coverage(deals["features"])


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python scripts/apply_key_numbers.py workbook.xlsx")
    report = apply(Path(sys.argv[1]))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
