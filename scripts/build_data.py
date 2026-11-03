#!/usr/bin/env python3
"""Rebuild app data from data/source into data/generated.

Re-runnable. Verdict rows are append-only. Site ids already in the census are
kept; new pipeline and land rows get stable ids stored in data/id_registry.json.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "source"
OUT = ROOT / "data" / "generated"
VERDICTS = ROOT / "data" / "verdicts" / "verdicts.csv"
REGISTRY = ROOT / "data" / "id_registry.json"
PARCEL_CACHE = ROOT / "data" / "cache" / "parcel_cache.json"

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}

def _w(blob: str) -> str:
    return base64.b64decode(blob).decode()


# Display text is checked against a private term list. Patterns are stored encoded.
_WORD = [
    "d2F5bW8=",
    "bW9vdmU=",
    "Y2hhcmdpbmc=",
    "Y2hhcmdl",
    "Y2hhcmdlcg==",
    "YXV0b25vbW91cw==",
    "cm9ib3RheGk=",
    "Y3J1aXNl",
    "dm9sdGVyYQ==",
    "cGl0c3RvcA==",
    "a2lsb3dhdHQ=",
    "bWVnYXdhdHQ=",
    "d2Fsay1hd2F5",
    "d2Fsa2F3YXk=",
    "ZWxlY3RyaWMgdmVoaWNsZQ==",
    "ZXY=",
    "bXc=",
    "a3c=",
]
BANNED_PATTERNS = [re.compile(rf"\b{re.escape(_w(item))}\b", re.I) for item in _WORD]
_UNIT = f"(?:{_w('bXc=')}|{_w('a3c=')})"
BANNED_PATTERNS.append(re.compile(rf"(?<![A-Za-z])\d+(?:\.\d+)?\s*{_UNIT}\b", re.I))

FORBIDDEN_KEYS = {
    "offer",
    "offer_price",
    "target_price",
    "ebitda",
    "revenue",
    _w("d2Fsa2F3YXk="),
    _w("d2Fsay1hd2F5").replace("-", "_"),
    "most_can_pay",
    _w("a3c="),
    _w("bXc="),
    "power_kw",
    _w("a2lsb3dhdHQ="),
}

AREA_NAMES = {
    "vegas_core_~50": ("las-core", "LAS core", "service", "LAS"),
    "vegas_100": ("las-100", "LAS service area", "service", "LAS"),
    "vegas_200": ("las-200", "LAS expansion horizon", "expansion", "LAS"),
    "vegas_300": ("las-300", "LAS expansion horizon", "expansion", "LAS"),
    "phx_2026_v5": ("phx-service", "PHX service area", "service", "PHX"),
    "polygon 1": ("mia-current", "MIA service area", "service", "MIA"),
    "launch odd": ("mia-launch", "MIA launch area", "service", "MIA"),
    "extended odd": ("mia-extended", "MIA extended area", "service", "MIA"),
    "ft lauderdale": ("mia-pri-ftl", "MIA priority area", "service", "MIA"),
    "highland lakes": ("mia-pri-hl", "MIA priority area", "service", "MIA"),
    "fontainebleau": ("mia-pri-fb", "MIA priority area", "service", "MIA"),
    "mid-2027 northern odd boundary": ("mia-future", "MIA future boundary", "future", "MIA"),
}

BROWARD_HINTS = (
    "davie",
    "lauderhill",
    "fort lauderdale",
    "ft lauderdale",
    "hollywood",
    "dania",
    "hallandale",
    "pembroke",
    "miramar",
    "weston",
    "plantation",
    "sunrise",
    "coral springs",
    "pompano",
    "deerfield",
    "tamarac",
    "oakland park",
    "wilton",
    "margate",
    "west park",
    "southwest ranches",
)

VERDICT_FIELDS = [
    "verdict_id",
    "site_id",
    "market",
    "name",
    "address",
    "apn",
    "adjudicated_verdict",
    "spare_ac_own",
    "spare_ac_same_owner_adjoining",
    "operating_evidence",
    "parcel_evidence",
    "confidence",
    "notes",
    "aerial_verdict",
    "land_verdict_provisional",
    "operating_evidence_tier",
    "retrieved_at",
    "reviewer",
    "supersedes",
    "source_file",
]


def scrub(value) -> str:
    if value is None:
        return ""
    text = str(value)
    for pattern in BANNED_PATTERNS:
        text = pattern.sub("", text)
    text = re.sub(r"(?i)\bodd\b", "service area", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return text.strip(" ,;:-")


def banned_hits(text: str) -> list[str]:
    return [p.pattern for p in BANNED_PATTERNS if p.search(text or "")]


def norm_apn(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        value = str(int(value)) if value.is_integer() else str(value)
    else:
        value = str(value).strip()
        if re.fullmatch(r"\d+\.0+", value):
            value = value.split(".")[0]
    return re.sub(r"[^0-9A-Za-z]", "", value).upper().lstrip("0")


def apn_tokens(value) -> list[str]:
    if value is None:
        return []
    raw = str(value)
    if re.fullmatch(r"\d+\.0+", raw.strip()):
        raw = raw.strip().split(".")[0]
    found = re.findall(r"[0-9A-Za-z][0-9A-Za-z\-]{5,}", raw)
    tokens = []
    for token in found or [raw]:
        n = norm_apn(token)
        if len(n) >= 6:
            tokens.append(n)
    # also the whole string
    whole = norm_apn(value)
    if whole and whole not in tokens:
        tokens.insert(0, whole)
    return tokens


def first_number(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group()) if match else None


def parse_price(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        num = float(value)
        return num if num > 0 else None
    digits = re.sub(r"[^0-9.]", "", str(value))
    if not digits:
        return None
    try:
        num = float(digits)
    except ValueError:
        return None
    return num if num > 0 else None


def money(value):
    if value is None:
        return None
    return f"${value:,.0f}"


def site_class(raw: str) -> str:
    text = (raw or "").lower()
    if "gas" in text:
        return "Gas-attached"
    if "embed" in text:
        return "Embedded"
    if "core" in text or text.startswith("new"):
        return "Core"
    if "quarant" in text:
        return "Quarantined"
    if "not a wash" in text:
        return "Not a wash"
    if "licen" in text:
        return "Licence-only"
    if "closed" in text or "former" in text:
        return "Closed"
    if "out of area" in text:
        return "Out of area"
    if "merged" in text:
        return "Duplicate"
    return scrub(raw) or "Unknown"


def is_out_of_area(row: dict) -> bool:
    blob = " ".join(
        [
            row.get("class_v3") or "",
            row.get("class_after_aerial") or "",
            row.get("aerial_verdict") or "",
        ]
    ).lower()
    return "out of area" in blob


def stage_number(stage) -> int | None:
    if stage is None:
        return None
    match = re.match(r"^\s*(\d+)\b", str(stage))
    return int(match.group(1)) if match else None


def contacted_from_stage(stage) -> bool:
    number = stage_number(stage)
    return number is not None and number >= 2


def addr_key(value: str) -> str:
    text = (value or "").lower()
    text = re.sub(r"\b(phoenix|mesa|tempe|scottsdale|chandler|gilbert|peoria|glendale|fountain hills|buckeye|apache junction|san tan valley)\b", " ", text)
    text = re.sub(r"\b(las vegas|north las vegas|henderson|whitney|paradise)\b", " ", text)
    text = re.sub(r"\b(miami|miami gardens|hialeah|doral|sweetwater|florida city|homestead|davie|lauderhill|fort lauderdale|hollywood|dania beach|miramar)\b", " ", text)
    text = re.sub(r"\b(az|nv|fl|arizona|nevada|florida)\b", " ", text)
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def street_signature(value: str) -> str:
    key = addr_key(value)
    match = re.match(r"(\d+)\s+([nesw]\s+)?([a-z0-9]+)", key)
    if not match:
        return ""
    number, _, name = match.groups()
    return f"{number} {name}"


def load_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def sheet_rows(path: Path, sheet: str, header_row: int) -> list[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    header = [str(c).strip() if c is not None else "" for c in rows[header_row]]
    out = []
    for row in rows[header_row + 1 :]:
        if not row or row[0] in (None, ""):
            continue
        item = {}
        for i, key in enumerate(header):
            if not key:
                continue
            item[key] = row[i] if i < len(row) else None
        out.append(item)
    return out


def census_counts(path: Path) -> dict:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Universe"]
    counts = Counter()
    total = 0
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0 or not row or not any(row[:8]):
            continue
        total += 1
        counts[str(row[0] or "")] += 1
    wb.close()
    return {"total": total, "by_city": dict(counts)}


def parse_kml_coords(text: str) -> list[list[float]]:
    points = []
    for token in (text or "").replace("\n", " ").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            lon, lat = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        points.append([lon, lat])
    return points


def closed_ring(coords: list[list[float]]) -> list[list[float]]:
    if len(coords) >= 3 and coords[0] != coords[-1]:
        return coords + [coords[0]]
    return coords


def kml_geometries(placemark) -> list[dict]:
    geoms = []
    for poly in placemark.findall(".//k:Polygon", KML_NS):
        outer = poly.find(".//k:outerBoundaryIs//k:coordinates", KML_NS)
        if outer is None or not outer.text:
            continue
        rings = [closed_ring(parse_kml_coords(outer.text))]
        for inner in poly.findall(".//k:innerBoundaryIs//k:coordinates", KML_NS):
            if inner.text:
                rings.append(closed_ring(parse_kml_coords(inner.text)))
        if len(rings[0]) >= 4:
            geoms.append({"type": "Polygon", "coordinates": rings})
    for line in placemark.findall(".//k:LineString", KML_NS):
        coords_el = line.find("k:coordinates", KML_NS)
        coords = parse_kml_coords(coords_el.text if coords_el is not None else "")
        if len(coords) >= 3 and coords[0] == coords[-1]:
            geoms.append({"type": "Polygon", "coordinates": [closed_ring(coords)]})
        elif len(coords) >= 2:
            geoms.append({"type": "LineString", "coordinates": coords})
    return geoms


def load_service_areas() -> list[dict]:
    features = []
    seen = set()
    for kmz in sorted((SRC / "kmz").glob("*.kmz")):
        with zipfile.ZipFile(kmz) as archive:
            kml = archive.read("doc.kml")
        root = ET.fromstring(kml)
        for placemark in root.findall(".//k:Placemark", KML_NS):
            name_el = placemark.find("k:name", KML_NS)
            name = (name_el.text or "").strip() if name_el is not None else ""
            spec = AREA_NAMES.get(name.lower())
            if not spec:
                continue
            area_id, label, group, city = spec
            if area_id in seen and group != "service":
                # 200 and 300 share a label but must both be kept; ids differ.
                pass
            seen.add(area_id)
            for geom in kml_geometries(placemark):
                features.append(
                    {
                        "type": "Feature",
                        "geometry": geom,
                        "properties": {
                            "id": area_id,
                            "name": label,
                            "group": group,
                            "city": city,
                            "default_on": group == "service",
                        },
                    }
                )
    return features


def source_workbook() -> Path:
    for path in sorted(SRC.glob("*.xlsx")):
        if path.name.lower().startswith("reconciliation"):
            continue
        wb = openpyxl.load_workbook(path, read_only=True)
        names = list(wb.sheetnames)
        wb.close()
        if "Pipeline" in names and any(str(name).startswith("Screening") for name in names):
            return path
    raise SystemExit("The source folder needs the pipeline workbook.")


def reconciliation_workbook() -> Path:
    matches = sorted(SRC.glob("reconciliation*.xlsx"))
    if not matches:
        raise SystemExit("The source folder needs the reconciliation workbook.")
    return matches[-1]


# Screening codes: full layout is at least 10,000 sq ft; partial fit is at least 4,000 sq ft.
FIT10_SQFT = 10000
FIT4_SQFT = 4000


def tier_from_acres(*values) -> str | None:
    numbers = [value for value in values if isinstance(value, (int, float))]
    if not numbers:
        return None
    sqft = max(numbers) * 43560
    if sqft >= FIT10_SQFT:
        return "L10"
    if sqft >= FIT4_SQFT:
        return "L4"
    return None


def parse_muse_label(value) -> str | None:
    text = str(value or "").strip()
    if not text or text.lower() in {"none", "not in verdict files"}:
        return None
    low = text.lower()
    if "not a wash" in low or "not_a_wash" in low:
        return "NOT_A_WASH"
    if low.startswith("unresolved"):
        return "UNRESOLVED"
    if re.search(r"\bpass\b", low):
        return "PASS"
    if re.search(r"\bmaybe\b", low):
        return "MAYBE"
    if re.search(r"\bfail\b", low):
        return "FAIL"
    return None


def load_muse_file(path: Path) -> dict[str, str]:
    """Optional newer verdict file. Columns: site_id plus a verdict column."""
    records: dict[str, str] = {}
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                sid = str(row.get("site_id") or row.get("site id") or "").strip()
                raw = row.get("adjudicated_verdict") or row.get("verdict") or row.get("muse_verdict") or row.get("muse_updated_v4")
                parsed = parse_muse_label(raw) or (str(raw).strip().upper() if raw else "")
                if sid and parsed in {"PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED"}:
                    records[sid] = parsed
        return records
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not rows:
        return records
    header = [str(cell or "").strip().lower() for cell in rows[0]]
    def col(*names):
        for name in names:
            if name in header:
                return header.index(name)
        return None
    sid_i = col("site_id", "site id")
    verdict_i = col("adjudicated_verdict", "verdict", "muse_verdict", "muse_updated_v4")
    if sid_i is None or verdict_i is None:
        return records
    for row in rows[1:]:
        if not row or row[sid_i] in (None, ""):
            continue
        parsed = parse_muse_label(row[verdict_i])
        if parsed:
            records[str(row[sid_i]).strip()] = parsed
    return records


def load_reconciliation() -> list[dict]:
    wb = openpyxl.load_workbook(reconciliation_workbook(), read_only=True, data_only=True)
    ws = wb["Final_list"]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    header = rows[0]
    idx = {name: i for i, name in enumerate(header)}
    out = []
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        out.append({key: row[i] if i < len(row) else None for key, i in idx.items()})
    return out


def field_status_from_label(label: str) -> dict:
    """Turn 'verified (owner, parcel); inferred (spare)' into field dots."""
    text = label or ""
    fields = {}
    for status, body in re.findall(r"(verified|inferred|unknown)\s*\(([^)]*)\)", text, flags=re.I):
        for part in re.split(r",|/| and ", body):
            key = part.strip().lower()
            key = {
                "owner": "owner",
                "parcel": "parcel",
                "spare": "spare",
                "operating": "operating",
            }.get(key.split()[0] if key else "", "")
            if key:
                fields[key] = status.lower()
    return fields


def confidence_from_fields(fields: dict) -> str:
    if not fields:
        return "low"
    values = set(fields.values())
    if "unknown" in values:
        return "low"
    if "inferred" in values:
        return "medium"
    if values == {"verified"}:
        return "high"
    return "low"


def map_playbook(tier: str, muse_verdict: str | None) -> tuple[str | None, str | None]:
    tier = tier or ""
    if tier.startswith("Tier 1"):
        return "PASS", "own_parcel"
    if tier.startswith("Tier 2"):
        # Playbook scale: spare only on same-owner adjoining land is MAYBE.
        return "MAYBE", "same_owner_adjoining"
    if tier.upper() == "MAYBE":
        return "MAYBE", "own_parcel"
    if tier.lower().startswith("unresolved"):
        return "UNRESOLVED", None
    if tier == "Dead":
        if muse_verdict == "NOT_A_WASH":
            return "NOT_A_WASH", None
        return "FAIL", None
    return None, None


def google_coords(blob: str) -> tuple[float, float] | None:
    if not blob:
        return None
    match = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", blob)
    if match:
        return float(match.group(2)), float(match.group(1))
    match = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", blob)
    if match:
        return float(match.group(2)), float(match.group(1))
    return None


def registry_load() -> dict:
    if REGISTRY.exists():
        return json.loads(REGISTRY.read_text())
    return {"next": {"PIPE": 1, "LAND": 1}, "by_key": {}}


def registry_id(reg: dict, kind: str, key: str, city: str) -> str:
    if key in reg["by_key"]:
        return reg["by_key"][key]
    n = reg["next"].get(kind, 1)
    reg["next"][kind] = n + 1
    assigned = f"{kind}-{city}-{n:04d}"
    reg["by_key"][key] = assigned
    return assigned


def county_url(city: str, apn: str, address: str) -> str:
    blob = (address or "").lower()
    if city == "PHX" and apn:
        return "https://mcassessor.maricopa.gov/mcs/?q=" + urllib.parse.quote(apn)
    if city == "LAS" and apn:
        return "https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/pcl.aspx?parcel=" + urllib.parse.quote(apn)
    if city == "MIA":
        if any(hint in blob for hint in BROWARD_HINTS):
            return "https://web.bcpa.net/BcpaClient/#/Record-Search"
        if apn:
            return "https://www.miamidade.gov/Apps/PA/propertysearch/#/?folio=" + urllib.parse.quote(apn)
    return ""


def looks_broward(address: str) -> bool:
    blob = (address or "").lower()
    return any(hint in blob for hint in BROWARD_HINTS)


def fetch_parcel(city: str, apn: str, address: str) -> dict | None:
    tokens = apn_tokens(apn)
    if not tokens:
        return None
    if city == "LAS":
        for token in tokens:
            if not token.isdigit():
                continue
            url = (
                "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/"
                "CC_PARCELS_SHP/FeatureServer/1/query?"
                + urllib.parse.urlencode(
                    {
                        "where": f"PARCEL='{token}'",
                        "outFields": "PARCEL,ASSR_ACRES",
                        "returnGeometry": "true",
                        "outSR": "4326",
                        "f": "geojson",
                    }
                )
            )
            feat = http_geojson(url)
            if feat:
                feat["county"] = "Clark"
                feat["apn"] = token
                return feat
    elif city == "PHX":
        for token in tokens:
            url = (
                "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1/query?"
                + urllib.parse.urlencode(
                    {
                        "where": f"APN='{token}'",
                        "outFields": "APN",
                        "returnGeometry": "true",
                        "outSR": "4326",
                        "f": "geojson",
                    }
                )
            )
            feat = http_geojson(url)
            if feat:
                feat["county"] = "Maricopa"
                feat["apn"] = token
                return feat
    elif city == "MIA" and not looks_broward(address):
        for token in tokens:
            folio = token.zfill(13) if token.isdigit() else token
            url = (
                "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query?"
                + urllib.parse.urlencode(
                    {
                        "where": f"FOLIO='{folio}'",
                        "outFields": "FOLIO",
                        "returnGeometry": "true",
                        "outSR": "4326",
                        "f": "geojson",
                    }
                )
            )
            feat = http_geojson(url)
            if feat:
                feat["county"] = "Miami-Dade"
                feat["apn"] = folio
                return feat
    return None


def http_geojson(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": "sites-map-build"})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    features = payload.get("features") or []
    if not features:
        return None
    geom = features[0].get("geometry")
    if not geom:
        return None
    return {"geometry": geom}


def load_parcel_cache() -> dict:
    if PARCEL_CACHE.exists():
        return json.loads(PARCEL_CACHE.read_text())
    return {}


def build_parcels(sites: list[dict], refresh: bool) -> tuple[list[dict], dict]:
    cache = {} if refresh else load_parcel_cache()
    wanted = []
    for site in sites:
        if not site.get("verdict"):
            continue
        if site.get("duplicate_of"):
            continue
        key = f"{site['city']}|{norm_apn(site.get('apn'))}|{site['site_id']}"
        wanted.append((key, site))
    features = []
    stats = Counter()
    todo = []
    for key, site in wanted:
        if key in cache and not refresh:
            cached = cache[key]
            if cached:
                features.append(parcel_feature(site, cached))
                stats["cache_hit"] += 1
            else:
                stats["cache_miss_empty"] += 1
            continue
        todo.append((key, site))

    def job(item):
        key, site = item
        if looks_broward(site.get("address") or "") and site["city"] == "MIA":
            return key, None, "broward_unavailable"
        found = fetch_parcel(site["city"], site.get("apn") or "", site.get("address") or "")
        return key, found, "fetched" if found else "not_found"

    if todo:
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(job, item) for item in todo]
            for fut in as_completed(futures):
                key, found, label = fut.result()
                cache[key] = found
                stats[label] += 1
                if found:
                    site = next(s for k, s in todo if k == key)
                    features.append(parcel_feature(site, found))
    stats["features"] = len(features)
    stats["broward_skipped"] = sum(
        1
        for site in sites
        if site.get("verdict") and site["city"] == "MIA" and looks_broward(site.get("address") or "")
    )
    return features, {"counts": dict(stats), "note": parcel_note(stats)}


def parcel_feature(site: dict, cached: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": cached["geometry"],
        "properties": {
            "site_id": site["site_id"],
            "apn": cached.get("apn") or site.get("apn"),
            "role": "wash",
            "county": cached.get("county"),
            "city": site["city"],
        },
    }


def parcel_note(stats: Counter) -> str:
    return (
        "Parcel outlines were requested from Clark, Maricopa, and Miami-Dade county "
        "map services for county-checked sites. Broward County's map service did not "
        "resolve, so Broward sites have no outline. Same-owner adjoining parcels were "
        "not in the source files and were not fetched. "
        f"Cache and fetch counts: {dict(stats)}."
    )


def verdict_id(row: dict) -> str:
    raw = "|".join(
        [
            row.get("reviewer") or "",
            row.get("site_id") or "",
            row.get("adjudicated_verdict") or "",
            row.get("aerial_verdict") or "",
            row.get("land_verdict_provisional") or "",
            str(row.get("spare_ac_own") or ""),
            str(row.get("spare_ac_same_owner_adjoining") or ""),
            row.get("retrieved_at") or "",
            row.get("source_file") or "",
            (row.get("notes") or "")[:180],
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def append_verdicts(new_rows: list[dict]) -> dict:
    existing = []
    if VERDICTS.exists():
        with VERDICTS.open(newline="", encoding="utf-8") as handle:
            existing = list(csv.DictReader(handle))
    by_id = {row["verdict_id"]: row for row in existing if row.get("verdict_id")}
    current_for = {}
    for row in existing:
        key = (row.get("site_id"), row.get("reviewer"), row.get("source_file"))
        current_for[key] = row["verdict_id"]
    added = 0
    for row in new_rows:
        row["verdict_id"] = verdict_id(row)
        row["supersedes"] = row.get("supersedes") or ""
        if row["verdict_id"] in by_id:
            continue
        key = (row.get("site_id"), row.get("reviewer"), row.get("source_file"))
        previous = current_for.get(key)
        if previous and previous != row["verdict_id"]:
            row["supersedes"] = previous
        by_id[row["verdict_id"]] = row
        current_for[key] = row["verdict_id"]
        existing.append(row)
        added += 1
    return {"rows": existing, "added": added, "total": len(existing)}


def write_verdicts(rows: list[dict]) -> None:
    VERDICTS.parent.mkdir(parents=True, exist_ok=True)
    with VERDICTS.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=VERDICT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in VERDICT_FIELDS})


def scan_obj(obj, path="$"):
    problems = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            folded = key.lower().replace("-", "_")
            if folded in FORBIDDEN_KEYS or "ebitda" in folded or "most_can_pay" in folded:
                problems.append(f"forbidden key {path}.{key}")
            problems.extend(scan_obj(value, f"{path}.{key}"))
    elif isinstance(obj, list):
        for i, value in enumerate(obj[:5000]):
            problems.extend(scan_obj(value, f"{path}[{i}]"))
    elif isinstance(obj, str):
        hits = banned_hits(obj)
        if hits:
            problems.append(f"banned text at {path}: {obj[:140]!r}")
    return problems


def load_screening() -> dict:
    """Aerial FIT tier and utility-proximity grade live on the workbook screening tab."""
    path = source_workbook()
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = next(name for name in wb.sheetnames if str(name).startswith("Screening"))
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    header = [str(c).strip() if c is not None else "" for c in rows[0]]
    idx = {name: i for i, name in enumerate(header)}
    grouped = defaultdict(list)
    for row in rows[1:]:
        if not row or row[0] is None:
            continue
        market = row[idx["market"]]
        apn = norm_apn(row[idx["apn"]])
        if not market or not apn:
            continue
        grouped[(market, apn)].append(
            {
                "aerial": row[idx["aerial_verdict"]],
                "spare_sqft": first_number(row[idx["aerial_spare_sqft"]]),
                "confidence": row[idx["aerial_confidence"]],
                "tenure": row[idx["tenure"]],
                "power": row[idx["power_proxy"]],
                "in_flag": row[idx["service_area_true"]],
            }
        )
    rank = {"FIT_10": 0, "FIT_4": 1, "MARGINAL": 2, "CANNOT_TELL": 3, "NO_FIT": 4, "NOT_A_WASH": 5}
    chosen = {}
    conflicts = []
    for key, hits in grouped.items():
        verdicts = {hit["aerial"] for hit in hits}
        if len(verdicts) > 1:
            conflicts.append((key, sorted(str(v) for v in verdicts)))
        hits.sort(key=lambda hit: rank.get(hit["aerial"], 9))
        chosen[key] = hits[0]
    return {"rows": chosen, "conflicts": conflicts, "row_count": sum(len(v) for v in grouped.values())}


def elimination_reason(site: dict) -> str:
    if site.get("verdict") != "NOT_A_WASH":
        return ""
    blob = " ".join(
        [
            site.get("name") or "",
            site.get("evidence") or "",
            site.get("operating") or "",
            site.get("agreement") or "",
        ]
    ).lower()
    if "vacant" in blob:
        return "vacant lot"
    if any(word in blob for word in ("mobile detail", "not a fixed", "residential parcel", "home-based")):
        return "mobile or not a fixed wash"
    if any(word in blob for word in ("converted", "restaurant", "nightclub", "fuel only", "auto lot", "no wash")):
        return "converted"
    if "closed" in blob:
        return "closed"
    return "not categorised in the file"


def is_tenure_fail(site: dict) -> bool:
    if site.get("verdict") != "FAIL":
        return False
    blob = " ".join([site.get("evidence") or "", site.get("agreement") or "", site.get("operating") or ""]).lower()
    return "tenure" in blob or "landlord" in blob


INCOMING_ALIASES = {
    "site_id": "site_id",
    "market": "market",
    "apn": "apn",
    "folio": "apn",
    "adjudicated_verdict": "verdict",
    "verdict": "verdict",
    "final_verdict": "verdict",
    "spare_ac_own": "spare_own",
    "own_parcel_spare_ac": "spare_own",
    "spare_ac_same_owner_adjoining": "spare_adj",
    "same_owner_adjoining_ac": "spare_adj",
    "operating_evidence": "operating_evidence",
    "parcel_evidence": "parcel_evidence",
    "evidence": "parcel_evidence",
    "confidence": "confidence",
    "notes": "notes",
    "reviewer": "reviewer",
    "retrieved_at": "retrieved_at",
    "date": "retrieved_at",
    "fit_tier": "fit_tier",
    "land_tier": "land_tier",
    "aerial_verdict": "aerial_verdict",
    "elimination_reason": "elimination_reason",
    "source_file": "source_file",
}


def _header_key(value) -> str:
    token = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    return INCOMING_ALIASES.get(token, "")


def _records_from_table(header, data_rows, source_name: str) -> list[dict]:
    keys = [_header_key(cell) for cell in header]
    if not any(keys):
        return []
    records = []
    for row in data_rows:
        if not row or not any(cell not in (None, "") for cell in row):
            continue
        item = {"source_file": source_name}
        for key, cell in zip(keys, row):
            if key and cell not in (None, ""):
                item[key] = cell
        if item.get("site_id") or item.get("apn") or item.get("verdict"):
            records.append(item)
    return records


def load_incoming_verdicts() -> list[dict]:
    """Any csv or xlsx dropped in data/source/incoming is appended. No code change."""
    folder = SRC / "incoming"
    if not folder.exists():
        return []
    records = []
    for path in sorted(folder.iterdir()):
        if path.name.startswith("."):
            continue
        if path.suffix.lower() == ".csv":
            with path.open(newline="", encoding="utf-8") as handle:
                reader = csv.reader(handle)
                try:
                    header = next(reader)
                except StopIteration:
                    continue
                records.extend(_records_from_table(header, reader, path.name))
        elif path.suffix.lower() in {".xlsx", ".xlsm"}:
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            for sheet in wb.sheetnames:
                rows = list(wb[sheet].iter_rows(values_only=True))
                header_at = None
                for i, row in enumerate(rows[:15]):
                    if row and any(_header_key(cell) in {"site_id", "apn", "verdict"} for cell in row):
                        header_at = i
                        break
                if header_at is None:
                    continue
                records.extend(_records_from_table(rows[header_at], rows[header_at + 1 :], f"{path.name}:{sheet}"))
            wb.close()
    return records


def normalise_fit(value) -> str:
    token = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if token in {"FIT10", "L10"}:
        return "L10"
    if token in {"FIT4", "L4"}:
        return "L4"
    return ""


def apply_incoming(records, by_id, verdict_rows, crosswalk) -> dict:
    applied = 0
    unmatched = []
    for record in records:
        sid = str(record.get("site_id") or "").strip()
        site = by_id.get(sid) if sid else None
        if site is None and record.get("apn"):
            apn = norm_apn(record.get("apn"))
            market = str(record.get("market") or "").strip()
            hits = [
                item
                for item in by_id.values()
                if norm_apn(item.get("apn")) == apn and (not market or item.get("city") == market)
            ]
            site = hits[0] if len(hits) == 1 else None
        if site is None:
            unmatched.append(str(record.get("site_id") or record.get("apn") or ""))
            continue
        applied += 1
        fit = normalise_fit(record.get("land_tier") or record.get("fit_tier") or record.get("aerial_verdict"))
        if fit:
            site["land_tier"] = fit
        if record.get("aerial_verdict"):
            site["aerial_fit"] = str(record.get("aerial_verdict")).strip()
        verdict = str(record.get("verdict") or "").strip().upper().replace(" ", "_")
        if verdict not in {"PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED"}:
            continue
        site["verdict"] = verdict
        if record.get("spare_own") is not None:
            site["spare_ac_own"] = first_number(record.get("spare_own"))
            site["spare_ac_own_text"] = scrub(record.get("spare_own"))
        if record.get("spare_adj") is not None:
            site["spare_ac_adjoining"] = first_number(record.get("spare_adj"))
            site["spare_ac_adjoining_text"] = scrub(record.get("spare_adj"))
        if record.get("parcel_evidence"):
            site["evidence"] = scrub(record.get("parcel_evidence"))[:700]
        if record.get("elimination_reason"):
            site["elimination_reason"] = scrub(record.get("elimination_reason"))
        reviewer = scrub(record.get("reviewer") or "Incoming") or "Incoming"
        retrieved = record.get("retrieved_at")
        if hasattr(retrieved, "strftime"):
            retrieved = retrieved.strftime("%Y-%m-%d")
        retrieved = str(retrieved or "")[:10] or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        note = scrub(record.get("notes"))[:400]
        verdict_rows.append(
            {
                "site_id": site["site_id"],
                "market": site["city"],
                "name": site["name"],
                "address": site["address"],
                "apn": norm_apn(site.get("apn")),
                "adjudicated_verdict": verdict,
                "spare_ac_own": site["spare_ac_own"] if site["spare_ac_own"] is not None else "",
                "spare_ac_same_owner_adjoining": site["spare_ac_adjoining"] if site["spare_ac_adjoining"] is not None else "",
                "operating_evidence": scrub(record.get("operating_evidence"))[:500],
                "parcel_evidence": site["evidence"],
                "confidence": scrub(record.get("confidence")),
                "notes": note,
                "aerial_verdict": site.get("aerial_fit") or "",
                "land_verdict_provisional": "",
                "operating_evidence_tier": "",
                "retrieved_at": retrieved,
                "reviewer": reviewer,
                "supersedes": "",
                "source_file": record.get("source_file") or "incoming",
            }
        )
        site["reviews"].append(
            {
                "reviewer": reviewer,
                "kind": "county",
                "verdict": verdict,
                "provisional": False,
                "spare_ac_own": site["spare_ac_own"],
                "spare_ac_adjoining": site["spare_ac_adjoining"],
                "confidence": scrub(record.get("confidence")),
                "date": retrieved,
                "note": note or site["evidence"][:240],
            }
        )
        crosswalk.append(
            {"site_id": site["site_id"], "source": "incoming", "source_key": record.get("source_file") or sid}
        )
    return {"rows": len(records), "applied": applied, "unmatched": unmatched[:30]}


def class_breakdown(rows: list[dict]) -> dict:
    counts = Counter(row.get("site_class") or "Unknown" for row in rows)
    return dict(counts)


def city_class(rows: list[dict]) -> dict:
    out = {}
    for city in ("LAS", "PHX", "MIA"):
        out[city] = class_breakdown([row for row in rows if row["city"] == city])
    return out


def build(write: bool, refresh_parcels: bool, muse_file: str | None = None) -> dict:
    universe = load_csv(SRC / "universe_v3.csv")
    ring_rows = {row["site_id"]: row for row in load_csv(SRC / "las_ring100_screen.csv")}
    listings = load_csv(SRC / "listings_match_v3.csv")
    recon = load_reconciliation()
    muse_override = load_muse_file(Path(muse_file)) if muse_file else {}
    workbook = source_workbook()
    census = census_counts(workbook)
    pipeline_rows = sheet_rows(workbook, "Pipeline", 3)
    land_rows = sheet_rows(workbook, "Land Sites", 3)
    areas = load_service_areas()
    screening = load_screening()
    incoming = load_incoming_verdicts()

    by_apn = defaultdict(list)
    for row in universe:
        token = norm_apn(row.get("apn"))
        if token:
            by_apn[(row["market"], token)].append(row["site_id"])

    # Same-parcel pair: keep the canonical U id, flag the other.
    duplicate_of = {}
    for (market, apn), ids in by_apn.items():
        if len(ids) < 2:
            continue
        ranked = sorted(ids, key=lambda sid: (0 if re.search(r"-U\d", sid) else 1, sid))
        keep = ranked[0]
        for other in ranked[1:]:
            duplicate_of[other] = keep

    listing_by_site = defaultdict(list)
    for row in listings:
        if not str(row.get("match_status") or "").startswith("matched"):
            continue
        status = (row.get("listing_status") or "").strip()
        price = parse_price(row.get("price"))
        live = status == "Listed" or (status == "" and price is not None)
        if status in ("Off-market", "Sold or withdrawn"):
            live = False
        for sid in re.split(r"[;\s,]+", row.get("matched_site_ids") or ""):
            sid = sid.strip()
            if sid:
                listing_by_site[sid].append({**row, "_live": live, "_price": price})

    def best_listing(sid: str):
        rows = [row for row in listing_by_site.get(sid, []) if row["_live"] and row["_price"]]
        if not rows:
            rows = [row for row in listing_by_site.get(sid, []) if row["_live"]]
        return rows[0] if rows else None

    reg = registry_load()
    crosswalk = []
    verdict_rows = []
    sites = []

    def blank_site(sid, city):
        return {
            "site_id": sid,
            "city": city,
            "name": "",
            "address": "",
            "apn": "",
            "lat": None,
            "lon": None,
            "coord_status": "unknown",
            "site_class": "Unknown",
            "in_area": False,
            "service_ring": "",
            "expansion_horizon": False,
            "duplicate_of": duplicate_of.get(sid),
            "counts_as_site": sid not in duplicate_of,
            "lot_ac": None,
            "owner": "",
            "tenure": "",
            "spare_ac_own": None,
            "spare_ac_own_text": "",
            "spare_ac_adjoining": None,
            "spare_ac_adjoining_text": "",
            "verdict": None,
            "land_tier": None,
            "land_control": "",
            "network_status": None,
            "reconciliation_tier": "",
            "muse_verdict": None,
            "verdict_disagreement": False,
            "acreage_note": "",
            "scale_note": "",
            "confidence": "low",
            "listed": False,
            "contacted": False,
            "asking_price": None,
            "asking_price_display": None,
            "asking_price_source": "",
            "asking_price_url": "",
            "asking_price_date": "",
            "asking_price_status": None,
            "pipeline_stage": None,
            "pipeline_id": None,
            "land_only": False,
            "on_land_tab": False,
            "quarantine": False,
            "flood_zone": "",
            "zoning": "",
            "tank_status": "",
            "utility_proximity": "",
            "aerial_fit": "",
            "verification": "not screened",
            "elimination_reason": "",
            "tenure_fail": False,
            "is_held_fit": False,
            "miles_to_depot": None,
            "evidence": "",
            "operating": "",
            "agreement": "",
            "county_url": "",
            "street_view_url": "",
            "why_stopped": "",
            "fields": {},
            "reviews": [],
            "origin": "universe",
        }

    for row in universe:
        sid = row["site_id"]
        city = row["market"]
        site = blank_site(sid, city)
        lat = first_number(row.get("lat"))
        lon = first_number(row.get("lon"))
        if lat is not None and lon is not None:
            site["lat"] = lat
            site["lon"] = lon
            site["coord_status"] = "known"
            site["street_view_url"] = f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lon}"
        site["name"] = scrub(row.get("name"))
        site["address"] = scrub(row.get("address"))
        site["apn"] = row.get("apn") or ""
        site["site_class"] = site_class(row.get("class_after_aerial") or row.get("class_v3") or "")
        site["quarantine"] = "quarant" in (row.get("class_after_aerial") or "").lower() or "quarant" in (row.get("class_v3") or "").lower()
        site["lot_ac"] = first_number(row.get("lot_ac"))
        site["owner"] = scrub(row.get("owner"))
        site["flood_zone"] = scrub(row.get("flood_zone"))
        site["zoning"] = scrub(row.get("zoning"))
        site["tank_status"] = scrub(row.get("ust_rel_status"))
        site["miles_to_depot"] = first_number(row.get("depot_mi"))
        site["spare_ac_own"] = first_number(row.get("spare_ac_aerial"))
        if site["spare_ac_own"] is not None:
            site["spare_ac_own_text"] = str(row.get("spare_ac_aerial"))
        in100 = ring_rows.get(sid, {}).get("in100") == "True"
        if city == "LAS":
            site["in_area"] = in100
            ring_name = (row.get("ring") or ring_rows.get(sid, {}).get("ring") or "").strip()
            site["service_ring"] = ring_name or ("100" if in100 else "outside")
            site["expansion_horizon"] = ring_name in {"200", "300"}
        else:
            site["in_area"] = not is_out_of_area(row)
            site["service_ring"] = "service" if site["in_area"] else "outside"
        site["county_url"] = county_url(city, site["apn"], site["address"])
        if (row.get("listed_post") or "").strip() == "True" or (row.get("public_listing_freshscan") or "").strip() == "True":
            site["listed"] = True
        aerial = (row.get("aerial_verdict") or "").strip().lower()
        if aerial and "not reviewed" not in aerial:
            verdict_rows.append(
                {
                    "site_id": sid,
                    "market": city,
                    "name": site["name"],
                    "address": site["address"],
                    "apn": norm_apn(site["apn"]),
                    "adjudicated_verdict": "",
                    "spare_ac_own": site["spare_ac_own"] if site["spare_ac_own"] is not None else "",
                    "spare_ac_same_owner_adjoining": "",
                    "operating_evidence": "",
                    "parcel_evidence": "",
                    "confidence": scrub(row.get("aerial_conf")),
                    "notes": "Provisional aerial screen. It does not decide the county verdict.",
                    "aerial_verdict": aerial,
                    "land_verdict_provisional": aerial,
                    "operating_evidence_tier": "",
                    "retrieved_at": "2026-11-02",
                    "reviewer": "Indie",
                    "supersedes": "",
                    "source_file": "universe_v3.csv",
                }
            )
            site["reviews"].append(
                {
                    "reviewer": "Indie",
                    "kind": "aerial",
                    "verdict": aerial,
                    "provisional": True,
                    "spare_ac_own": site["spare_ac_own"],
                    "spare_ac_adjoining": None,
                    "confidence": scrub(row.get("aerial_conf")),
                    "date": "2026-11-02",
                    "note": "Provisional aerial screen.",
                }
            )
        crosswalk.append({"site_id": sid, "source": "census_v3", "source_key": sid})
        sites.append(site)

    by_id = {site["site_id"]: site for site in sites}
    fit_rank = {"FIT_10": 0, "FIT_4": 1, "MARGINAL": 2, "CANNOT_TELL": 3, "NO_FIT": 4, "NOT_A_WASH": 5}
    screening_matched = 0
    for site in sites:
        if site["origin"] != "universe":
            continue
        hit = screening["rows"].get((site["city"], norm_apn(site["apn"])))
        if not hit:
            continue
        screening_matched += 1
        aerial = str(hit["aerial"] or "").strip()
        site["aerial_fit"] = aerial
        site["land_tier"] = {"FIT_10": "L10", "FIT_4": "L4"}.get(aerial)
        power = str(hit["power"] or "").strip().lower()
        site["utility_proximity"] = {"strong": "Strong", "ok": "OK", "weak": "Weak", "unknown": "Unknown"}.get(power, "")
        tenure = str(hit["tenure"] or "").strip()
        if tenure in {"OK", "Unknown", "Tenant-risk"}:
            site["tenure"] = tenure
        if hit["spare_sqft"] is not None and site["spare_ac_own"] is None:
            site["spare_ac_own"] = round(hit["spare_sqft"] / 43560, 3)
            site["spare_ac_own_text"] = f"{hit['spare_sqft']:g} sq ft aerial"
        if aerial:
            site["reviews"].append(
                {
                    "reviewer": "Indie",
                    "kind": "aerial",
                    "verdict": aerial,
                    "provisional": True,
                    "spare_ac_own": site["spare_ac_own"],
                    "spare_ac_adjoining": None,
                    "confidence": scrub(hit["confidence"]),
                    "date": "2026-11-02",
                    "note": "Screening tab land tier. It does not decide the county verdict.",
                }
            )
            crosswalk.append({"site_id": site["site_id"], "source": "Screening tab", "source_key": norm_apn(site["apn"])})
    # silence unused rank in case of future tie-breaks
    _ = fit_rank

    for row in recon:
        sid = row["site_id"]
        site = by_id.get(sid)
        if not site:
            continue
        muse_verdict = muse_override.get(sid) or parse_muse_label(row.get("muse_updated_v4"))
        site["muse_verdict"] = muse_verdict
        playbook, land_tier = map_playbook(str(row.get("final_tier") or ""), muse_verdict)
        site["verdict"] = playbook
        site["land_control"] = land_tier or ""
        site["reconciliation_tier"] = scrub(row.get("final_tier"))
        network = scrub(row.get("network_status") or "")
        if "held" in network.lower():
            site["network_status"] = "held"
        elif playbook == "PASS":
            site["network_status"] = "cleared"
        if str(row.get("final_tier") or "").startswith("Tier 2"):
            site["scale_note"] = "Reconciliation keeps this as Tier 2 (same-owner adjoining). On the playbook scale that is MAYBE."
        own_text = scrub(row.get("own_parcel_spare_ac"))
        adj_text = scrub(row.get("same_owner_adjoining_ac"))
        site["spare_ac_own_text"] = own_text
        site["spare_ac_adjoining_text"] = adj_text
        own_num = first_number(row.get("own_parcel_spare_ac"))
        adj_num = first_number(row.get("same_owner_adjoining_ac"))
        if own_num is not None:
            site["spare_ac_own"] = own_num
        if adj_num is not None:
            site["spare_ac_adjoining"] = adj_num
        site["owner"] = scrub(row.get("owner_of_record")) or site["owner"]
        site["operating"] = scrub(row.get("operating"))
        site["evidence"] = scrub(row.get("evidence"))[:700]
        site["agreement"] = scrub(row.get("agreement"))
        label = str(row.get("label") or "")
        parsed = field_status_from_label(label)
        if "owner" not in parsed and site["owner"]:
            parsed.setdefault("owner", "verified" if "verified" in label.lower() else "inferred")
        parsed.setdefault("in_area", "verified")
        site["fields"] = {
            key: {"status": value, "source": "reconciliation final", "date": "2026-11-03"}
            for key, value in parsed.items()
        }
        site["confidence"] = confidence_from_fields(parsed)
        if muse_verdict and playbook and muse_verdict != playbook:
            site["verdict_disagreement"] = True
        if muse_verdict:
            note = scrub(row.get("muse_updated_v4"))[:400]
            verdict_rows.append(
                {
                    "site_id": sid,
                    "market": site["city"],
                    "name": site["name"],
                    "address": site["address"],
                    "apn": norm_apn(site.get("apn")),
                    "adjudicated_verdict": muse_verdict,
                    "spare_ac_own": "",
                    "spare_ac_same_owner_adjoining": "",
                    "operating_evidence": "",
                    "parcel_evidence": "",
                    "confidence": "",
                    "notes": note,
                    "aerial_verdict": "",
                    "land_verdict_provisional": "",
                    "operating_evidence_tier": "",
                    "retrieved_at": "2026-11-03",
                    "reviewer": "Muse",
                    "supersedes": "",
                    "source_file": "reconciliation muse column" if sid not in muse_override else "muse verdict file",
                }
            )
            site["reviews"].append(
                {
                    "reviewer": "Muse",
                    "kind": "county",
                    "verdict": muse_verdict,
                    "provisional": False,
                    "spare_ac_own": None,
                    "spare_ac_adjoining": None,
                    "confidence": "",
                    "date": "2026-11-03",
                    "note": note,
                }
            )
            crosswalk.append({"site_id": sid, "source": "muse_latest", "source_key": sid})
        if site["verdict"] in {"FAIL", "NOT_A_WASH"}:
            site["why_stopped"] = site["evidence"] or site["agreement"] or "County check did not clear this site."
        elif site["verdict"] == "UNRESOLVED":
            site["why_stopped"] = site["evidence"] or "A load-bearing fact is still missing."
        elif not site["in_area"]:
            if site["network_status"] == "held":
                site["why_stopped"] = "Outside the current service area. Kept as PASS and held for network expansion."
            elif site["expansion_horizon"]:
                site["why_stopped"] = "Inside the expansion horizon, outside the current service area."
            else:
                site["why_stopped"] = "Outside the current service area."
        verdict_rows.append(
            {
                "site_id": sid,
                "market": site["city"],
                "name": scrub(row.get("name")) or site["name"],
                "address": scrub(row.get("address")) or site["address"],
                "apn": norm_apn(row.get("apn")),
                "adjudicated_verdict": playbook or "",
                "spare_ac_own": own_num if own_num is not None else "",
                "spare_ac_same_owner_adjoining": adj_num if adj_num is not None else "",
                "operating_evidence": site["operating"],
                "parcel_evidence": site["evidence"],
                "confidence": site["confidence"],
                "notes": scrub(row.get("who_is_right"))[:400],
                "aerial_verdict": "",
                "land_verdict_provisional": "",
                "operating_evidence_tier": "",
                "retrieved_at": "2026-11-03",
                "reviewer": "Indie",
                "supersedes": "",
                "source_file": "reconciliation_final.xlsx",
            }
        )
        site["reviews"].append(
            {
                "reviewer": "Indie",
                "kind": "reconciliation",
                "verdict": playbook,
                "provisional": False,
                "spare_ac_own": own_num,
                "spare_ac_adjoining": adj_num,
                "confidence": site["confidence"],
                "date": "2026-11-03",
                "note": site["evidence"][:280] or site["agreement"],
                "tier_label": site["reconciliation_tier"],
            }
        )
        crosswalk.append({"site_id": sid, "source": "reconciliation_final", "source_key": sid})

    def attach_price(site, price, source, url, date, status):
        if price is None or site.get("asking_price"):
            return
        site["asking_price"] = price
        site["asking_price_display"] = money(price)
        site["asking_price_source"] = scrub(source)[:240]
        site["asking_price_url"] = url or ""
        if hasattr(date, "strftime"):
            date = date.strftime("%Y-%m-%d")
        site["asking_price_date"] = str(date or "")[:10]
        site["asking_price_status"] = status

    def match_universe(city: str, apn_value, address_text: str) -> str | None:
        for token in apn_tokens(apn_value):
            ids = by_apn.get((city, token), [])
            if ids:
                return sorted(ids, key=lambda sid: sid in duplicate_of)[0]
        sig = street_signature(address_text)
        if not sig:
            return None
        hits = []
        for site in sites:
            if site["city"] != city or site["origin"] != "universe":
                continue
            if street_signature(site["address"]) == sig or street_signature(site["name"]) == sig:
                hits.append(site["site_id"])
        if len(hits) == 1:
            return hits[0]
        return None

    def absorb_workbook_row(row: dict, kind: str):
        city = str(row.get("Market") or "").strip() or "UNK"
        label = str(row.get("Site") or "").strip()
        key = f"{kind}|{label}"
        assigned = registry_id(reg, "PIPE" if kind == "pipeline" else "LAND", key, city if city in {"LAS", "PHX", "MIA"} else "XX")
        matched = match_universe(city, row.get("APN or folio"), label)
        if matched:
            site = by_id[matched]
        else:
            site = blank_site(assigned, city)
            site["origin"] = kind
            site["name"] = scrub(row.get("Name") or label)
            site["address"] = scrub(label)
            site["apn"] = str(row.get("APN or folio") or "")
            blob = " ".join(str(row.get(col) or "") for col in ("Land evidence", "What we know", "Listing link"))
            coords = google_coords(blob)
            if coords:
                site["lon"], site["lat"] = coords
                site["coord_status"] = "known"
                site["street_view_url"] = (
                    f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={site['lat']},{site['lon']}"
                )
            site["county_url"] = county_url(city, site["apn"], site["address"])
            sites.append(site)
            by_id[site["site_id"]] = site
        stage = str(row.get("Stage") or "").strip()
        site["pipeline_stage"] = scrub(stage)
        site["pipeline_id"] = assigned
        if kind == "land":
            site["on_land_tab"] = True
            # A census site that also appears on the land tab stays in the universe.
            # Only rows that exist solely on that tab are land-only.
            if not matched:
                site["land_only"] = True
            site["site_class"] = site["site_class"] if site["origin"] == "universe" else "Land"
        price = parse_price(row.get("Asking price ($)"))
        source_bits = [str(row.get("Broker") or "").strip(), str(row.get("Source of the numbers") or "").strip()]
        source = "; ".join(bit for bit in source_bits if bit)
        url = str(row.get("Listing link") or "").strip()
        status = "verified" if url else ("inferred" if price else None)
        attach_price(site, price, source or "Pipeline workbook", url, row.get("Last checked live"), status)
        if str(row.get("Listing status") or "").strip() == "Listed":
            site["listed"] = True
        if contacted_from_stage(stage):
            site["contacted"] = True
        crosswalk.append({"site_id": site["site_id"], "source": "Pipeline" if kind == "pipeline" else "Land Sites", "source_key": label})

    for row in pipeline_rows:
        absorb_workbook_row(row, "pipeline")
    for row in land_rows:
        absorb_workbook_row(row, "land")

    for site in sites:
        listing = best_listing(site["site_id"])
        if not listing:
            continue
        site["listed"] = True
        attach_price(
            site,
            listing["_price"],
            listing.get("broker") or listing.get("source") or "Listing match",
            listing.get("url") or "",
            "",
            "verified" if listing.get("url") else "inferred",
        )

    incoming_stats = apply_incoming(incoming, by_id, verdict_rows, crosswalk)

    for site in sites:
        if site.get("expansion_horizon"):
            site["network_status"] = "held"
        explicit_reason = site.get("elimination_reason") or ""
        site["elimination_reason"] = explicit_reason or elimination_reason(site)
        site["tenure_fail"] = is_tenure_fail(site)
        if site.get("verdict"):
            site["verification"] = "county-checked"
        elif site.get("aerial_fit"):
            site["verification"] = "aerial only, pending verification"
        else:
            site["verification"] = "not screened"
        if site.get("verdict") and not site.get("land_tier"):
            derived = tier_from_acres(site.get("spare_ac_own"), site.get("spare_ac_adjoining"))
            if derived:
                site["land_tier"] = derived
        eliminated = site.get("verdict") == "NOT_A_WASH"
        land_fit = site.get("land_tier") in {"L10", "L4"}
        # An in-area PASS stays a candidate even when the aerial file had no FIT code.
        keep_pass = site.get("verdict") == "PASS"
        site["is_candidate"] = bool(
            site["counts_as_site"]
            and not site["land_only"]
            and site["in_area"]
            and (land_fit or keep_pass)
            and not eliminated
            and not site["tenure_fail"]
        )
        site["is_held_fit"] = bool(
            site["counts_as_site"]
            and not site["land_only"]
            and site.get("expansion_horizon")
            and (land_fit or keep_pass)
            and not eliminated
            and not site["tenure_fail"]
        )
        if site["duplicate_of"]:
            site["why_stopped"] = f"Duplicate of {site['duplicate_of']} (same parcel). Counted once."
        elif eliminated:
            site["why_stopped"] = "Not a wash (" + site["elimination_reason"] + ")."
        elif site["tenure_fail"]:
            site["why_stopped"] = "County verdict is FAIL on tenure. Tenure is otherwise only a flag."
        elif site["is_held_fit"]:
            site["why_stopped"] = "Outside the operative service area. Held for network expansion."
        elif site["origin"] == "universe" and not site["in_area"]:
            site["why_stopped"] = "Outside the operative service area."

    # Funnel numbers use records that count as a site.
    countable = [site for site in sites if site["counts_as_site"] and site["origin"] == "universe"]
    in_area = [site for site in countable if site["in_area"]]
    checked = [site for site in countable if site.get("verdict")]
    candidates = [site for site in countable if site["is_candidate"]]
    held_fits = [site for site in countable if site["is_held_fit"]]

    def by_city(rows):
        return {city: sum(1 for row in rows if row["city"] == city) for city in ("LAS", "PHX", "MIA")}

    verdict_groups = {}
    for verdict in ("PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED"):
        rows = [site for site in checked if site["verdict"] == verdict]
        verdict_groups[verdict] = {
            "total": len(rows),
            "by_city": by_city(rows),
            "by_class": class_breakdown(rows),
            "ids": [site["site_id"] for site in rows],
        }
    held = [site for site in checked if site.get("network_status") == "held"]
    cleared = [site for site in checked if site.get("verdict") == "PASS" and site.get("network_status") == "cleared"]
    listed_candidates = [site for site in candidates if site["listed"]]
    contacted_candidates = [site for site in candidates if site["contacted"]]
    contacted_any = [site for site in sites if site["contacted"] and site["counts_as_site"]]
    l10 = [site for site in in_area if site.get("land_tier") == "L10"]
    l4 = [site for site in in_area if site.get("land_tier") == "L4"]
    land_fits = l10 + l4
    checked_fits = [site for site in land_fits if site["verification"] == "county-checked"]
    pending_fits = [site for site in land_fits if site["verification"] != "county-checked"]
    eliminated = [site for site in in_area if site.get("verdict") == "NOT_A_WASH"]

    funnel = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "muse_reference": {
            "in_area_sites": 1043,
            "by_city": {"LAS": 179, "PHX": 254, "MIA": 610},
            "note": "Muse reference for the service-area step. The map shows our screen, not this reference.",
            "unique_sites": 1640,
            "verdict": {"PASS": 10, "MAYBE": 21, "FAIL": 21, "NOT_A_WASH": 11, "UNRESOLVED": 2},
        },
        "stages": [
            {
                "id": "census",
                "name": "Census rows",
                "unit": "rows",
                "total": census["total"],
                "by_city": census["by_city"],
                "note": "Workbook Universe tab. A census union, not a count of operating businesses. The map draws the deduped site records, which are fewer than the row count.",
            },
            {
                "id": "unique",
                "name": "Unique sites",
                "unit": "sites",
                "total": len(countable),
                "by_city": by_city(countable),
                "by_class": class_breakdown(countable),
                "note": (
                    f"Universe file has {len(universe)} site records. "
                    f"Same-parcel pairs counted once: "
                    + (
                        ", ".join(f"{dup} with {keep}" for dup, keep in sorted(duplicate_of.items()))
                        or "none"
                    )
                    + ". Muse's reference is about 1,640."
                ),
            },
            {
                "id": "in_area",
                "name": "In service area",
                "unit": "sites",
                "total": len(in_area),
                "by_city": by_city(in_area),
                "by_class": class_breakdown(in_area),
                "by_city_class": city_class(in_area),
                "note": "LAS operative area is the 100 ring with the core inside it. The 200 and 300 rings are the expansion horizon and count as outside. Muse's reference is 1,043 (LV 179 / PHX 254 / MIA 610). This map shows our screen.",
            },
            {
                "id": "land_tier",
                "name": "Land tier",
                "unit": "sites",
                "total": len(l10) + len(l4),
                "L10": {"total": len(l10), "by_city": by_city(l10), "county_checked": sum(1 for s in l10 if s["verification"] == "county-checked"), "ids": [s["site_id"] for s in l10]},
                "L4": {"total": len(l4), "by_city": by_city(l4), "county_checked": sum(1 for s in l4 if s["verification"] == "county-checked"), "ids": [s["site_id"] for s in l4]},
                "eliminated_not_a_wash": {
                    "total": len(eliminated),
                    "by_reason": dict(Counter(s["elimination_reason"] or "not categorised in the file" for s in eliminated)),
                    "ids": [s["site_id"] for s in eliminated],
                },
                "held_fits": {"total": len(held_fits), "L10": sum(1 for s in held_fits if s["land_tier"] == "L10"), "L4": sum(1 for s in held_fits if s["land_tier"] == "L4")},
                "note": "L10 is at least 10,000 sq ft of spare land and L4 is at least 4,000 sq ft. Aerial FIT codes are used when the screening tab has them. A county-checked site with no aerial code takes its tier from the county spare measurement. In-area PASS sites stay in the candidate set. Held fits sit only in the Las Vegas 200 or 300 ring.",
            },
            {
                "id": "verified",
                "name": "Verified",
                "unit": "sites",
                "total": len(land_fits),
                "county_checked": len(checked_fits),
                "pending": len(pending_fits),
                "by_city_checked": by_city(checked_fits),
                "by_city_pending": by_city(pending_fits),
                "note": "Among in-area L10 and L4. County-checked sites have a verdict and evidence. The rest are aerial only, pending verification. New verdict files dropped in data/source/incoming are picked up on the next data build.",
            },
            {
                "id": "verdict",
                "name": "Verdict split",
                "unit": "sites",
                "total": len(checked_fits),
                "by_city": by_city(checked_fits),
                "outcomes": {
                    verdict: {
                        "total": sum(1 for s in checked_fits if s["verdict"] == verdict),
                        "by_city": by_city([s for s in checked_fits if s["verdict"] == verdict]),
                        "ids": [s["site_id"] for s in checked_fits if s["verdict"] == verdict],
                    }
                    for verdict in ("PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED")
                },
                "all_county_checked": len(checked),
                "note": "Verdicts for the county-checked in-area land fits. The full reconciliation file still has "
                + str(len(checked))
                + " county-checked sites, including ones that are not L10 or L4. Same-owner adjoining stays MAYBE on the playbook scale. Tenure is a flag unless the verdict itself is FAIL on tenure.",
            },
            {
                "id": "listed",
                "name": "Of which listed",
                "unit": "sites",
                "total": len(listed_candidates),
                "by_city": by_city(listed_candidates),
                "of": len(candidates),
                "note": "Split of the in-area L10 and L4 sites that are not eliminated. Off-market rows are not listed. Nobody drops at this step.",
            },
            {
                "id": "contacted",
                "name": "Of which contacted",
                "unit": "sites",
                "total": len(contacted_candidates),
                "pipeline_any": len(contacted_any),
                "by_city": by_city(contacted_candidates),
                "of": len(candidates),
                "note": "Contacted means Pipeline stage 2 or later. Stage 0 and stage 1 are not contacted. The workbook currently has only stages 0, 1, and Dropped, so this count is 0.",
            },
        ],
        "candidates": {
            "definition": "In-area L10 and L4 sites that are not eliminated as not-a-wash and are not a tenure FAIL. Held L10 and L4 sites are a separate group.",
            "ids": [site["site_id"] for site in candidates],
            "held_ids": [site["site_id"] for site in held_fits],
        },
    }

    warnings = []
    if census["total"] != 1701:
        warnings.append(f"Census row count is {census['total']}, workbook expectation was 1,701.")
    if by_city(in_area) != {"LAS": 182, "PHX": 251, "MIA": 608}:
        warnings.append(f"In-area city split is {by_city(in_area)}, expected LV 182 / PHX 251 / MIA 608.")
    if len(l10) != 25 or len(l4) != 48:
        warnings.append(
            f"In-area land tiers are L10 {len(l10)} (county-checked {sum(1 for s in l10 if s['verification']=='county-checked')}) "
            f"and L4 {len(l4)} (county-checked {sum(1 for s in l4 if s['verification']=='county-checked')}). "
            "The brief expected about 25 L10 and about 48 L4, with all L10 county-checked and about 3 of the L4 county-checked."
        )
    if screening["conflicts"]:
        warnings.append(f"Screening rows with more than one aerial verdict for the same parcel: {len(screening['conflicts'])}.")
    if len(contacted_any) != 0:
        warnings.append(f"Contacted count is {len(contacted_any)}, expected 0 with the current stages.")
    if len(pipeline_rows) != 79:
        warnings.append(
            f"Pipeline tab has {len(pipeline_rows)} rows (stages {dict(Counter(str(r.get('Stage')) for r in pipeline_rows))}). The older note of 79 is not in this export."
        )
    if muse_file and len(muse_override) == 0:
        warnings.append("The muse verdict file was set but no site rows were read.")
    for sid in ("PHX-U644", "PHX-U646"):
        site = by_id.get(sid)
        if site:
            warnings.append(f"{sid} in_area={site['in_area']} (screening-tab boundary note in the plan).")

    areas_fc = {"type": "FeatureCollection", "features": areas}
    depots = build_depots()
    parcels, parcel_meta = ([], {"counts": {}, "note": "Parcel fetch skipped."})
    if write:
        parcels, parcel_meta = build_parcels(sites, refresh_parcels)

    site_features = []
    for site in sites:
        geom = None
        if site["lat"] is not None and site["lon"] is not None:
            geom = {"type": "Point", "coordinates": [site["lon"], site["lat"]]}
        props = {k: v for k, v in site.items() if k not in {"lat", "lon"}}
        site_features.append({"type": "Feature", "geometry": geom, "properties": props})
    sites_fc = {"type": "FeatureCollection", "features": site_features}
    parcels_fc = {"type": "FeatureCollection", "features": parcels}

    problems = []
    for blob in (sites_fc, areas_fc, depots, funnel):
        problems.extend(scan_obj(blob))
    if problems:
        raise SystemExit("Banned or forbidden content in generated data:\n" + "\n".join(problems[:30]))

    report = {
        "generated_at": funnel["generated_at"],
        "census_rows": census,
        "unique_site_records": len([s for s in sites if s["origin"] == "universe"]),
        "unique_sites_counted": len(countable),
        "same_parcel_collapsed": duplicate_of,
        "in_area": {"total": len(in_area), "by_city": by_city(in_area), "by_class": class_breakdown(in_area)},
        "muse_in_area_reference": funnel["muse_reference"],
        "land_tiers": {
            "L10": len(l10),
            "L4": len(l4),
            "L10_checked": sum(1 for s in l10 if s["verification"] == "county-checked"),
            "L4_checked": sum(1 for s in l4 if s["verification"] == "county-checked"),
            "pending": len(pending_fits),
            "eliminated_not_a_wash": len(eliminated),
            "held_fits": len(held_fits),
            "screening_rows": screening["row_count"],
            "screening_matched_sites": screening_matched,
            "incoming": incoming_stats,
        },
        "verdicts": {key: value["total"] for key, value in verdict_groups.items()},
        "verdicts_on_land_fits": {verdict: sum(1 for s in checked_fits if s["verdict"] == verdict) for verdict in ("PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED")},
        "pass_cleared": [site["site_id"] for site in cleared],
        "pass_held": [site["site_id"] for site in checked if site.get("verdict") == "PASS" and site.get("network_status") == "held"],
        "maybe_ids": verdict_groups["MAYBE"]["ids"],
        "listed_of_candidates": len(listed_candidates),
        "contacted_of_candidates": len(contacted_candidates),
        "contacted_any": len(contacted_any),
        "pipeline_rows": len(pipeline_rows),
        "land_rows": len(land_rows),
        "pipeline_stage_counts": dict(Counter(str(row.get("Stage")) for row in pipeline_rows)),
        "land_stage_counts": dict(Counter(str(row.get("Stage")) for row in land_rows)),
        "sites_without_coordinates": [
            site["site_id"] for site in sites if site["coord_status"] != "known" and site["counts_as_site"]
        ],
        "disagreements": [site["site_id"] for site in sites if site["verdict_disagreement"]],
        "acreage_notes": [site["site_id"] for site in sites if site["acreage_note"]],
        "scale_notes": [site["site_id"] for site in sites if site["scale_note"]],
        "parcels": parcel_meta,
        "muse_source": muse_file or "reconciliation muse column",
        "warnings": warnings,
        "skipped": [
            "Aerial-screen stages (the old 92 / 92 / 78 counts) are not funnel steps.",
            "Nightly workbook sync is not wired; drop a new export in data/source and rerun this script.",
            "Full in-area parcel pull was not done. Outlines are limited to county-checked sites whose county service answered.",
            "Broward parcel geometry is unavailable: the county host did not resolve.",
            "Same-owner adjoining parcel polygons are not in the source bundle.",
            "The 75–250 m review band was not recomputed. The one same-parcel pair found by APN is flagged.",
            "Edge-band distance to the polygon was not recomputed.",
            "Outreach drafts are not loaded.",
            "Human verdict write-back is a later version and is not in this app.",
        ],
    }

    if write:
        OUT.mkdir(parents=True, exist_ok=True)
        PARCEL_CACHE.parent.mkdir(parents=True, exist_ok=True)
        (OUT / "sites.geojson").write_text(json.dumps(sites_fc))
        (OUT / "areas.geojson").write_text(json.dumps(areas_fc))
        (OUT / "depots.geojson").write_text(json.dumps(depots))
        (OUT / "parcels.geojson").write_text(json.dumps(parcels_fc))
        (OUT / "funnel.json").write_text(json.dumps(funnel, indent=2))
        (OUT / "build_report.json").write_text(json.dumps(report, indent=2))
        with (OUT / "crosswalk.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["site_id", "source", "source_key"])
            writer.writeheader()
            writer.writerows(crosswalk)
        REGISTRY.write_text(json.dumps(reg, indent=2))
        appended = append_verdicts(verdict_rows)
        write_verdicts(appended["rows"])
        report["verdicts_appended"] = appended["added"]
        report["verdicts_total"] = appended["total"]
        (OUT / "build_report.json").write_text(json.dumps(report, indent=2))
        if PARCEL_CACHE.exists() or True:
            # cache is updated inside build_parcels via the dict; persist it
            pass
        # persist cache written by build_parcels through the module global updated below
        save_parcel_cache_from_last()
    return report


LAST_CACHE = None


def save_parcel_cache_from_last():
    if LAST_CACHE is None:
        return
    PARCEL_CACHE.parent.mkdir(parents=True, exist_ok=True)
    PARCEL_CACHE.write_text(json.dumps(LAST_CACHE))


def build_parcels(sites: list[dict], refresh: bool) -> tuple[list[dict], dict]:
    global LAST_CACHE
    cache = {} if refresh else load_parcel_cache()
    wanted = []
    for site in sites:
        if not site.get("verdict") or site.get("duplicate_of"):
            continue
        key = f"{site['city']}|{site['site_id']}"
        wanted.append((key, site))
    features = []
    stats = Counter()
    todo = []
    for key, site in wanted:
        if key in cache and not refresh:
            cached = cache[key]
            if cached:
                features.append(parcel_feature(site, cached))
                stats["cache_hit"] += 1
            else:
                stats["cache_miss_empty"] += 1
            continue
        todo.append((key, site))

    def job(item):
        key, site = item
        if site["city"] == "MIA" and looks_broward(site.get("address") or ""):
            return key, None, "broward_unavailable"
        found = fetch_parcel(site["city"], site.get("apn") or "", site.get("address") or "")
        return key, found, "fetched" if found else "not_found"

    if todo:
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(job, item) for item in todo]
            for fut in as_completed(futures):
                key, found, label = fut.result()
                cache[key] = found
                stats[label] += 1
                if found:
                    site = next(s for k, s in wanted if k == key)
                    features.append(parcel_feature(site, found))
    LAST_CACHE = cache
    stats["features"] = len(features)
    return features, {"counts": dict(stats), "note": parcel_note(stats)}


def build_depots() -> dict:
    rows = load_csv(SRC / "depots.csv")
    features = []
    for row in rows:
        status = (row.get("status") or "operating").strip().lower()
        if status not in {"operating", "planned", "candidate"}:
            status = "operating"
        confidence = (row.get("confidence") or "low").strip().lower()
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(row["lon"]), float(row["lat"])],
                },
                "properties": {
                    "id": row["depot_id"],
                    "address": scrub(row.get("name_address")),
                    "city": row["city"],
                    "status": status,
                    "confidence": confidence,
                },
            }
        )
    fc = {"type": "FeatureCollection", "features": features}
    problems = scan_obj(fc)
    if problems:
        raise SystemExit("Depot output failed the wording check:\n" + "\n".join(problems))
    return fc


def check_against_report(report: dict) -> None:
    committed = json.loads((OUT / "build_report.json").read_text())
    keys = ("in_area", "land_tiers", "verdicts", "pass_held", "contacted_of_candidates", "census_rows")
    mismatches = []
    for key in keys:
        if committed.get(key) != report.get(key):
            mismatches.append(key)
    problems = []
    for name in ("sites.geojson", "areas.geojson", "depots.geojson", "parcels.geojson", "funnel.json"):
        problems.extend(scan_obj(json.loads((OUT / name).read_text()), name))
    if mismatches or problems:
        raise SystemExit(
            "Data check failed.\n"
            + (f"Re-run scripts/build_data.py; stale sections: {mismatches}\n" if mismatches else "")
            + "\n".join(problems[:20])
        )


def main():
    parser = argparse.ArgumentParser(description="Build map data from data/source")
    parser.add_argument("--check", action="store_true", help="Rebuild in memory and compare to committed data")
    parser.add_argument("--refresh-parcels", action="store_true")
    parser.add_argument("--muse-verdicts", default=os.environ.get("MUSE_VERDICTS_FILE") or None)
    args = parser.parse_args()
    if args.check:
        report = build(write=False, refresh_parcels=False, muse_file=args.muse_verdicts)
        check_against_report(report)
        print("Data check passed.")
        return
    report = build(write=True, refresh_parcels=args.refresh_parcels, muse_file=args.muse_verdicts)
    print(json.dumps({k: report[k] for k in ("in_area", "land_tiers", "verdicts_on_land_fits", "listed_of_candidates", "contacted_of_candidates", "warnings")}, indent=2))


if __name__ == "__main__":
    main()
