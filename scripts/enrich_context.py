"""Zoning and traffic counts from free public map services. No purchases and no contact."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "context_records.json"
RETRIEVED = "2026-11-04"

ZONING = {
    "maricopa": (
        "https://gis.maricopa.gov/arcgis/rest/services/PND/PlanNet/MapServer/11/query",
        "ZONE,JURIS",
        "Maricopa County zoning",
    ),
    "scottsdale": (
        "https://maps.scottsdaleaz.gov/arcgis/rest/services/OpenData/MapServer/24/query",
        "full_zoning,comparable_zoning",
        "Scottsdale zoning",
    ),
    "miami": (
        "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/18/query",
        "ZONE,ZONE_DESC",
        "Miami-Dade county zoning",
    ),
    "clark": (
        "https://maps.clarkcountynv.gov/arcgis/rest/services/OpenData/PlanningandZoning/MapServer/11/query",
        "Description",
        "Clark County zoning",
    ),
    "lasvegas": (
        "https://maps.clarkcountynv.gov/arcgis/rest/services/OpenData/PlanningandZoning/MapServer/7/query",
        "ZONE,DESCRIPTIO",
        "Las Vegas zoning",
    ),
    "henderson": (
        "https://maps.clarkcountynv.gov/arcgis/rest/services/OpenData/PlanningandZoning/MapServer/9/query",
        "ZONECODE,COMZONE",
        "Henderson zoning",
    ),
    "nlv": (
        "https://maps.clarkcountynv.gov/arcgis/rest/services/OpenData/PlanningandZoning/MapServer/10/query",
        "ZONEDESC,ZONE_NO",
        "North Las Vegas zoning",
    ),
}

TRAFFIC = {
    "MIA": (
        "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Annual_Average_Daily_Traffic_TDA/FeatureServer/0/query",
        "ROADWAY,AADT,YEAR_,DESC_FRM,DESC_TO",
        "FDOT annual average daily traffic",
    ),
    "PHX": (
        "https://services6.arcgis.com/clPWQMwZfdWn4MQZ/arcgis/rest/services/AADT_AADT_CombinationUnitTrucks_AADTSingleUnit_FutureAADT/FeatureServer/0/query",
        "RouteId,AADT",
        "ADOT 2025 average annual daily traffic",
    ),
    "LAS": (
        "https://services2.arcgis.com/82iS1Pc7dgs3LFZv/arcgis/rest/services/2024_TRINA_Traffic_counts/FeatureServer/0/query",
        "ROUTE_NAME,AADT_2024",
        "Nevada 2024 TRINA traffic counts",
    ),
}


def _get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "sites-map-build"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def _point(url: str, lon: float, lat: float, fields: str, distance: int | None = None) -> list[dict]:
    params = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": fields,
        "returnGeometry": "false",
        "resultRecordCount": "5",
        "f": "json",
    }
    if distance:
        params["distance"] = str(distance)
        params["units"] = "esriSRUnit_Meter"
    payload = _get(url + "?" + urllib.parse.urlencode(params))
    if payload.get("error"):
        return []
    return [item.get("attributes") or {} for item in payload.get("features") or []]


def _weak(text: str) -> bool:
    value = (text or "").strip().lower()
    return (not value) or "unknown" in value or "none" in value or "unincorporated" in value


def _zone_label(layer: str, row: dict) -> str:
    if layer == "maricopa":
        zone = str(row.get("ZONE") or "").strip()
        juris = str(row.get("JURIS") or "").strip()
        return f"{zone} ({juris})" if zone and juris else zone
    if layer == "scottsdale":
        return str(row.get("full_zoning") or row.get("comparable_zoning") or "").strip()
    if layer == "miami":
        zone = str(row.get("ZONE") or "").strip()
        desc = str(row.get("ZONE_DESC") or "").strip()
        return f"{zone} — {desc}" if zone and desc else zone
    if layer == "clark":
        return str(row.get("Description") or "").strip()
    if layer == "lasvegas":
        zone = str(row.get("ZONE") or "").strip()
        desc = str(row.get("DESCRIPTIO") or "").strip()
        return f"{zone} — {desc}" if zone and desc else zone or desc
    if layer == "henderson":
        return str(row.get("ZONECODE") or row.get("COMZONE") or "").strip()
    if layer == "nlv":
        return str(row.get("ZONEDESC") or row.get("ZONE_NO") or "").strip()
    return ""


def _traffic(city: str, rows: list[dict]) -> tuple[str, str, str]:
    best = None
    for row in rows:
        if city == "MIA":
            count = row.get("AADT")
            start = str(row.get("DESC_FRM") or "").strip()
            end = str(row.get("DESC_TO") or "").strip()
            road = " to ".join(part for part in (start, end) if part and part.upper() != "N/A")
            year = str(row.get("YEAR_") or "").strip()
        elif city == "PHX":
            count = row.get("AADT")
            road = " ".join(str(row.get("RouteId") or "").split())
            year = "2025"
        else:
            count = row.get("AADT_2024")
            road = str(row.get("ROUTE_NAME") or "").strip()
            year = "2024"
        try:
            number = int(float(count))
        except (TypeError, ValueError):
            continue
        if number <= 0:
            continue
        if best is None or number > best[0]:
            best = (number, road, year[:4])
    if not best:
        return "", "", ""
    return f"{best[0]:,}", best[1], best[2]


def _targets(sites: list[dict]) -> list[tuple]:
    work = []
    for site in sites:
        if site.get("origin") != "universe" or not site.get("in_area") or not site.get("counts_as_site"):
            continue
        if site.get("lat") is None or site.get("lon") is None:
            continue
        lon, lat = float(site["lon"]), float(site["lat"])
        address = (site.get("address") or "").lower()
        zoning = site.get("zoning") or ""
        if site["city"] == "PHX" and _weak(zoning):
            if "scottsdale" in address:
                work.append((site["site_id"], "zone", "scottsdale", lon, lat))
            work.append((site["site_id"], "zone", "maricopa", lon, lat))
        elif site["city"] == "MIA" and _weak(zoning) and lat <= 25.98:
            work.append((site["site_id"], "zone", "miami", lon, lat))
        elif site["city"] == "LAS" and _weak(zoning):
            if "henderson" in address:
                work.append((site["site_id"], "zone", "henderson", lon, lat))
            elif "north las vegas" in address:
                work.append((site["site_id"], "zone", "nlv", lon, lat))
            else:
                work.append((site["site_id"], "zone", "lasvegas", lon, lat))
                work.append((site["site_id"], "zone", "clark", lon, lat))
        work.append((site["site_id"], "traffic", site["city"], lon, lat))
    return work


def apply_context(sites: list[dict]) -> dict:
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    by_id = {site["site_id"]: site for site in sites}
    todo = []
    for site_id, kind, layer, lon, lat in _targets(sites):
        key = f"{kind}|{layer}|v2|{round(lon, 4)}|{round(lat, 4)}"
        if key not in cache:
            todo.append((key, kind, layer, lon, lat))

    def job(item):
        key, kind, layer, lon, lat = item
        try:
            if kind == "zone":
                url, fields, _source = ZONING[layer]
                rows = _point(url, lon, lat, fields)
            else:
                url, fields, _source = TRAFFIC[layer]
                rows = _point(url, lon, lat, fields, distance=150)
        except Exception:
            rows = []
        return key, rows

    if todo:
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(job, item) for item in todo]
            for future in as_completed(futures):
                key, rows = future.result()
                cache[key] = rows

    zoning_filled = Counter()
    traffic_filled = Counter()
    for site_id, kind, layer, lon, lat in _targets(sites):
        site = by_id[site_id]
        key = f"{kind}|{layer}|v2|{round(lon, 4)}|{round(lat, 4)}"
        rows = cache.get(key) or []
        if kind == "zone":
            if not _weak(site.get("zoning") or "") and layer != "scottsdale":
                continue
            label = ""
            for row in rows:
                label = _zone_label(layer, row)
                if label:
                    break
            if not label:
                continue
            _url, _fields, source = ZONING[layer]
            # A city layer wins over a county layer when both match.
            if site.get("zoning_layer") in {"lasvegas", "henderson", "nlv", "scottsdale"} and layer in {"clark", "maricopa"}:
                continue
            site["zoning"] = label[:80]
            site["zoning_source"] = f"{source}, retrieved {RETRIEVED}"
            site["zoning_layer"] = layer
            zoning_filled[site["city"]] += 1
        else:
            count, road, year = _traffic(layer, rows)
            if not count:
                continue
            _url, _fields, source = TRAFFIC[layer]
            site["aadt_count"] = count
            site["aadt_road"] = road[:80]
            site["aadt_year"] = year
            site["aadt_source"] = f"{source}, retrieved {RETRIEVED}. Nearest counted road within 150 m."
            traffic_filled[site["city"]] += 1

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache))
    return {
        "zoning_by_city": dict(zoning_filled),
        "traffic_by_city": dict(traffic_filled),
        "note": (
            "Zoning queries used official layers that answered: Maricopa County PlanNet zoning, "
            "Scottsdale Open Data zoning, Miami-Dade county zoning, and Clark County open-data zoning "
            "(including Las Vegas, Henderson, and North Las Vegas). "
            "Chandler, Gilbert, Tempe, and Mesa city GIS roots did not publish a zoning service this pass. "
            "Traffic is the nearest public count within 150 m."
        ),
    }
