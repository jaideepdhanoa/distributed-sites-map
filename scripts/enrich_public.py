"""Public-record fields for site cards. No purchases and no contact with anyone.

Public records are the assessor mailing address and the last recorded sale, when the county layer includes them.
Phoenix and Miami owner mail, county value, year built, and (Phoenix) last sale come
from the county parcel layer, joined by parcel number.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "public_records.json"
HIFLD_CACHE = ROOT / "data" / "cache" / "hifld_territories.json"
HIFLD = (
    "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/ArcGIS/rest/services/"
    "Electric_Retail_Service_Territories_HIFLD/FeatureServer/0/query"
)
RETRIEVED = "2026-11-03"
_SKIP_UTILITY = re.compile(r"(?i)water|irrigation|sewer|reclamation|sanitation")


def _get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "sites-map-build"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.loads(response.read().decode())


def _ring_area(ring: list) -> float:
    area = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index][0], ring[index][1]
        x2, y2 = ring[index + 1][0], ring[index + 1][1]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def _contains(ring: list, lon: float, lat: float) -> bool:
    inside = False
    previous = len(ring) - 1
    for index in range(len(ring)):
        xi, yi = ring[index][0], ring[index][1]
        xj, yj = ring[previous][0], ring[previous][1]
        if (yi > lat) != (yj > lat):
            denom = (yj - yi) or 1e-15
            if lon < (xj - xi) * (lat - yi) / denom + xi:
                inside = not inside
        previous = index
    return inside


def _polygon_hit(geometry: dict, lon: float, lat: float) -> float | None:
    """Return the outer-ring area when the point is inside, else None."""
    if not geometry:
        return None
    kind = geometry.get("type")
    polygons = []
    if kind == "Polygon":
        polygons = [geometry.get("coordinates") or []]
    elif kind == "MultiPolygon":
        polygons = geometry.get("coordinates") or []
    best = None
    for polygon in polygons:
        if not polygon or not polygon[0] or not _contains(polygon[0], lon, lat):
            continue
        if any(_contains(hole, lon, lat) for hole in polygon[1:]):
            continue
        area = _ring_area(polygon[0])
        if best is None or area < best:
            best = area
    return best


def _load_territories() -> list[dict]:
    if HIFLD_CACHE.exists():
        return json.loads(HIFLD_CACHE.read_text())
    features = []
    for state in ("AZ", "NV", "FL"):
        url = HIFLD + "?" + urllib.parse.urlencode(
            {
                "where": f"STATE='{state}'",
                "outFields": "NAME,TYPE,STATE",
                "returnGeometry": "true",
                "outSR": "4326",
                "geometryPrecision": "4",
                "f": "geojson",
            }
        )
        payload = _get(url)
        for feature in payload.get("features") or []:
            name = str((feature.get("properties") or {}).get("NAME") or "")
            if not name or _SKIP_UTILITY.search(name):
                continue
            features.append(
                {
                    "name": name,
                    "type": (feature.get("properties") or {}).get("TYPE") or "",
                    "state": state,
                    "geometry": feature.get("geometry"),
                }
            )
    HIFLD_CACHE.parent.mkdir(parents=True, exist_ok=True)
    HIFLD_CACHE.write_text(json.dumps(features))
    return features


def _utility_hits(territories: list[dict], lon: float, lat: float) -> list[tuple[float, str]]:
    hits = []
    for territory in territories:
        area = _polygon_hit(territory.get("geometry") or {}, lon, lat)
        if area is None:
            continue
        hits.append((area, territory["name"]))
    hits.sort()
    return hits


def _choose_utility(hits: list[tuple[float, str]], broad: set[str]) -> str:
    """Prefer the smallest territory. Skip a territory that covers nearly the whole city when a tighter one also contains the pin."""
    for area, name in hits:
        if name in broad:
            continue
        return name
    return hits[0][1] if hits else ""


def _maricopa(apn: str) -> dict | None:
    url = (
        "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1/query?"
        + urllib.parse.urlencode(
            {
                "where": f"APN='{apn}'",
                "outFields": "OwnerAddressLine1,OwnerCity,OwnerState,OwnerZipCode,SalePrice,SaleDate,FullCashValue,AssessedFullCashValue,ConstructionYear",
                "returnGeometry": "false",
                "f": "json",
            }
        )
    )
    features = (_get(url).get("features") or [])
    if not features:
        return None
    return features[0].get("attributes") or {}


def _clark(parcel: str) -> dict | None:
    url = (
        "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/CC_PARCELS_SHP/FeatureServer/1/query?"
        + urllib.parse.urlencode(
            {
                "where": f"PARCEL='{parcel}'",
                "outFields": "ADDRESS1,ADDRESS2,SALEPRICE,SALEDATE",
                "returnGeometry": "false",
                "f": "json",
            }
        )
    )
    features = _get(url).get("features") or []
    if not features:
        return None
    return features[0].get("attributes") or {}


def _miami(folio: str) -> dict | None:
    url = (
        "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query?"
        + urllib.parse.urlencode(
            {
                "where": f"FOLIO='{folio}'",
                "outFields": "TRUE_MAILING_ADDR1,TRUE_MAILING_CITY,TRUE_MAILING_STATE,TRUE_MAILING_ZIP_CODE,YEAR_BUILT,TOTAL_VAL_CUR",
                "returnGeometry": "false",
                "f": "json",
            }
        )
    )
    features = _get(url).get("features") or []
    if not features:
        return None
    return features[0].get("attributes") or {}


def _date(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)) and value > 10_000_000_000:
        # County services sometimes return epoch milliseconds.
        from datetime import datetime, timezone

        return datetime.fromtimestamp(value / 1000, timezone.utc).strftime("%Y-%m-%d")
    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", text):
        return text[:10]
    return text[:20]


def _money(value) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if number <= 0:
        return ""
    return f"${number:,.0f}"


def _year(value) -> str:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return ""
    if number < 1800 or number > 2026:
        return ""
    return str(number)


def apply_public_records(sites: list[dict], norm_apn) -> dict:
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    territories = _load_territories()
    utility_filled = Counter()
    assessor_filled = Counter()

    for site in sites:
        site.setdefault("serving_utility", "")
        site.setdefault("serving_utility_source", "")
        site.setdefault("owner_mail", "")
        site.setdefault("assessed_value_display", "")
        site.setdefault("full_cash_value_display", "")
        site.setdefault("last_sale_date", "")
        site.setdefault("last_sale_price_display", "")
        site.setdefault("year_built", "")
        site.setdefault("assessor_source", "")

    hits_by_id: dict[str, list[tuple[float, str]]] = {}
    city_counts: dict[str, int] = Counter()
    name_counts: dict[str, Counter] = {}
    for site in sites:
        if site.get("lat") is None or site.get("lon") is None:
            continue
        if site.get("origin") != "universe" or not site.get("counts_as_site") or not site.get("in_area"):
            continue
        hits = _utility_hits(territories, float(site["lon"]), float(site["lat"]))
        hits_by_id[site["site_id"]] = hits
        city_counts[site["city"]] += 1
        bucket = name_counts.setdefault(site["city"], Counter())
        for _area, name in hits:
            bucket[name] += 1
    broad = {
        city: {name for name, count in counts.items() if city_counts[city] and count / city_counts[city] >= 0.9}
        for city, counts in name_counts.items()
    }
    for site in sites:
        hits = hits_by_id.get(site["site_id"]) or []
        # A territory that blankets the city is not a local answer when any tighter one also contains the pin.
        usable = [hit for hit in hits if hit[1] not in broad.get(site["city"], set())]
        name = _choose_utility(usable or hits, set())
        if name:
            site["serving_utility"] = name
            site["serving_utility_source"] = f"HIFLD electric retail service territories, retrieved {RETRIEVED}"
            utility_filled[site["city"]] += 1

    todo = []
    for site in sites:
        if site.get("origin") != "universe" or not site.get("in_area") or not site.get("counts_as_site"):
            continue
        if site["city"] not in {"PHX", "LAS", "MIA"}:
            continue
        token = norm_apn(site.get("apn"))
        if site["city"] == "MIA" and token.isdigit():
            token = token.zfill(13)
        if len(token) < 6:
            continue
        key = f"{site['city']}|{token}"
        if key in cache:
            continue
        todo.append((key, site["city"], token))

    def job(item):
        key, city, token = item
        try:
            if city == "LAS":
                import time
                time.sleep(0.15)
            found = _maricopa(token) if city == "PHX" else _clark(token) if city == "LAS" else _miami(token)
        except Exception:
            found = None
        return key, found

    if todo:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(job, item) for item in todo]
            for future in as_completed(futures):
                key, found = future.result()
                cache[key] = found or {}

    for site in sites:
        if site.get("origin") != "universe" or not site.get("in_area"):
            continue
        token = norm_apn(site.get("apn"))
        if site["city"] == "MIA" and token.isdigit():
            token = token.zfill(13)
        row = cache.get(f"{site['city']}|{token}") or {}
        if not row:
            continue
        if site["city"] == "PHX":
            mail = ", ".join(
                part
                for part in (
                    str(row.get("OwnerAddressLine1") or "").strip(),
                    str(row.get("OwnerCity") or "").strip(),
                    str(row.get("OwnerState") or "").strip(),
                    str(row.get("OwnerZipCode") or "").strip(),
                )
                if part
            )
            site["owner_mail"] = mail
            site["assessed_value_display"] = _money(row.get("AssessedFullCashValue"))
            site["full_cash_value_display"] = _money(row.get("FullCashValue"))
            site["last_sale_date"] = _date(row.get("SaleDate"))
            site["last_sale_price_display"] = _money(row.get("SalePrice"))
            site["year_built"] = _year(row.get("ConstructionYear"))
            site["assessor_source"] = f"Maricopa County assessor parcel, retrieved {RETRIEVED}"
        elif site["city"] == "LAS":
            mail = ", ".join(part for part in (str(row.get("ADDRESS1") or "").strip(), str(row.get("ADDRESS2") or "").strip()) if part)
            site["owner_mail"] = mail
            site["last_sale_date"] = _date(row.get("SALEDATE"))
            site["last_sale_price_display"] = _money(row.get("SALEPRICE"))
            site["assessor_source"] = f"Clark County parcel layer, retrieved {RETRIEVED}. Year built and assessed value are not on this free layer."
        else:
            mail = ", ".join(
                part
                for part in (
                    str(row.get("TRUE_MAILING_ADDR1") or "").strip(),
                    str(row.get("TRUE_MAILING_CITY") or "").strip(),
                    str(row.get("TRUE_MAILING_STATE") or "").strip(),
                    str(row.get("TRUE_MAILING_ZIP_CODE") or "").strip(),
                )
                if part
            )
            site["owner_mail"] = mail
            site["assessed_value_display"] = _money(row.get("TOTAL_VAL_CUR"))
            site["year_built"] = _year(row.get("YEAR_BUILT"))
            site["assessor_source"] = f"Miami-Dade property appraiser parcel, retrieved {RETRIEVED}"
        if site["owner_mail"] or site["assessed_value_display"] or site["year_built"]:
            assessor_filled[site["city"]] += 1

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache))
    return {
        "utility_by_city": dict(utility_filled),
        "assessor_by_city": dict(assessor_filled),
        "hifld_territories": len(territories),
        "note": (
            "County parcel records supply the mailing address and the last recorded sale when the layer includes them. "
            "Water and irrigation districts are left out. "
            "Miami-Dade's parcel layer has no last-sale date or price. "
            "Clark County's free parcel layer has mailing address and last sale. It does not include year built or assessed value."
        ),
    }
