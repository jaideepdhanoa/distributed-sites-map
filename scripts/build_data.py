#!/usr/bin/env python3
"""Rebuild app data from data/source into data/generated.

Re-runnable. Verdict rows are append-only. Site ids already in the census are
kept; new pipeline and land rows get stable ids stored in data/id_registry.json.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
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
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts.key_numbers import FIGURE_FIELDS, key_figures, listing_gone
from scripts.nda import nda_mirror_fields
from scripts.site_photos import index_photos, load_site_photos, photo_fields
from scripts.timeline_drive import folder_id_from_row, folder_url_for

SRC = ROOT / "data" / "source"
OUT = ROOT / "data" / "generated"
VERDICTS = ROOT / "data" / "verdicts" / "verdicts.csv"
REGISTRY = ROOT / "data" / "id_registry.json"
PARCEL_CACHE = ROOT / "data" / "cache" / "parcel_cache.json"

KML_NS = {"k": "http://www.opengis.net/kml/2.2"}

# Financial fields stay off the public card payload. Display terms do not.
FORBIDDEN_KEYS = {
    "ebitda",
    "revenue",
    "most_can_pay",
}

AREA_NAMES = {
    "vegas_core_~50": ("las-core", "LAS core", "service", "LAS"),
    "vegas_100": ("las-100", "LAS service area", "service", "LAS"),
    "vegas_200": ("las-200", "LAS expansion horizon", "expansion", "LAS"),
    "vegas_300": ("las-300", "LAS expansion horizon", "expansion", "LAS"),
    "phx_2026_v5": ("phx-service", "PHX service area", "service", "PHX"),
    "polygon 1": ("mia-current", "MIA service area", "service", "MIA"),
    "launch odd": ("mia-launch", "MIA launch area", "service", "MIA"),
    "extended odd": ("mia-extended", "MIA extended area", "expansion", "MIA"),
    "ft lauderdale": ("mia-pri-ftl", "MIA priority area", "expansion", "MIA"),
    "highland lakes": ("mia-pri-hl", "MIA priority area", "expansion", "MIA"),
    "fontainebleau": ("mia-pri-fb", "MIA priority area", "expansion", "MIA"),
    "mid-2027 northern odd boundary": ("mia-future", "MIA future boundary", "expansion", "MIA"),
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

# Pins north of this are outside the Miami-Dade parcel layer. Broward is the
# assessor layer there. The cutoff matches the old "outside Miami-Dade" miss.
BROWARD_NORTH_OF = 25.98
BROWARD_PARCEL_QUERY = (
    "https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/"
    "PARCEL_POLY_BCPA_TAXROLL/FeatureServer/0/query"
)
BROWARD_PARCEL_FIELDS = "FOLIO,GIS_SQUARE_FOOT,NAME_LINE_1"

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


def neutral_author(value) -> str:
    token = str(value or "").strip().lower()
    if token in {"indie", "county check"}:
        return "county check"
    if token in {"muse", "second review"}:
        return "second review"
    return str(value or "").strip()


def neutral_source(value) -> str:
    text = str(value or "")
    text = text.replace("reconciliation muse column", "second review column")
    text = text.replace("muse verdict file", "second review file")
    return text


def scrub(value) -> str:
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"(?i)\bodd\b", "service area", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return text.strip(" ,;:-")


# Site-card notes. Agent names and process language are not for the reader.
NOTE_FIELDS = (
    "evidence",
    "why_stopped",
    "elimination_reason",
    "scale_note",
    "acreage_note",
    "agreement",
    "operating",
    "spare_ac_own_text",
    "spare_ac_adjoining_text",
)
_NOTE_INTERNAL = re.compile(
    r"(?i)("
    r"\b(?:muse|torque|indie|grok)\b"
    r"|\blive\b"
    r"|rounding"
    r"|source diff"
    r"|\bscreens?\b"
    r"|\bscreening\b"
    r"|aerial claim"
    r"|\bFIT_?\d+\b"
    r"|\brender\b"
    r"|\bplaybook\b"
    r"|\bv\d\b"
    r"|/workspace"
    r"|\b[\w.-]+\.(?:jpe?g|xlsx|csv|md)\b"
    r")"
)
_NOTE_FILE = re.compile(
    r"(?i)(?:/[\w./-]+\.(?:jpe?g|xlsx|csv|md))|(?:\br_[\w.-]+\.jpe?g)|(?:\b[\w.-]+\.(?:jpe?g|xlsx|csv|md)\b)"
)

# Exact source sentences, plus the plain line a reader should see.
def _rewrite_paths() -> list[Path]:
    # Committed map configuration. A copy under data/source still works for a local build.
    return [ROOT / "data" / "note_rewrites.json", SRC / "note_rewrites.json"]


def _load_rewrites(kind: str) -> dict:
    for path in _rewrite_paths():
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        table = payload.get(kind) or {}
        if isinstance(table, dict):
            return table
    return {}


EXPLICIT_NOTES = _load_rewrites("notes")

def plain_note(value) -> str:
    """Turn one site-card note into plain language. Explicit lines win; the rest is stripped."""
    text = scrub(value)
    if not text:
        return ""
    if text in EXPLICIT_NOTES:
        return EXPLICIT_NOTES[text]
    for src, dst in sorted(EXPLICIT_NOTES.items(), key=lambda item: len(item[0]), reverse=True):
        if len(text) >= 48 and (src.startswith(text) or text.startswith(src)):
            return dst
    cleaned = _NOTE_FILE.sub("", text)

    def drop_debug(match: re.Match) -> str:
        chunk = match.group(0)
        if _NOTE_INTERNAL.search(chunk) or _NOTE_FILE.search(chunk):
            return ""
        return chunk

    cleaned = re.sub(r"\([^)]*\)", drop_debug, cleaned)
    cleaned = _NOTE_INTERNAL.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
    cleaned = re.sub(r"(?:\s*[,;]\s*){2,}", ", ", cleaned)
    return strip_stall(cleaned).strip(" ,;:-")


def strip_stall(text: str) -> str:
    """Keep stall wording. The map is private to the team."""
    return re.sub(r"\s+", " ", text or "").strip()


def _title_if_shouting(text: str) -> str:
    letters = [char for char in text if char.isalpha()]
    if letters and all(char.isupper() for char in letters):
        return text.title()
    return text


def display_name_parts(raw: str) -> tuple[str, list[str]]:
    """One business name, plus the other names a reader might search for."""
    pieces = []
    for piece in re.split(r"\s*\|\s*", raw or ""):
        piece = re.sub(r"(?i)\([^)]*(?:=|fuel|car_wash)[^)]*\)", " ", piece)
        piece = re.sub(r"(?i)\bcar_wash\s*=\s*\w+\b", " ", piece)
        piece = re.sub(r"\s+", " ", piece).strip(" -.,")
        if not piece:
            continue
        pieces.append(_title_if_shouting(piece))

    def key(value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", value.lower())

    kept: list[str] = []
    for piece in pieces:
        token = key(piece)
        if not token:
            continue
        if any(token == key(existing) or token in key(existing) for existing in kept):
            continue
        kept = [existing for existing in kept if key(existing) not in token]
        kept.append(piece)

    def score(value: str) -> tuple:
        low = value.lower()
        return (
            1 if re.search(r"car\s*wash|carwash", low) else 0,
            1 if re.search(r"#\s*\d+|\b\d{2,}\b", value) else 0,
            len(value),
        )

    if not kept:
        return "", []
    best = max(kept, key=score)
    alternates = [piece for piece in kept if key(piece) != key(best)]
    return best, alternates


def summary_why(site: dict) -> str:
    """One or two plain sentences from the verdict and the spare-land numbers."""

    def acres(value) -> str:
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            return ""
        rounded = round(float(value), 1)
        if rounded <= 0:
            return ""
        return f"{rounded:.1f}".rstrip("0").rstrip(".")

    own = acres(site.get("spare_ac_own"))
    adjoining = acres(site.get("spare_ac_adjoining"))
    verdict = site.get("verdict")
    if verdict == "PASS":
        if own and adjoining:
            text = f"County check confirmed about {own} ac of spare land on the parcel, plus about {adjoining} ac on adjoining land with the same owner."
        elif own:
            text = f"County check confirmed about {own} ac of spare land on the parcel."
        elif adjoining:
            text = f"County check confirmed about {adjoining} ac of spare land on adjoining land with the same owner."
        else:
            text = "County check confirmed spare land on the parcel."
        if site.get("network_status") == "held" or not site.get("in_area"):
            text += " It sits outside the current service area."
    elif verdict == "MAYBE":
        text = f"County check found about {own} ac of spare land. It needs a closer look." if own else "County check found borderline spare land. It needs a closer look."
    elif verdict == "FAIL":
        text = "Not enough spare land on the parcel."
    elif verdict == "NOT_A_WASH":
        text = "This place is not operating as a car wash."
    elif verdict == "UNRESOLVED":
        text = "A key fact is still missing, so the county check is not finished."
    elif site.get("land_tier"):
        text = "Imagery suggests there is spare land. County records have not been checked."
    else:
        text = "Not screened yet."
    return text[:200]


def sanitize_site_notes(site: dict) -> int:
    changed = 0
    for key in NOTE_FIELDS:
        current = site.get(key)
        if not isinstance(current, str) or not current:
            continue
        rewritten = trim_restated_facts(plain_note(current))
        if rewritten != current:
            site[key] = rewritten
            changed += 1
        if _NOTE_INTERNAL.search(site.get(key) or ""):
            raise SystemExit(f"Note still has internal wording on {site.get('site_id')} {key}: {site.get(key)[:180]!r}")
    for review in site.get("reviews") or []:
        if not isinstance(review, dict):
            continue
        author = neutral_author(review.get("reviewer") or "")
        if author != (review.get("reviewer") or ""):
            review["reviewer"] = author
            changed += 1
        current = review.get("note")
        if not isinstance(current, str) or not current:
            continue
        rewritten = trim_restated_facts(plain_note(current))
        if rewritten != current:
            review["note"] = rewritten
            changed += 1
        if _NOTE_INTERNAL.search(review.get("note") or ""):
            raise SystemExit(f"Review note still has internal wording on {site.get('site_id')}: {review.get('note')[:180]!r}")
    return changed


def trim_restated_facts(text: str) -> str:
    """Drop sentences that only repeat the lot size or the owner already shown on the card."""
    kept = []
    for piece in re.split(r"(?<=[.!?])\s+", text or ""):
        sentence = piece.strip()
        if not sentence:
            continue
        if re.match(r"(?i)^the lot is [\d.,]+ ac\.?$", sentence):
            continue
        if re.match(r"(?i)^owner: .+\.?$", sentence):
            continue
        kept.append(sentence)
    return " ".join(kept).strip()


def site_note_problems(props: dict) -> list[str]:
    problems = []
    sid = props.get("site_id") or "?"
    for key in NOTE_FIELDS:
        text = props.get(key) or ""
        if isinstance(text, str) and _NOTE_INTERNAL.search(text):
            problems.append(f"{sid} {key}: {text[:140]!r}")
    for review in props.get("reviews") or []:
        if not isinstance(review, dict):
            continue
        text = review.get("note") or ""
        if isinstance(text, str) and _NOTE_INTERNAL.search(text):
            problems.append(f"{sid} review: {text[:140]!r}")
        author = str(review.get("reviewer") or "")
        if re.search(r"(?i)\b(muse|indie|torque)\b", author):
            problems.append(f"{sid} reviewer: {author}")
    return problems


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


_DIR_WORDS = (
    ("northeast", "ne"),
    ("northwest", "nw"),
    ("southeast", "se"),
    ("southwest", "sw"),
    ("north", "n"),
    ("south", "s"),
    ("east", "e"),
    ("west", "w"),
)


def loose_street_keys(value: str) -> list[str]:
    """House number plus the street token. City names stay, so Chandler Blvd still matches.

    A trailing ZIP is removed. A 5-digit house number is kept. Store numbers such as
    "#262 6111 W Sahara" yield the street, not the store number.
    """
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    text = re.sub(r"\b(az|nv|fl|arizona|nevada|florida)\b", " ", text)
    text = re.sub(r"(?<=\s)\d{5}\b", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    for word, short in _DIR_WORDS:
        text = re.sub(rf"\b{word}\b", short, text)
    lettered: list[str] = []
    numeric: list[str] = []
    for match in re.finditer(r"(\d+)\s+((?:ne|nw|se|sw|n|s|e|w)\s+)?([a-z0-9]+)", text):
        name = re.sub(r"^(\d+)(?:st|nd|rd|th)$", r"\1", match.group(3))
        key = f"{match.group(1)} {name}"
        bucket = numeric if name.isdigit() else lettered
        if key not in bucket:
            bucket.append(key)
    return lettered or numeric


def loose_street_key(value: str) -> str:
    keys = loose_street_keys(value)
    return keys[0] if keys else ""


def street_signature(value: str) -> str:
    return loose_street_key(value)


def apn_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    text = str(value).strip()
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".")[0]
    return text


COUNTY_VERDICT = {
    "pass": "PASS",
    "maybe": "MAYBE",
    "fail": "FAIL",
    "not a car wash": "NOT_A_WASH",
    "unresolved": "UNRESOLVED",
}


def load_universe_rows(path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Universe"]
    cursor = ws.iter_rows(values_only=True)
    header = [str(cell).strip() if cell is not None else "" for cell in next(cursor)]
    out = []
    for excel_row, row in enumerate(cursor, start=2):
        if not row or not any(row[:8]):
            continue
        item = {"_excel_row": excel_row}
        for index, key in enumerate(header):
            if key and index < len(row):
                item[key] = row[index]
        out.append(item)
    wb.close()
    return out


def _universe_geocode_query(address: str, city_name: str, market: str) -> str:
    text = re.sub(r"\s+", " ", address or "").strip()
    if not text:
        return ""
    if re.search(r"\b(AZ|NV|FL)\b", text):
        return text
    local = (city_name or "").strip()
    if not local or "unincorporated" in local.lower():
        local = {"PHX": "Maricopa County", "LAS": "Clark County", "MIA": "Miami-Dade County"}.get(market, "")
    state = {"PHX": "AZ", "LAS": "NV", "MIA": "FL"}.get(market, "")
    return f"{text}, {local}, {state}".strip(", ")


def apply_live_universe(
    rows: list[dict],
    sites: list[dict],
    by_id: dict,
    by_apn: dict,
    blank_site,
    screening: dict,
    verdict_rows: list,
    crosswalk: list,
) -> dict:
    """One counted workbook row is one site. Service area and the county verdict come from that row.

    The census file still supplies the pin, the parcel, and the aerial review when a row matches.
    A second row for a parcel already used, and any row that does not match, becomes its own site.
    Rows the workbook does not count drop out of the unique total.
    """
    by_apn_site: dict[tuple[str, str], list[str]] = defaultdict(list)
    by_street: dict[tuple[str, str], list[str]] = defaultdict(list)
    for site in sites:
        if site.get("origin") != "universe":
            continue
        for token in apn_tokens(site.get("apn")):
            by_apn_site[(site["city"], token)].append(site["site_id"])
        for key in loose_street_keys(site.get("address") or ""):
            by_street[(site["city"], key)].append(site["site_id"])

    claimed: set[str] = set()
    yes_ids: set[str] = set()
    seq: Counter = Counter()
    fresh = 0
    matched = 0
    geocode_cache = json.loads(GEOCODE_CACHE.read_text()) if GEOCODE_CACHE.exists() else {}

    def claim(city: str, apn_value, address: str) -> tuple[str | None, str | None]:
        seen: list[str] = []
        for token in apn_tokens(apn_value):
            for sid in by_apn_site.get((city, token), []):
                if sid not in seen:
                    seen.append(sid)
        free = [sid for sid in seen if sid not in claimed]
        if free:
            return sorted(free)[0], None
        twin = seen[0] if seen else None
        for key in loose_street_keys(address):
            pool: list[str] = []
            for sid in by_street.get((city, key), []):
                if sid not in pool:
                    pool.append(sid)
            free = [sid for sid in pool if sid not in claimed]
            if len(free) == 1:
                return free[0], twin
            if twin is None and pool:
                twin = pool[0]
        return None, twin

    def paint(site: dict, row: dict, *, is_new: bool) -> None:
        site["counts_as_site"] = True
        site["duplicate_of"] = None
        site["origin"] = "universe"
        if is_new:
            site["name"] = scrub(row.get("Business name"))
            site["address"] = scrub(row.get("Address"))
            site["apn"] = apn_text(row.get("APN"))
            site["site_class"] = site_class(str(row.get("Site class") or ""))
            site["county_url"] = county_url(site["city"], site["apn"], site["address"])
        elif not site.get("apn"):
            site["apn"] = apn_text(row.get("APN"))
        owner = scrub(row.get("Owner of record") or row.get("Owner"))
        if owner:
            site["owner"] = owner
        service = str(row.get("Service area") or "").strip()
        site["in_area"] = service == "In"
        ring = str(site.get("service_ring") or "")
        if site["in_area"]:
            site["expansion_horizon"] = False
            if site["city"] == "LAS":
                if ring not in {"core", "100"}:
                    site["service_ring"] = "100"
            else:
                site["service_ring"] = "service"
        elif ring in {"200", "300"}:
            site["expansion_horizon"] = True
            site["service_ring"] = ring
        else:
            site["expansion_horizon"] = False
            site["service_ring"] = "outside"
        own = first_number(row.get("Spare ac (own parcel)"))
        adj = first_number(row.get("Spare ac (same-owner adjoining)"))
        if own is not None:
            site["spare_ac_own"] = own
            site["spare_ac_own_text"] = scrub(row.get("Spare ac (own parcel)"))
        if adj is not None:
            site["spare_ac_adjoining"] = adj
            site["spare_ac_adjoining_text"] = scrub(row.get("Spare ac (same-owner adjoining)"))
        sqft = first_number(row.get("Lot size (sq ft)"))
        if sqft and not site.get("lot_ac"):
            site["lot_ac"] = round(sqft / 43560, 3)
        miles = first_number(row.get("Dist to depot (mi)"))
        if miles is not None and site.get("miles_to_depot") is None:
            site["miles_to_depot"] = miles
        if site.get("lat") is None or site.get("lon") is None:
            lat = first_number(row.get("Lat"))
            lon = first_number(row.get("Lon"))
            if lat is not None and lon is not None:
                site["lat"] = lat
                site["lon"] = lon
                site["coord_status"] = "known"
                site["street_view_url"] = f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lon}"
        if not site.get("land_tier"):
            hit = screening["rows"].get((site["city"], norm_apn(site.get("apn"))))
            if hit:
                aerial = str(hit.get("aerial") or "").strip()
                site["aerial_fit"] = aerial
                site["land_tier"] = {"FIT_10": "L10", "FIT_4": "L4"}.get(aerial)
                if hit.get("spare_sqft") is not None and site.get("spare_ac_own") is None:
                    site["spare_ac_own"] = round(hit["spare_sqft"] / 43560, 3)
        had_verdict = bool(site.get("verdict"))
        tier = str(row.get("Final tier") or "").strip()
        verdict = COUNTY_VERDICT.get(tier.lower())
        site["verdict"] = verdict
        if tier:
            site["reconciliation_tier"] = scrub(tier)
        basis = plain_note(row.get("Verdict basis"))
        if verdict:
            if basis:
                site["evidence"] = basis[:700]
            if verdict == "PASS" and site["in_area"]:
                site["network_status"] = "cleared"
            elif verdict == "PASS":
                site["network_status"] = "held"
                site["expansion_horizon"] = True
            elif site.get("network_status") == "cleared":
                site["network_status"] = None
            note = basis[:400]
            verdict_rows.append(
                {
                    "site_id": site["site_id"],
                    "market": site["city"],
                    "name": site["name"],
                    "address": site["address"],
                    "apn": norm_apn(site.get("apn")),
                    "adjudicated_verdict": verdict,
                    "spare_ac_own": site["spare_ac_own"] if site.get("spare_ac_own") is not None else "",
                    "spare_ac_same_owner_adjoining": site["spare_ac_adjoining"] if site.get("spare_ac_adjoining") is not None else "",
                    "operating_evidence": "",
                    "parcel_evidence": note,
                    "confidence": site.get("confidence") or "",
                    "notes": note,
                    "aerial_verdict": "",
                    "land_verdict_provisional": "",
                    "operating_evidence_tier": "",
                    "retrieved_at": "2026-11-03",
                    "reviewer": "county check",
                    "supersedes": "",
                    "source_file": "Universe tab",
                }
            )
            site["reviews"].append(
                {
                    "reviewer": "county check",
                    "kind": "county",
                    "verdict": verdict,
                    "provisional": False,
                    "spare_ac_own": site.get("spare_ac_own"),
                    "spare_ac_adjoining": site.get("spare_ac_adjoining"),
                    "confidence": site.get("confidence") or "",
                    "date": "2026-11-03",
                    "note": note,
                }
            )
            crosswalk.append({"site_id": site["site_id"], "source": "Universe tab", "source_key": site["site_id"]})
        elif had_verdict:
            site["evidence"] = ""
            if site.get("network_status") == "cleared":
                site["network_status"] = None

    for row in rows:
        if str(row.get("Counted in funnel") or "").strip().lower() != "yes":
            continue
        city = str(row.get("Market") or "").strip()
        if city not in {"LAS", "PHX", "MIA"}:
            continue
        sid, twin = claim(city, row.get("APN"), str(row.get("Address") or ""))
        is_new = sid is None
        if is_new:
            seq[city] += 1
            sid = f"WB-{city}-{seq[city]:04d}"
            site = blank_site(sid, city)
            sites.append(site)
            by_id[sid] = site
            fresh += 1
        else:
            site = by_id[sid]
            claimed.add(sid)
            matched += 1
        paint(site, row, is_new=is_new)
        if is_new and (site.get("lat") is None or site.get("lon") is None) and twin and twin in by_id:
            other = by_id[twin]
            if other.get("lat") is not None and other.get("lon") is not None:
                site["lat"] = other["lat"]
                site["lon"] = other["lon"]
                site["coord_status"] = "known"
                site["street_view_url"] = other.get("street_view_url") or ""
        if site.get("lat") is None or site.get("lon") is None:
            query = _universe_geocode_query(site.get("address") or "", str(row.get("City") or ""), city)
            coords = geocode_address(query, geocode_cache) if query else None
            if coords:
                site["lon"], site["lat"] = float(coords[0]), float(coords[1])
                site["coord_status"] = "known"
                site["street_view_url"] = f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={site['lat']},{site['lon']}"
        yes_ids.add(sid)
        for token in apn_tokens(site.get("apn")):
            bucket = by_apn[(city, token)]
            if sid not in bucket:
                bucket.append(sid)

    dropped = []
    for site in sites:
        if site.get("origin") != "universe" or site["site_id"] in yes_ids:
            continue
        site["counts_as_site"] = False
        site["in_area"] = False
        site["verdict"] = None
        if site.get("network_status") == "cleared":
            site["network_status"] = None
        dropped.append(site["site_id"])

    GEOCODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    GEOCODE_CACHE.write_text(json.dumps(geocode_cache))
    counted = [site for site in sites if site["site_id"] in yes_ids]
    county = Counter(site.get("verdict") or "" for site in counted)
    return {
        "counted": len(counted),
        "matched_existing": matched,
        "new_sites": fresh,
        "dropped_existing": dropped,
        "by_city": {city: sum(1 for site in counted if site["city"] == city) for city in ("LAS", "PHX", "MIA")},
        "in_area_by_city": {
            city: sum(1 for site in counted if site["city"] == city and site["in_area"]) for city in ("LAS", "PHX", "MIA")
        },
        "county_verdicts": {key: county.get(key, 0) for key in ("PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED")},
        "missing_point": [site["site_id"] for site in counted if site.get("lat") is None or site.get("lon") is None],
    }


def load_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _weak_zoning(text: str) -> bool:
    value = (text or "").strip().lower()
    return (not value) or "unknown" in value or value in {"none", "n/a"} or "unincorporated" in value


def _format_phone(raw: str) -> str:
    parts = []
    for piece in re.split(r"[;|,]+", raw or ""):
        piece = piece.strip()
        if not piece:
            continue
        digits = re.sub(r"\D", "", piece)
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        if len(digits) == 10:
            parts.append(f"({digits[:3]}) {digits[3:6]}-{digits[6:]}")
        else:
            parts.append(piece)
    return "; ".join(parts)


def _gap_text_ok(text: str) -> bool:
    return bool(text)


def apply_gap_fills(sites: list[dict]) -> dict:
    """Overlay the suburb zoning, Las Vegas traffic, and business phone/website files.

    The files live in data/source and are not committed. Verified zoning replaces a
    weak or empty zone. A blank traffic count does not erase a count already on the
    site. Phone and website use high and medium matches only. A permanently closed
    place keeps a note and does not show a phone or website.
    """
    by_id = {site["site_id"]: site for site in sites}
    counts = {"zoning": 0, "aadt": 0, "aadt_kept": 0, "phone": 0, "website": 0, "closed": 0}
    zone_names = {
        "TEMPE": "Tempe zoning",
        "CHANDLER": "Chandler zoning",
        "GILBERT": "Gilbert zoning",
        "MESA": "Mesa zoning",
        "PHOENIX": "Phoenix zoning",
    }
    zoning_path = SRC / "zoning_phx_suburbs.csv"
    if zoning_path.exists():
        for row in load_csv(zoning_path):
            site = by_id.get((row.get("site_id") or "").strip())
            if not site or (row.get("status") or "").strip().lower() != "verified":
                continue
            if not _weak_zoning(site.get("zoning") or ""):
                continue
            code = (row.get("zoning_code") or "").strip()
            description = (row.get("zoning_description") or "").strip()
            jurisdiction = (row.get("jurisdiction") or "").strip().upper()
            code_only = jurisdiction == "CHANDLER" or not description
            label = code if code_only else (f"{code} — {description}" if code else description)
            if not _gap_text_ok(label):
                continue
            retrieved = (row.get("retrieval_date") or "2026-11-03").strip() or "2026-11-03"
            source_name = zone_names.get(jurisdiction, "City zoning")
            source = f"{source_name}, retrieved {retrieved}."
            if code_only:
                source += " Code only."
            site["zoning"] = label[:80]
            site["zoning_source"] = source
            counts["zoning"] += 1
    traffic_path = SRC / "aadt_las.csv"
    if traffic_path.exists():
        for row in load_csv(traffic_path):
            site = by_id.get((row.get("site_id") or "").strip())
            if not site:
                continue
            raw_count = (row.get("aadt") or "").strip()
            if not raw_count:
                if not (site.get("aadt_count") or "").strip():
                    prior = (row.get("prior_aadt") or "").strip()
                    if prior and _gap_text_ok(prior):
                        site["aadt_count"] = prior
                        prior_year = (row.get("prior_year") or "").strip()[:4]
                        if prior_year and not site.get("aadt_year"):
                            site["aadt_year"] = prior_year
                if (site.get("aadt_count") or "").strip():
                    counts["aadt_kept"] += 1
                continue
            try:
                number = int(float(raw_count))
            except ValueError:
                continue
            if number <= 0:
                continue
            status = (row.get("status") or "").strip().lower()
            if status == "verified":
                kind = "Verified"
            elif status == "inferred":
                kind = "Nearby road"
            else:
                continue
            road = (row.get("road_name") or "").strip()
            year = (row.get("aadt_year") or "").strip()[:4]
            distance = (row.get("distance_m") or "").strip()
            meters = ""
            found = re.match(r"(\d+)", distance)
            if found:
                meters = f", {int(found.group(1)):,} m to the count segment"
            retrieved = (row.get("retrieval_date") or "2026-11-03").strip() or "2026-11-03"
            source = f"NDOT TRINA, retrieved {retrieved}. {kind}{meters}."
            count = f"{number:,}"
            if not _gap_text_ok(" ".join((count, road, year, source))):
                continue
            site["aadt_count"] = count
            site["aadt_road"] = road[:80]
            site["aadt_year"] = year
            site["aadt_source"] = source
            counts["aadt"] += 1
    contact_path = SRC / "phone_website_overture.csv"
    if contact_path.exists():
        for row in load_csv(contact_path):
            site = by_id.get((row.get("site_id") or "").strip())
            if not site:
                continue
            confidence = (row.get("match_confidence") or "").strip().lower()
            status = (row.get("status") or "").strip().lower()
            if confidence not in {"high", "medium"} or status not in {"verified", "inferred"}:
                continue
            retrieved = (row.get("retrieval_date") or "2026-11-03").strip() or "2026-11-03"
            source = f"Overture places, release 2026-10-21.0, retrieved {retrieved}."
            if confidence == "medium":
                source += " Approximate."
            if not _gap_text_ok(source):
                continue
            closed = (row.get("overture_operating_status") or "").strip().lower() == "permanently_closed"
            if closed:
                site["phone"] = ""
                site["phone_source"] = ""
                site["website"] = ""
                site["website_source"] = ""
                site["place_note"] = "Listed as permanently closed"
                site["place_note_source"] = source
                counts["closed"] += 1
                continue
            phone = _format_phone(row.get("phone") or "")
            if phone and _gap_text_ok(phone):
                site["phone"] = phone
                site["phone_source"] = source
                counts["phone"] += 1
            website = (row.get("website") or "").strip()
            if website and not re.match(r"(?i)^https?://", website):
                website = "https://" + website
            if website and re.match(r"(?i)^https?://", website) and _gap_text_ok(website):
                site["website"] = website
                site["website_source"] = source
                counts["website"] += 1
    return counts


def row_is_data(row: dict) -> bool:
    """A blank first cell is not an empty row when a Site ID or measure is filled in.

    Land rows have been entered with the name cells empty and the id in a later column.
    """
    if any(str(row.get(key) or "").strip() for key in ("Site", "Name", "Site ID", "APN or folio")):
        return True
    for key in ("Asking price ($)", "Spare area (sq ft)", "Land (acres)"):
        if row.get(key) not in (None, ""):
            return True
    return False


def deal_place_label(row: dict) -> str:
    """Street label for a deal. A listing URL can carry the street when the name cells are blank."""
    site = str(row.get("Site") or "").strip()
    if site:
        return site
    name = str(row.get("Name") or "").strip()
    if name:
        return name
    url = str(row.get("Listing link") or "")
    match = re.search(r"/Listing/([^/?#]+)", url, re.I)
    if not match:
        return ""
    slug = re.sub(r"-(?:AZ|NV|FL|Phoenix|Miami|Las-Vegas).*$", "", match.group(1), flags=re.I)
    text = slug.replace("-", " ").strip()
    if not re.search(r"\d", text):
        return ""
    return text


def distinct_pipeline_names(sites: list[dict], features: list[dict]) -> int:
    """Prefer a pipeline name when two universe rows share one name at different addresses.

    The sheet sometimes copies one business name onto another address. A pipeline name that
    is not that copy is the name already typed on the pipeline row.
    """
    grouped: dict[str, list[dict]] = {}
    for site in sites:
        if site.get("origin") != "universe":
            continue
        key = re.sub(r"[^a-z0-9]", "", str(site.get("name") or "").lower())
        if key:
            grouped.setdefault(key, []).append(site)
    deals_for: dict[str, list[dict]] = {}
    for feature in features:
        props = feature.get("properties") or {}
        uid = str(props.get("universe_id") or "")
        if uid:
            deals_for.setdefault(uid, []).append(props)
    changed = 0
    for group in grouped.values():
        addresses = {re.sub(r"[^a-z0-9]", "", str(site.get("address") or "").lower()) for site in group}
        if len(group) < 2 or len(addresses) < 2:
            continue
        shared = re.sub(r"[^a-z0-9]", "", str(group[0].get("name") or "").lower())
        for site in group:
            linked = deals_for.get(site.get("site_id") or "") or []
            linked.sort(key=lambda props: 0 if props.get("kind") == "pipeline" else 1)
            if not linked:
                continue
            deal_name = str(linked[0].get("name") or "").strip()
            deal_key = re.sub(r"[^a-z0-9]", "", deal_name.lower())
            # A pipeline row titled with its street is not a different business name.
            if re.search(r"\d", deal_name):
                continue
            if not deal_key or deal_key == shared or deal_key in shared or shared in deal_key:
                continue
            site["name"] = deal_name[:160]
            changed += 1
    return changed


def sheet_rows(path: Path, sheet: str, header_row: int) -> list[dict]:
    """Read a sheet, including hyperlink targets that are not in the cell text."""
    wb = openpyxl.load_workbook(path, read_only=False, data_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows())
    wb.close()
    header = [str(cell.value).strip() if cell.value is not None else "" for cell in rows[header_row]]
    out = []
    for offset, row in enumerate(rows[header_row + 1 :]):
        if not row:
            continue
        item = {"_excel_row": header_row + offset + 2}
        links: list[tuple[str, str]] = []
        for i, cell in enumerate(row):
            key = header[i] if i < len(header) else ""
            if not key:
                continue
            item[key] = cell.value
            target = ""
            if cell.hyperlink is not None and cell.hyperlink.target:
                target = str(cell.hyperlink.target).strip()
            if target:
                links.append((key, target))
        if not row_is_data(item):
            continue
        item["_links"] = links
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


def workbook_as_of() -> str:
    """The workbook's own modified date. A sync can leave the Drive date in workbook_as_of.txt."""
    note = SRC / "workbook_as_of.txt"
    if note.exists():
        text = note.read_text().strip()
        if text:
            return text[:10]
    path = source_workbook()
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("docProps/core.xml")
        found = re.search(br"<dcterms:modified[^>]*>([^<]+)", xml)
        if found:
            return found.group(1).decode()[:10]
    except (KeyError, OSError):
        pass
    stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    return stamp.strftime("%Y-%m-%d")


_DELISTED_STATUS = re.compile(r"(?i)delist|listing removed|stale/delisted|sold or withdrawn")
DRIFT_PATH = ROOT / "data" / "drift_report.csv"
STAGE_INDEX = ROOT / "data" / "workbook_stages.json"
DRIFT_FIELDS = ["lead id", "workbook Stage", "KO reason", "map stage", "rule applied"]


def _lead_key(value: str) -> str:
    text = re.sub(r"^(phx|las|mia|sna)\s+", "", (value or "").lower())
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def listings_register_delists() -> dict[str, str]:
    """Delisted listing statuses, used only for the drift report."""
    found: dict[str, str] = {}
    path = source_workbook()
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if "Listings Register" not in wb.sheetnames:
        wb.close()
        return found
    rows = list(wb["Listings Register"].iter_rows(values_only=True))
    wb.close()
    if not rows:
        return found
    header = [str(cell).strip() if cell else "" for cell in rows[0]]
    idx = {name: i for i, name in enumerate(header)}
    if "listing_status" not in idx:
        return found
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        status = str(row[idx["listing_status"]] or "").strip()
        if not _DELISTED_STATUS.search(status):
            continue
        for field in ("ref", "address"):
            if field not in idx:
                continue
            key = _lead_key(str(row[idx[field]] or ""))
            if key:
                found[key] = status
    return found


def _row_delist(row: dict, index: dict[str, str]) -> str:
    for field in ("Site", "Name"):
        key = _lead_key(str(row.get(field) or ""))
        if key and key in index:
            return index[key]
    return ""


def scrub_drift_reason(text: str) -> str:
    """Shorten a drift-report reason. The report is never served on the map."""
    cleaned = re.sub(r"(?i)under\s+\d+\s+stalls?\s+fit", "Lot too small", str(text or ""))
    cleaned = re.sub(r"(?i)\bstalls?\b", "spaces", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,;.")
    return cleaned or "Noted"


def suggested_drop_rows(drift: list[dict]) -> list[dict]:
    """Knock-outs that stay suggestions. Stage is not rewritten.

    A row already at Dropped is a recorded stage, not a new suggestion.
    A listing-flag note with no pipeline stage is not a suggested drop.
    """
    rows = []
    for row in drift:
        deal_id = str(row.get("lead id") or "").strip()
        stage = str(row.get("map stage") or row.get("workbook Stage") or "").strip()
        reason = str(row.get("KO reason") or "").strip()
        if not re.fullmatch(r"(PIPE|LAND)-[A-Z]{2,4}-\d{4}", deal_id):
            continue
        if not stage or not reason:
            continue
        if stage.lower().startswith("dropped") or stage.lower() == "not listed":
            continue
        rows.append({"id": deal_id, "stage": stage, "reason": reason})
    rows.sort(key=lambda item: item["id"])
    return rows


def knockout_for_report(row: dict, delist_status: str) -> tuple[str, str]:
    """Report-only. R-068: business not confirmed is never a knock-out.

    R-031, R-042, R-067, and R-013 are noted when they suggest Dropped.
    The Stage column is still what the map shows.
    """
    raw = str(row.get("Knock-out") or row.get("KO reason") or "").strip()
    low = raw.lower()
    if low and "not confirmed" not in low:
        if re.search(r"stall|no land", low):
            return scrub_drift_reason(raw), "R-031; R-042"
        if "tenant lease" in low:
            return scrub_drift_reason(raw), "R-067; R-042"
        return scrub_drift_reason(raw), "R-042"
    if delist_status:
        return scrub_drift_reason(delist_status), "R-013; listings register delisted"
    return "", ""


def workbook_stage_rows() -> tuple[list[dict], list[dict]]:
    pipeline_rows = sheet_rows(source_workbook(), "Pipeline", 3)
    land_rows = sheet_rows(source_workbook(), "Land Sites", 3)
    delist_index = listings_register_delists()
    shipped = []
    drift = []
    reg = registry_load()
    for kind, rows in (("pipeline", pipeline_rows), ("land", land_rows)):
        for index, row in enumerate(rows, start=1):
            if is_off_market_row(row):
                continue
            # Same id the map ships. A blank Market used to mint LAND-UNK-#### even when Site ID was set.
            deal_id = shipped_deal_id(row, kind, index, reg)
            stage = display_stage(row.get("Stage"))
            shipped.append({"deal_id": deal_id, "kind": kind, "stage": stage})
            reason, rule = knockout_for_report(row, _row_delist(row, delist_index))
            if reason and not stage.lower().startswith("dropped"):
                drift.append(
                    {
                        "lead id": deal_id,
                        "workbook Stage": stage,
                        "KO reason": reason,
                        "map stage": stage,
                        "rule applied": rule,
                    }
                )
    return shipped, drift


def listed_flag_drift(sites: list[dict]) -> list[dict]:
    """Sites whose source file says listed, but the only listing row is off-market."""
    rows = []
    for site in sites:
        if site.get("origin") != "universe" or not site.get("counts_as_site") or site.get("duplicate_of"):
            continue
        if not site.get("in_area"):
            continue
        if site.get("_source_listed") and not site.get("listed"):
            rows.append(
                {
                    "lead id": site["site_id"],
                    "workbook Stage": "",
                    "KO reason": "Source flag said listed but the only listing row is off-market",
                    "map stage": "not listed",
                    "rule applied": "Live listing or workbook Listing status of Listed",
                }
            )
    return rows


_DEAD_LISTING = re.compile(r"(?i)\b(gone|expired|stale|delist|withdrawn|sold|unverified)\b|no longer exists|dead on arrival")


def classify_register_row(row: dict, on_tab: bool) -> str:
    """Return pin, list, or skip for a Listings Register row.

    pin and list are the 'Listed, not yet screened' layer. list has no coordinates.
    """
    flow = str(row.get("flow") or "")
    status = str(row.get("listing_status") or "")
    funnel = str(row.get("funnel_stage") or "")
    nxt = str(row.get("next_step") or "")
    blob = " ".join([flow, status, funnel])
    if re.search(r"(?i)off[\s-]*market", blob):
        return "skip"
    if str(row.get("ko_reason") or "").strip():
        return "skip"
    if re.search(r"(?i)knocked out|routed", funnel):
        return "skip"
    if re.search(r"(?i)duplicate", f"{row.get('ko_reason') or ''} {row.get('match_status') or ''}"):
        return "skip"
    if on_tab:
        return "skip"
    if _DEAD_LISTING.search(status) or _DEAD_LISTING.search(nxt):
        return "skip"
    address = str(row.get("address") or "")
    if re.search(r"(?i)address withheld", address) and not re.search(r"approx\s+-?\d", address):
        return "list"
    return "pin"


def broker_outreach(path: Path) -> dict[str, str]:
    """Latest broker email or call date per Site ID.

    Uses the Activity tab the timeline is built from. Outbound and internal rows
    both count. The message text is never returned.
    """
    from timeline_activity import broker_contact_dates

    return broker_contact_dates(path)


def write_workbook_stage_files(extra: list[dict] | None = None) -> dict:
    shipped, drift = workbook_stage_rows()
    drift.extend(extra or [])
    pipeline = Counter(row["stage"] for row in shipped if row["kind"] == "pipeline")
    land = Counter(row["stage"] for row in shipped if row["kind"] == "land")
    payload = {"workbook_as_of": workbook_as_of(), "pipeline": dict(pipeline), "land": dict(land), "rows": shipped}
    STAGE_INDEX.parent.mkdir(parents=True, exist_ok=True)
    STAGE_INDEX.write_text(json.dumps(payload, indent=2))
    with DRIFT_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=DRIFT_FIELDS)
        writer.writeheader()
        writer.writerows(drift)
    suggested = OUT / "suggested_drops.json"
    suggested.parent.mkdir(parents=True, exist_ok=True)
    suggested.write_text(json.dumps(suggested_drop_rows(drift), indent=2) + "\n")
    return payload


def shipped_stage_problems(deal_features: list[dict], expected_rows: list[dict] | None = None) -> list[str]:
    if expected_rows is None:
        if not STAGE_INDEX.exists():
            return ["missing data/workbook_stages.json"]
        expected_rows = json.loads(STAGE_INDEX.read_text()).get("rows") or []
        index_counts = json.loads(STAGE_INDEX.read_text())
    else:
        index_counts = {
            "pipeline": dict(Counter(row["stage"] for row in expected_rows if row["kind"] == "pipeline")),
            "land": dict(Counter(row["stage"] for row in expected_rows if row["kind"] == "land")),
        }
    expected = {row.get("deal_id"): row.get("stage") for row in expected_rows}
    problems = []
    seen = set()
    for feature in deal_features:
        props = feature.get("properties") or {}
        deal_id = props.get("deal_id")
        seen.add(deal_id)
        if expected.get(deal_id) != props.get("stage"):
            problems.append(f"{deal_id} stage {props.get('stage')!r} is not the workbook Stage column {expected.get(deal_id)!r}")
    missing = [deal_id for deal_id in expected if deal_id not in seen]
    if missing:
        problems.append("workbook rows missing from the map: " + ", ".join(sorted(missing)[:12]))
    pipeline = Counter((feature.get("properties") or {}).get("stage") for feature in deal_features if (feature.get("properties") or {}).get("kind") == "pipeline")
    land = Counter((feature.get("properties") or {}).get("stage") for feature in deal_features if (feature.get("properties") or {}).get("kind") == "land")
    if dict(pipeline) != index_counts.get("pipeline"):
        problems.append(f"pipeline stage counts {dict(pipeline)} != workbook {index_counts.get('pipeline')}")
    if dict(land) != index_counts.get("land"):
        problems.append(f"land stage counts {dict(land)} != workbook {index_counts.get('land')}")
    return problems


def drift_report_exposure() -> list[str]:
    problems = []
    if (OUT / "drift_report.csv").exists() or (ROOT / "public" / "drift_report.csv").exists():
        problems.append("drift report is in a folder the app can serve")
    for folder in ("app", "components", "lib"):
        for path in (ROOT / folder).rglob("*"):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            if "drift_report" in path.read_text():
                problems.append(f"{path.relative_to(ROOT)} references the drift report")
    return problems


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


GEOCODE_CACHE = ROOT / "data" / "cache" / "geocode_cache.json"
_STREET_DIRS = {
    "n": "n",
    "s": "s",
    "e": "e",
    "w": "w",
    "ne": "ne",
    "nw": "nw",
    "se": "se",
    "sw": "sw",
    "north": "n",
    "south": "s",
    "east": "e",
    "west": "w",
}
_DEAL_LEAK = re.compile(r"(?i)\b(ebitda|revenue|playbook)\b")
_DEAL_PRIVATE = re.compile(
    r"(?i)("
    r"\b(?:cindel|ming|ricardo|yuka|jaideep|jesse)\b"
    r"|\b(?:outreach|approv\w*|wording|docusign|redline)\b"
    r"|\b(?:replied|reply|copied|email|nudged|folder|memo)\b"
    r"|\b(?:ruled out|downgraded|task board|our side|no contact|no price|no reply)\b"
    r"|\b(?:lane broker|passed on|pass on|waiting for|followed up)\b"
    r"|\b(?:sweep|priority area)\b"
    r"|moved to the land"
    r")"
)
DEAL_FIELDS = (
    "deal_id",
    "kind",
    "name",
    "address",
    "city",
    "stage",
    "stage_group",
    "broker",
    "firm",
    "listing_url",
    "folder_url",
    "asking_price",
    "asking_price_display",
    "asking_price_source",
    "next_step",
    "universe_id",
    "coord_status",
    "miles_to_depot",
    "listed",
    "listing_removed",
    "parcel_match",
    "parcel_acres",
    "source_line",
    "source_kind",
    "business_type",
    "is_c_store",
    "broker_contacted",
    "last_broker_contact",
    "apn",
    "street_view_url",
    "photos",
    "photo_status",
    "photo_diligence_count",
    "photo_listing_count",
    "photos_checked",
    "photo_notes",
    "nda_id",
    "nda_status",
    "nda_waiting_on",
    "nda_gates",
    "nda_days_open",
    "nda_days_in_court",
    "stage_blocker",
    "stage_blocker_since",
    *FIGURE_FIELDS,
)


def deal_street_signature(value: str) -> str:
    text = re.sub(r"^(phx|las|mia|sna)\s+", "", (value or "").lower().strip())
    # City names stay. "Chandler" is the street in "7455 W Chandler Blvd", not only the city.
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    text = re.sub(r"\b(az|nv|fl|arizona|nevada|florida)\b", " ", text)
    text = re.sub(r"(?<=\s)\d{5}\b", " ", text)
    text = re.sub(
        r"\b(avenue|ave|street|st|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|circle|cir|parkway|pkwy|highway|hwy)\b",
        " ",
        text,
    )
    text = re.sub(r"\s+", " ", text).strip()
    match = re.search(r"(\d+)\s+((?:north|south|east|west|ne|nw|se|sw|n|s|e|w)\s+)?([a-z0-9]+)", text)
    if not match:
        return ""
    direction = _STREET_DIRS.get((match.group(2) or "").strip(), "")
    return f"{match.group(1)} {direction} {match.group(3)}".replace("  ", " ").strip()


def stage_group(stage) -> str:
    """Workbook stages. There is no Contacted stage."""
    text = str(stage or "").strip().lower()
    if text.startswith("dropped"):
        return "dropped"
    number = stage_number(stage)
    if number is None or number <= 0:
        return "sourced"
    if number == 1:
        return "desk"
    if number == 2:
        return "financial"
    if number == 3:
        return "checks"
    return "close"


def display_stage(stage) -> str:
    """Stage 3's workbook label is shortened before it is stored or shown."""
    if stage_number(stage) == 3:
        return "3 Site checks"
    return scrub(str(stage or ""))[:80]


def universe_match_index(sites: list[dict]) -> tuple[dict, dict]:
    by_apn: dict[tuple[str, str], set[str]] = {}
    by_street: dict[tuple[str, str], set[str]] = {}
    for site in sites:
        if site.get("origin") != "universe":
            continue
        city = site.get("city") or ""
        for token in apn_tokens(site.get("apn")):
            by_apn.setdefault((city, token), set()).add(site["site_id"])
        for field in ("address", "name"):
            for key in loose_street_keys(site.get(field) or ""):
                by_street.setdefault((city, key), set()).add(site["site_id"])
    return by_apn, by_street


def universe_link_gap(features: list[dict]) -> dict:
    """Pipeline and land deals that still have no universe site.

    A listing joins the universe only when the Universe tab has a counted row for that
    place. This does not mint a row, and it does not invent a coordinate or a parcel number.
    """
    linked = 0
    located_missing: list[dict] = []
    unlocated_missing: list[dict] = []
    for feature in features:
        props = feature.get("properties") or {}
        if props.get("kind") not in {"pipeline", "land"}:
            continue
        uid = str(props.get("universe_id") or "").strip()
        geometry = feature.get("geometry") or {}
        located = bool(geometry.get("coordinates"))
        if uid:
            linked += 1
            continue
        entry = {
            "deal_id": props.get("deal_id") or "",
            "kind": props.get("kind") or "",
            "city": props.get("city") or "",
            "stage_group": props.get("stage_group") or "",
            "coord_status": props.get("coord_status") or "",
        }
        if located:
            located_missing.append(entry)
        else:
            unlocated_missing.append(entry)
    return {
        "linked": linked,
        "located_without_universe": len(located_missing),
        "unlocated_without_universe": len(unlocated_missing),
        "located_missing": located_missing,
        "unlocated_missing": unlocated_missing,
    }


MAP_MARKETS = {"LAS", "PHX", "MIA"}


def universe_gap_status(features: list[dict]) -> dict:
    """Located Pipeline and Land deals that have no universe row.

    The failing set is LAS, PHX, and MIA. Other markets are listed and do not fail the check.
    The market is the deal's city field. A deal id is not used to invent a market.
    """
    gap = universe_link_gap(features)
    located_ids: list[str] = []
    outside: list[dict] = []
    blank = 0
    for item in gap["located_missing"]:
        deal_id = str(item.get("deal_id") or "").strip()
        city = str(item.get("city") or "").strip().upper()
        if city not in MAP_MARKETS:
            outside.append({"deal_id": deal_id, "city": city or "unknown"})
            continue
        if not deal_id:
            blank += 1
            continue
        located_ids.append(deal_id)
    return {
        "linked": gap["linked"],
        "located_ids": located_ids,
        "outside": outside,
        "unlocated_count": gap["unlocated_without_universe"],
        "blank": blank,
    }


def universe_gap_problems(features: list[dict]) -> list[str]:
    """Fail when a located LAS, PHX, or MIA deal has no universe row.

    Inside those markets the count has to be zero. There is no exception list.
    Deals with no location, and located deals in other markets, stay out of this gate.
    """
    status = universe_gap_status(features)
    problems = []
    if status["blank"]:
        problems.append(
            f"{status['blank']} located LAS, PHX, or MIA deal(s) have no universe_id and no deal id."
        )
    if status["located_ids"]:
        problems.append(
            f"Located LAS, PHX, and MIA deals without a Universe row: {len(status['located_ids'])}. "
            + ", ".join(status["located_ids"])
            + ". Mint a counted Universe row for each id. "
            "The map does not invent a row, a coordinate, or a parcel number, and it does not write the workbook."
        )
    return problems


def universe_gap_lines(features: list[dict] | None = None) -> list[str]:
    """Deal ids in the located gap, for the sync pull request and its comment."""
    if features is None:
        path = OUT / "deals.geojson"
        features = json.loads(path.read_text()).get("features") or [] if path.exists() else []
    status = universe_gap_status(features)
    lines: list[str] = []
    if status["blank"]:
        lines.append(f"Located LAS, PHX, or MIA deals with no deal id: {status['blank']}. The check fails.")
        lines.append("")
    count = len(status["located_ids"])
    if count:
        lines.append(f"Located LAS, PHX, and MIA deals without a Universe row: {count}. The check fails.")
        lines.append(
            "Mint a counted Universe row for each id. "
            "The map does not invent a row, a coordinate, or a parcel number, and it does not write the workbook."
        )
        lines.append("")
        lines.append("Deal ids:")
        lines.extend(f"- {deal_id}" for deal_id in status["located_ids"])
    else:
        lines.append("Located LAS, PHX, and MIA deals without a Universe row: 0.")
        lines.append("Every located Pipeline and Land deal in LAS, PHX, and MIA has a Universe row.")
    if status["outside"]:
        lines.append("")
        lines.append("Located deals outside LAS, PHX, and MIA. The check does not use these ids:")
        for item in status["outside"]:
            label = item["deal_id"] or "(no deal id)"
            lines.append(f"- {label} ({item['city']})")
    return lines


def enforce_universe_gap(features: list[dict] | None = None) -> None:
    if features is None:
        path = OUT / "deals.geojson"
        if not path.exists():
            raise SystemExit("Universe gap check failed.\nmissing deals.geojson")
        features = json.loads(path.read_text()).get("features") or []
    print("\n".join(universe_gap_lines(features)))
    problems = universe_gap_problems(features)
    if problems:
        raise SystemExit("Universe gap check failed.\n" + "\n".join(problems))


def match_workbook_site(city: str, apn_value, address_text: str, by_apn: dict, by_street: dict) -> str | None:
    """One matcher for a deal row and for the site it attaches to.

    A unique street match wins when the parcel number points at a different site.
    Otherwise one parcel match is used, then a unique street match.
    """
    street: set[str] = set()
    for key in loose_street_keys(address_text or ""):
        street |= by_street.get((city, key), set())
    parcels: set[str] = set()
    for token in apn_tokens(apn_value):
        parcels |= by_apn.get((city, token), set())
    if len(street) == 1 and len(parcels) == 1 and next(iter(street)) != next(iter(parcels)):
        return next(iter(street))
    if len(parcels) == 1:
        return next(iter(parcels))
    if len(street) == 1:
        return next(iter(street))
    if len(parcels) > 1:
        return sorted(parcels)[0]
    return None


EXPLICIT_DEAL_NOTES = _load_rewrites("deals")

_LISTING_HOSTS = {"loopnet.com", "crexi.com", "bizbuysell.com", "carwashbrokers.com", "matthews.com"}


def _url_host(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", (url or "").lower()).split("/")[0]


_PUBLIC_SOURCE = re.compile(
    r"(?i)realmo|maricopa|clark county|miami-dade|broward|loopnet|crexi|bizbuysell|matthews|property appraiser|assessor|parcel"
)
_INTERNAL_SOURCE = re.compile(
    r"(?i)(off-market targets|\btargets tab\b|\bfolder\b|\brank\b|deep check|\bemail\b|\bcall\b|transcript|"
    r"\bsheet\b|\btab\b|\bpackage\b|p&l|flyer|brochure|memorandum|moove|esri|flood|udc\b|epa\b|"
    r"nv energy|bizquest|cash flow|ebitda|service-area|priority area|imagery)"
)
_MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"


def _source_date(text: str) -> str:
    match = re.search(rf"(?i)\b({_MONTHS})[a-z]*\.?\s+(\d{{1,2}}),?\s+(20\d{{2}})", text or "")
    if not match:
        return ""
    return f"{match.group(1)[:3].title()} {int(match.group(2))} {match.group(3)}"


def _public_source_clause(clause: str) -> str:
    """Keep a public record and its date. Drop people, sheets, and internal files."""
    text = re.sub(r"\s+", " ", clause or "").strip(" ;")
    if not text or not _PUBLIC_SOURCE.search(text):
        return ""
    if _INTERNAL_SOURCE.search(text) and not re.search(r"(?i)realmo record|county|appraiser|assessor|parcel", text):
        return ""
    head = re.split(r"\s+\(", text, maxsplit=1)[0]
    head = re.sub(r"(?i)\s+(layer|layers|open data|tax roll)\b.*", "", head)
    head = re.sub(r"\s+", " ", head).strip(" ,;")
    replacements = (
        (r"(?i)^realmo record\b.*", "Realmo record"),
        (r"(?i)^realmo listing\b.*", "Realmo listing"),
        (r"(?i)^maricopa county\b.*", "Maricopa County parcel"),
        (r"(?i)^clark county parcel\b.*", "Clark County parcel"),
        (r"(?i)^clark county assessor\b.*", "Clark County assessor"),
        (r"(?i)^miami-dade\b.*", "Miami-Dade Property Appraiser"),
        (r"(?i)^broward\b.*", "Broward County Property Appraiser"),
        (r"(?i)^loopnet\b.*", "LoopNet listing"),
        (r"(?i)^crexi\b.*", "Crexi listing"),
        (r"(?i)^bizbuysell\b.*", "BizBuySell listing"),
        (r"(?i)^matthews\b.*", "Matthews listing"),
        (r"(?i)^car wash brokers\b.*", "Car Wash Brokers listing"),
    )
    for pattern, label in replacements:
        if re.search(pattern, head):
            head = label
            break
    else:
        return ""
    if _INTERNAL_SOURCE.search(head) or _DEAL_PRIVATE.search(head) or _DEAL_LEAK.search(head):
        return ""
    dated = _source_date(text)
    return f"{head}, {dated}" if dated else head


def _source_records(value) -> list[str]:
    seen = []
    for clause in re.split(r";\s*", str(value or "")):
        plain = _public_source_clause(clause)
        if plain and plain not in seen:
            seen.append(plain)
    return seen


def _broker_channel(broker: str) -> str:
    """Brokerage or agent, without the person's name in parentheses."""
    text = re.sub(r"\s+", " ", str(broker or "")).strip()
    if not text or re.match(r"(?i)^none yet\b", text):
        return ""
    shown = re.match(r"(?i)^not shown\s*\(([^)]+)\)", text)
    if shown:
        return shown.group(1).strip()
    firm = re.split(r"\s+\(", text, maxsplit=1)[0]
    firm = re.split(r",\s*(?:exclusive|also|bizbuysell|loopnet|crexi)\b", firm, maxsplit=1, flags=re.I)[0]
    firm = firm.strip(" ,;")
    if _DEAL_PRIVATE.search(firm) or _DEAL_LEAK.search(firm) or _NOTE_INTERNAL.search(firm):
        return ""
    return firm[:120]


BUSINESS_TYPES = (
    "Car wash",
    "Auto repair",
    "Tire and lube",
    "Gas station",
    "Yard or lot",
    "Storage",
    "Land",
    "Other",
)


_CSTORE_TOKEN = re.compile(r"(?i)(?:c[\s-]*stores?|\bampm\b|am\s*/\s*pm)")


def is_c_store_text(segment: str, name: str) -> bool:
    """True when Segment or the deal name names a convenience store.

    A segment that is only "Gas station" does not qualify. Branded tokens such
    as ampm do, including when they sit in the deal name.
    """
    segment_text = re.sub(r"\s+", " ", str(segment or "")).strip()
    name_text = re.sub(r"\s+", " ", str(name or "")).strip()
    if re.fullmatch(r"(?i)gas station", segment_text) and not _CSTORE_TOKEN.search(name_text):
        return False
    return bool(_CSTORE_TOKEN.search(segment_text) or _CSTORE_TOKEN.search(name_text))


def deal_is_c_store(kind: str, segment: str, name: str) -> bool:
    """Pipeline deals only. Land rows stay on the land layer and are not flagged."""
    return kind == "pipeline" and is_c_store_text(segment, name)


def business_type_from_text(raw: str) -> str:
    """Map a workbook label onto the small set of business types."""
    text = re.sub(r"\s+", " ", raw or "").strip().lower()
    if not text:
        return "Other"
    if "tire" in text or "lube" in text:
        return "Tire and lube"
    if "vacant" in text or "land only" in text or "entitled" in text or text == "land":
        return "Land"
    if any(word in text for word in ("yard", "lot", "parking")):
        return "Yard or lot"
    if "storage" in text:
        return "Storage"
    if "car wash" in text or "truck wash" in text:
        return "Car wash"
    if any(word in text for word in ("gas", "c-store", "fuel", "station")):
        return "Gas station"
    if any(word in text for word in ("repair", "collision", "auto service", "automotive", "fleet", "garage")):
        return "Auto repair"
    if text == "car wash":
        return "Car wash"
    if text == "auto service":
        return "Auto repair"
    if text == "other":
        return "Other"
    return "Other"


def business_type_from_row(row: dict, census: bool = False) -> str:
    """Census rows are car washes. Deals use the business type column, then Segment."""
    if census:
        return "Car wash"
    for key in ("Business type", "Business Type", "Segment", "Segment group"):
        raw = str(row.get(key) or "").strip()
        if raw:
            return business_type_from_text(raw)
    return "Other"


def is_off_market_row(row: dict) -> bool:
    """Off-market research is not a broker or agent deal.

    A Lead source column wins when the workbook has one. Until then the stage
    does: 'Off-market target' and 'Off market (no lead)' both stay out of the pipeline.
    """
    lead = str(row.get("Lead source") or row.get("Lead Source") or "").strip()
    if lead:
        return bool(re.search(r"(?i)off[\s-]*market|no lead|own research", lead))
    status = str(row.get("Listing status") or "")
    stage = str(row.get("Stage") or "")
    broker = str(row.get("Broker") or "")
    return bool(
        re.search(r"(?i)off[\s-]*market", f"{status} {stage}")
        or re.search(r"(?i)no lead", stage)
        or re.match(r"(?i)^none yet\b", broker.strip())
    )


def research_sources_line(row: dict) -> str:
    return "; ".join(_source_records(row.get("Source of the numbers")))[:400]


def clean_research_text(row: dict) -> str:
    """Notes and land comments, without lot size, people, sheets, or power units."""
    kept = []
    for key in ("What we know", "Land notes"):
        text = trim_restated_facts(plain_note(row.get(key)))
        text = re.sub(r"(?i)\bon \d+(?:\.\d+)? acres?\b", "", text)
        for sentence in re.split(r"(?<=[.!?])\s+", text):
            piece = sentence.strip(" ;")
            if not piece:
                continue
            if _DEAL_PRIVATE.search(piece) or _DEAL_LEAK.search(piece) or _NOTE_INTERNAL.search(piece):
                continue
            if re.search(r"https?://", piece):
                continue
            kept.append(piece if piece.endswith(".") else piece + ".")
    cleaned = " ".join(kept)
    cleaned = re.sub(r"\s+\.", ".", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned[:500]


def deal_source(row: dict, listing_url: str) -> tuple[str, str]:
    """A source line and its type. Off-market rows are not deal cards."""
    broker = str(row.get("Broker") or "")
    if is_off_market_row(row):
        records = _source_records(row.get("Source of the numbers"))
        line = "Off-market lead (our own research)"
        if records:
            line = f"{line}. " + "; ".join(records)
        if not line.endswith("."):
            line += "."
        return line[:400], "off-market"
    name = _broker_channel(broker)
    if not name and listing_url:
        host = _url_host(listing_url)
        name = {
            "loopnet.com": "LoopNet",
            "crexi.com": "Crexi",
            "bizbuysell.com": "BizBuySell",
            "matthews.com": "Matthews",
            "carwashbrokers.com": "Car Wash Brokers",
        }.get(host, "")
    if not name:
        name = "Broker"
    kind = "broker-listed" if listing_url else "broker"
    return name[:160], kind


def _http_urls(value: str) -> list[str]:
    return [match.rstrip(".,;") for match in re.findall(r"https?://[^\s)>\"]+", value or "")]


def listing_url_from_row(row: dict) -> str:
    """The typed Listing link column only.

    A URL in Photo notes, evidence, a source line, or any other note is not the
    original listing. A hyperlink on the Listing link cell still counts when the
    visible text is not the URL. A file-folder link in that cell is not a listing page.
    """
    found: list[str] = []
    cell = row.get("Listing link")
    if isinstance(cell, str):
        found.extend(_http_urls(cell))
    for key, target in row.get("_links") or []:
        if str(key) != "Listing link":
            continue
        found.extend(_http_urls(str(target)))
    kept: list[str] = []
    seen: set[str] = set()
    for url in found:
        host = _url_host(url)
        if "google." in host or host.endswith("google.com"):
            continue
        if url in seen:
            continue
        seen.add(url)
        kept.append(url)
    if not kept:
        return ""
    kept.sort(key=lambda url: 0 if _url_host(url) in _LISTING_HOSTS else 1)
    return kept[0][:400]


def folder_url_from_row(row: dict) -> str:
    """Pipeline / Land Sites column AE. The cell text or its hyperlink."""
    return folder_url_for(folder_id_from_row(row))


def folder_link_problems(expected: list[tuple[str, str, str]], features: list[dict], sites: list[dict]) -> list[str]:
    """A Folder column URL must survive on the deal and on the site the panel opens.

    expected is (deal id, folder URL, universe site id). An empty universe id means the deal has no site.
    """
    by_deal: dict[str, dict] = {}
    by_universe: dict[str, list[dict]] = {}
    for feature in features:
        props = feature.get("properties") or {}
        deal_id = str(props.get("deal_id") or "")
        if deal_id:
            by_deal[deal_id] = props
        universe_id = str(props.get("universe_id") or "")
        if universe_id:
            by_universe.setdefault(universe_id, []).append(props)
    problems = []
    seen: set[str] = set()
    for deal_id, url, _universe_id in expected:
        if not url or deal_id in seen:
            continue
        seen.add(deal_id)
        props = by_deal.get(deal_id)
        if not props or (props.get("folder_url") or "") != url:
            problems.append(f"{deal_id} dropped its Folder URL")
    for site in sites:
        site_id = str(site.get("site_id") or "")
        linked = by_deal.get(str(site.get("linked_deal_id") or "")) or {}
        wanted = linked.get("folder_url") or ""
        if not wanted:
            for props in by_universe.get(site_id, []):
                if props.get("folder_url"):
                    wanted = props["folder_url"]
                    break
        if (site.get("folder_url") or "") != wanted:
            problems.append(f"{site_id or '?'} dropped its Folder URL")
    return problems


def split_broker(value) -> tuple[str, str]:
    text = scrub(value)
    match = re.match(r"^(.*?)\s*\(([^)]+)\)", text)
    if not match:
        broker, firm = "", text
    else:
        broker, firm = match.group(2).strip(" ,;"), match.group(1).strip(" ,;")
    if firm.lower() in {"", "none", "none yet", "n/a"}:
        firm = ""
    if broker.lower() in {"", "none", "none yet", "n/a", "off-market"}:
        broker = ""
    return broker, firm


_DEAL_KEEP = re.compile(
    r"(?i)\b(?:confirm|check|verify|test-fit|identify|street view|deed|zoning|lease|easement|stalls?|spare|service area|lot size|parking|entitlement|survey|title report|environmental|assemblage|land)\b"
)
_DEAL_DROP = re.compile(
    r"(?i)(?:\$|\bpackage\b|\breceipt\b|\broger\b|\bpencek\b|\bcrexi\b|\bbizbuysell\b|\bcomp\b|\brevisit\b|\bsold\b|\bwithdrawn\b|\bfolder\b|\bcall\b|\bemail\b|\bknocked out\b|\bdesk checks?\b|\bpipeline\b|\bask\b)"
)


def clean_deal_note(value) -> str:
    """Keep a neutral next step. Drop names, approvals, outreach, and legal chatter."""
    text = plain_note(value)
    if not text:
        return ""
    if text in EXPLICIT_DEAL_NOTES:
        return EXPLICIT_DEAL_NOTES[text]
    kept = []
    for chunk in re.split(r"(?<=[.!?])\s+|;\s+", text):
        piece = chunk.strip(" ;")
        if not piece:
            continue
        if _DEAL_LEAK.search(piece) or _DEAL_PRIVATE.search(piece) or _NOTE_INTERNAL.search(piece):
            continue
        if re.search(r"(?i)\bno spare\b", piece):
            kept.append("No spare land")
            continue
        if re.match(r"(?i)^(dropped|stays|oct|nov|low priority|out of scope|gone from|knocked out)\b", piece):
            continue
        if re.search(r"(?i)land sites row|pairing it with", piece):
            continue
        if _DEAL_DROP.search(piece) or not _DEAL_KEEP.search(piece):
            continue
        piece = re.sub(r"(?i)^(?:then|next|our side)\s*[:,]?\s*", "", piece).strip()
        if not piece or not _DEAL_KEEP.search(piece):
            continue
        kept.append(piece[0].upper() + piece[1:] if piece[:1].islower() else piece)
    cleaned = ". ".join(part.rstrip(".") for part in kept).strip()
    if cleaned and not cleaned.endswith("."):
        cleaned += "."
    if not cleaned or _DEAL_PRIVATE.search(cleaned) or _DEAL_LEAK.search(cleaned) or _DEAL_DROP.search(cleaned):
        return ""
    return cleaned[:400]


def deal_text_problems(deal_id: str, props: dict) -> list[str]:
    problems = []
    for key in ("next_step", "asking_price_source", "name", "address", "source_line", "figures_source"):
        text = props.get(key) or ""
        if not isinstance(text, str) or not text:
            continue
        if key in {"next_step", "asking_price_source", "source_line"} and (_DEAL_PRIVATE.search(text) or _DEAL_LEAK.search(text)):
            problems.append(f"{deal_id} {key}: {text[:140]!r}")
        if _NOTE_INTERNAL.search(text):
            problems.append(f"{deal_id} {key}: {text[:140]!r}")
    if not str(props.get("source_line") or "").strip():
        problems.append(f"{deal_id} source_line is blank")
    return problems


def _geocode_query(row: dict) -> str:
    label = re.sub(r"^(PHX|LAS|MIA|SNA)\s+", "", deal_place_label(row), flags=re.I)
    if not label or "address to come" in label.lower():
        return ""
    # A house number may sit after a business name. Leads with no street number stay unplaced.
    found = re.search(r"\b\d{2,6}\s+[A-Za-z]", label)
    if not found:
        name = str(row.get("Name") or "")
        found = re.search(r"\b\d{2,6}\s+[A-Za-z]", name)
        if found:
            label = name[found.start() :]
        else:
            return ""
    elif found.start():
        label = label[found.start() :]
    market = str(row.get("Market") or "").strip()
    blob = f"{label} {row.get('Name') or ''}".lower()
    hinted = ""
    for needle, place in (
        ("san tan valley", "San Tan Valley, AZ"),
        ("apache junction", "Apache Junction, AZ"),
        ("scottsdale", "Scottsdale, AZ"),
        ("gilbert", "Gilbert, AZ"),
        ("peoria", "Peoria, AZ"),
        ("tempe", "Tempe, AZ"),
        ("mesa", "Mesa, AZ"),
        ("henderson", "Henderson, NV"),
        ("north las vegas", "North Las Vegas, NV"),
        ("north miami", "North Miami, FL"),
    ):
        if needle in blob:
            hinted = place
            break
    if "," in label and hinted:
        street = label.split(",")[0].strip()
        return f"{street}, {hinted}"
    if "," in label:
        suffix = {"PHX": "AZ", "LAS": "NV", "MIA": "FL", "SNA": "CA"}.get(market, "")
        return f"{label}, {suffix}".strip(", ")
    place = hinted or {"PHX": "Phoenix, AZ", "LAS": "Las Vegas, NV", "MIA": "Miami, FL", "SNA": "California"}.get(market, "")
    return f"{label}, {place}".strip(", ")


def _census_geocode(query: str) -> tuple[float, float] | None:
    url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + urllib.parse.urlencode(
        {"address": query, "benchmark": "Public_AR_Current", "format": "json"}
    )
    request = urllib.request.Request(url, headers={"User-Agent": "sites-map-build"})
    with urllib.request.urlopen(request, timeout=25) as response:
        payload = json.loads(response.read().decode())
    matches = (payload.get("result") or {}).get("addressMatches") or []
    if not matches:
        return None
    coords = matches[0].get("coordinates") or {}
    return float(coords["x"]), float(coords["y"])


def _nominatim_geocode(query: str) -> tuple[float, float] | None:
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 1, "countrycodes": "us"}
    )
    request = urllib.request.Request(url, headers={"User-Agent": "sites-map-build/1.0 (site sourcing map)"})
    with urllib.request.urlopen(request, timeout=25) as response:
        payload = json.loads(response.read().decode())
    if not payload:
        return None
    return float(payload[0]["lon"]), float(payload[0]["lat"])


def geocode_queries(query: str) -> list[str]:
    """Try the market city, then the state alone.

    A Broward street such as 7520 W McNab Rd does not match when the query
    forces Miami, and the state-only query does.
    """
    queries = [query]
    broader = re.sub(
        r",\s*(?:Phoenix|Las Vegas|Miami),\s*(AZ|NV|FL)\s*$",
        r", \1",
        query,
        count=1,
        flags=re.I,
    )
    if broader != query:
        queries.append(broader)
    return queries


def _geocode_once(query: str) -> tuple[float, float] | None:
    coords = None
    try:
        coords = _census_geocode(query)
    except Exception:
        coords = None
    if coords is None:
        try:
            coords = _nominatim_geocode(query)
        except Exception:
            coords = None
    return coords


def geocode_address(query: str, cache: dict) -> tuple[float, float] | None:
    if not query:
        return None
    for attempt in geocode_queries(query):
        if attempt in cache:
            found = cache[attempt]
            if not found:
                continue
            return float(found[0]), float(found[1])
        coords = _geocode_once(attempt)
        cache[attempt] = list(coords) if coords else None
        if coords:
            return coords
    return None


def haversine_miles(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    arc = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(arc))


def build_deal_layer(
    pipeline_rows: list[dict],
    land_rows: list[dict],
    sites: list[dict],
    depots: list[dict],
    reg: dict | None = None,
    outreach: dict[str, str] | None = None,
    photo_rows: list[dict] | None = None,
) -> tuple[dict, dict]:
    reg = reg if reg is not None else registry_load()
    cache = {}
    if GEOCODE_CACHE.exists():
        cache = json.loads(GEOCODE_CACHE.read_text())
    by_apn, by_street = universe_match_index(sites)
    outreach = outreach or {}
    photo_index = index_photos(photo_rows)

    def match_row(row: dict) -> str | None:
        city = str(row.get("Market") or "").strip()
        return match_workbook_site(city, row.get("APN or folio"), deal_place_label(row), by_apn, by_street)

    features = []
    failed = []
    matched = 0
    expected_folders: list[tuple[str, str, str]] = []
    for kind, rows in (("pipeline", pipeline_rows), ("land", land_rows)):
        for index, row in enumerate(rows, start=1):
            city = str(row.get("Market") or "").strip() or "UNK"
            label = deal_place_label(row)
            deal_id = shipped_deal_id(row, kind, index, reg)
            universe_id = match_row(row)
            if city == "UNK" and universe_id:
                linked_market = next((item.get("city") for item in sites if item.get("site_id") == universe_id), "")
                if linked_market in {"PHX", "LAS", "MIA"}:
                    city = linked_market
            if universe_id:
                matched += 1
            broker, firm = split_broker(row.get("Broker"))
            price = parse_price(row.get("Asking price ($)"))
            if is_off_market_row(row):
                continue
            url = listing_url_from_row(row)
            source_line, source_kind = deal_source(row, url)
            blob = " ".join(str(row.get(col) or "") for col in ("Listing link", "What we know", "Land evidence", "Next step"))
            coords = google_coords(blob)
            status = "from listing" if coords else ""
            if coords is None:
                query = _geocode_query(row)
                coords = geocode_address(query, cache) if query else None
                status = "geocoded" if coords else "failed"
            else:
                status = "listing"
            lon = lat = None
            miles = None
            if coords:
                lon, lat = coords
                miles = nearest_depot_miles(lon, lat, depots)
            else:
                linked_site = next((item for item in sites if item.get("site_id") == universe_id), None) if universe_id else None
                if linked_site and linked_site.get("lat") is not None and linked_site.get("lon") is not None:
                    lon = float(linked_site["lon"])
                    lat = float(linked_site["lat"])
                    coords = (lon, lat)
                    miles = nearest_depot_miles(lon, lat, depots)
                    status = "linked site"
                else:
                    failed.append({"deal_id": deal_id, "city": city, "kind": kind, "label": label, "stage": str(row.get("Stage") or "")})
            address = re.sub(r"^(PHX|LAS|MIA|SNA)\s+", "", label, flags=re.I)
            source = firm or broker or ("Listing" if url else "")
            folder = folder_url_from_row(row)
            if folder:
                expected_folders.append((deal_id, folder, universe_id or ""))
            props = {
                "deal_id": deal_id,
                "kind": kind,
                "name": scrub(row.get("Name") or address)[:160],
                "address": scrub(address)[:180],
                "city": city,
                "stage": display_stage(row.get("Stage")),
                "stage_group": stage_group(row.get("Stage")),
                "broker": broker[:120],
                "firm": firm[:160],
                "listing_url": url[:400],
                "folder_url": folder,
                "asking_price": price,
                "asking_price_display": money(price) if price else None,
                "asking_price_source": scrub(source)[:160],
                "next_step": clean_deal_note(row.get("Next step"))[:400],
                "universe_id": universe_id or "",
                "coord_status": status,
                "miles_to_depot": miles,
                "listed": str(row.get("Listing status") or "").strip() == "Listed",
                "listing_removed": listing_gone(row.get("Listing status")),
                "parcel_match": "",
                "parcel_acres": None,
                "source_line": source_line,
                "source_kind": source_kind,
                "business_type": business_type_from_row(row),
                "is_c_store": deal_is_c_store(
                    kind,
                    str(row.get("Segment") or row.get("Segment group") or ""),
                    scrub(row.get("Name") or address)[:160],
                ),
                "broker_contacted": bool(outreach.get(deal_id)),
                "last_broker_contact": outreach.get(deal_id) or "",
                "apn": apn_text(row.get("APN or folio") or row.get("APN") or ""),
                **key_figures(row, kind),
                **photo_fields(row, kind, deal_id, photo_index),
                **nda_mirror_fields(row),
            }
            if props["business_type"] not in BUSINESS_TYPES:
                raise SystemExit(f"{deal_id} business type is not allowed: {props['business_type']}")
            extra = set(props) - set(DEAL_FIELDS)
            if extra:
                raise SystemExit("Deal fields outside the whitelist: " + ", ".join(sorted(extra)))
            if deal_text_problems(deal_id, props):
                props["next_step"] = ""
                if _DEAL_PRIVATE.search(props["asking_price_source"] or "") or _DEAL_LEAK.search(props["asking_price_source"] or ""):
                    props["asking_price_source"] = firm or ""
            if deal_text_problems(deal_id, props):
                raise SystemExit("Deal text still has internal wording: " + "; ".join(deal_text_problems(deal_id, props)[:3]))
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]} if lon is not None else None,
                    "properties": props,
                }
            )
    GEOCODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    GEOCODE_CACHE.write_text(json.dumps(cache, indent=2))
    pipeline = [item for item in features if item["properties"]["kind"] == "pipeline"]
    land = [item for item in features if item["properties"]["kind"] == "land"]
    gap = universe_link_gap(features)
    report = {
        "pipeline": len(pipeline),
        "land": len(land),
        "matched": matched,
        "unmatched": len(features) - matched,
        "shipped_linked": gap["linked"],
        "located_without_universe": gap["located_without_universe"],
        "unlocated_without_universe": gap["unlocated_without_universe"],
        "located_without_universe_ids": [item["deal_id"] for item in gap["located_missing"]],
        "universe_gap_note": (
            "A deal joins the universe when the Universe tab has a counted row for that place. "
            "The map links by parcel or a unique street and does not invent a row, a coordinate, or a parcel number."
        ),
        "geocode_failed": failed,
        "pipeline_by_city": dict(Counter(item["properties"]["city"] for item in pipeline)),
        "pipeline_by_stage": dict(Counter(item["properties"]["stage"] for item in pipeline)),
        "pipeline_by_group": dict(Counter(item["properties"]["stage_group"] for item in pipeline)),
        "land_by_city": dict(Counter(item["properties"]["city"] for item in land)),
        "land_by_group": dict(Counter(item["properties"]["stage_group"] for item in land)),
    }
    # Prefer a live pipeline deal when several rows point at one universe site.
    rank = {"desk": 0, "sourced": 1, "financial": 2, "checks": 3, "close": 4, "contacted": 2, "later": 4, "dropped": 5}
    best: dict[str, dict] = {}
    for feature in features:
        props = feature["properties"]
        universe_id = props["universe_id"]
        if not universe_id:
            continue
        # A pipeline deal outranks a land deal in the same stage. Land deals still link.
        score = rank.get(props["stage_group"], 9) + (0 if props["kind"] == "pipeline" else 0.5)
        current = best.get(universe_id)
        current_score = rank.get(current["stage_group"], 9) + (0 if current and current["kind"] == "pipeline" else 0.5) if current else 99
        if current is None or score < current_score:
            best[universe_id] = props
    by_universe: dict[str, list[dict]] = {}
    for feature in features:
        uid = feature["properties"].get("universe_id") or ""
        if uid:
            by_universe.setdefault(uid, []).append(feature["properties"])

    def _has_photo_pack(props: dict) -> bool:
        return bool(props.get("photos") or props.get("photo_status") or props.get("street_view_url"))

    for site in sites:
        link = best.get(site["site_id"])
        site["linked_deal_id"] = link["deal_id"] if link else ""
        site["linked_deal_name"] = link["name"] if link else ""
        site["linked_deal_stage"] = link["stage"] if link else ""
        site["contacted"] = bool(link and link.get("broker_contacted"))
        listing = ""
        if site.get("listed"):
            if link and link.get("listing_url"):
                listing = link["listing_url"]
            else:
                for props in by_universe.get(site["site_id"], []):
                    if props.get("listing_url"):
                        listing = props["listing_url"]
                        break
        site["listing_url"] = listing
        folder = ""
        if link and link.get("folder_url"):
            folder = link["folder_url"]
        else:
            for props in by_universe.get(site["site_id"], []):
                if props.get("folder_url"):
                    folder = props["folder_url"]
                    break
        if folder:
            site["folder_url"] = folder
        elif "folder_url" in site:
            site.pop("folder_url", None)
        donor = link if link and _has_photo_pack(link) else None
        if donor is None:
            for props in by_universe.get(site["site_id"], []):
                if _has_photo_pack(props):
                    donor = props
                    break
        site["photos"] = list((donor or {}).get("photos") or [])
        for key in ("photo_status", "photo_diligence_count", "photo_listing_count", "photos_checked", "photo_notes"):
            if donor and donor.get(key) not in (None, ""):
                site[key] = donor[key]
            elif key in site:
                site.pop(key, None)
        if donor and donor.get("street_view_url"):
            site["street_view_url"] = donor["street_view_url"]
    problems = folder_link_problems(expected_folders, features, sites)
    if problems:
        raise SystemExit("A Folder URL was dropped.\n" + "\n".join(problems[:20]))
    report["listing_links"] = {
        "pipeline": _listing_split(pipeline),
        "land": _listing_split(land),
        "listed_sites_with_link": sum(1 for site in sites if site.get("listed") and site.get("listing_url")),
        "listed_sites": sum(1 for site in sites if site.get("listed")),
    }
    report["source_lines"] = dict(Counter(item["properties"].get("source_kind") or "" for item in features))
    distinct_pipeline_names(sites, features)
    return {"type": "FeatureCollection", "features": features}, report


def _listing_split(features: list[dict]) -> dict:
    out: dict[str, dict] = {}
    for feature in features:
        props = feature["properties"]
        city = props.get("city") or "?"
        bucket = out.setdefault(city, {"with_link": 0, "without_link": 0})
        if props.get("listing_url"):
            bucket["with_link"] += 1
        else:
            bucket["without_link"] += 1
    return out


def nearest_depot_miles(lon: float, lat: float, depots: list[dict]) -> float | None:
    best = None
    for depot in depots:
        geometry = depot.get("geometry") or {}
        coords = geometry.get("coordinates")
        if not coords:
            continue
        miles = haversine_miles(lon, lat, float(coords[0]), float(coords[1]))
        if best is None or miles < best:
            best = miles
    return round(best, 2) if best is not None else None


_SITE_ID = re.compile(r"^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$")


def permanent_site_id(row: dict, kind: str) -> str | None:
    """Use column CK when it is present and well formed. A wrong tab prefix is an error."""
    if "Site ID" not in row:
        return None
    raw = str(row.get("Site ID") or "").strip().upper()
    tab = "Pipeline" if kind == "pipeline" else "Land Sites"
    row_no = row.get("_excel_row", "?")
    if not raw or not _SITE_ID.fullmatch(raw):
        return None
    prefix = "PIPE" if kind == "pipeline" else "LAND"
    if not raw.startswith(prefix + "-"):
        raise SystemExit(f"Site ID {raw} on {tab} row {row_no} does not match the tab")
    return raw


def assert_unique_site_ids(pipeline_rows: list[dict], land_rows: list[dict]) -> None:
    seen: dict[str, str] = {}
    for tab, kind, rows in (("Pipeline", "pipeline", pipeline_rows), ("Land Sites", "land", land_rows)):
        for row in rows:
            if "Site ID" not in row:
                continue
            raw = str(row.get("Site ID") or "").strip().upper()
            if not raw or not _SITE_ID.fullmatch(raw):
                continue
            prefix = "PIPE" if kind == "pipeline" else "LAND"
            row_no = row.get("_excel_row", "?")
            if not raw.startswith(prefix + "-"):
                raise SystemExit(f"Site ID {raw} on {tab} row {row_no} does not match the tab")
            place = f"{tab} row {row_no}"
            if raw in seen:
                raise SystemExit(f"Duplicate Site ID {raw} on {seen[raw]} and {place}")
            seen[raw] = place


def site_id_warnings(pipeline_rows: list[dict], land_rows: list[dict]) -> list[str]:
    notes = []
    for tab, rows in (("Pipeline", pipeline_rows), ("Land Sites", land_rows)):
        if not rows:
            continue
        if not any("Site ID" in row for row in rows):
            notes.append(f"{tab} has no Site ID column; row order is still in use.")
            continue
        for row in rows:
            raw = str(row.get("Site ID") or "").strip()
            if raw and _SITE_ID.fullmatch(raw.upper()):
                continue
            notes.append(f"{tab} row {row.get('_excel_row', '?')} has no usable Site ID")
    return notes


def shipped_deal_id(row: dict, kind: str, index: int, reg: dict) -> str:
    """Permanent Site ID, otherwise an existing registry id, otherwise the row position."""
    permanent = permanent_site_id(row, kind)
    if permanent:
        return permanent
    city = str(row.get("Market") or "").strip() or "UNK"
    prefix = "PIPE" if kind == "pipeline" else "LAND"
    derived = f"{prefix}-{city}-{index:04d}"
    if "Site ID" not in row:
        return derived
    label = str(row.get("Site") or "").strip()
    existing = (reg.get("by_key") or {}).get(f"{kind}|{label}")
    return existing or derived


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


def prefer_broward(address: str, lat) -> bool:
    """Broward street cities, and pins north of the Miami-Dade parcel layer."""
    if looks_broward(address):
        return True
    return isinstance(lat, (int, float)) and not isinstance(lat, bool) and lat > BROWARD_NORTH_OF


def _broward_folio(token: str) -> str:
    """Broward folios are 12 characters. A 13-digit value is a Miami-Dade folio."""
    if not token:
        return ""
    if token.isdigit():
        if len(token) > 12:
            return ""
        return token.zfill(12)
    return token if len(token) >= 6 else ""


def _annotate_broward(feat: dict, match: str) -> dict:
    props = feat.get("properties") or {}
    sqft = first_number(props.get("GIS_SQUARE_FOOT"))
    feat["county"] = "Broward"
    feat["apn"] = str(props.get("FOLIO") or "")
    feat["match"] = match
    feat["acres"] = round(sqft / 43560, 3) if sqft else None
    feat["owner"] = props.get("NAME_LINE_1") or ""
    return feat


def _broward_query(params: dict) -> dict | None:
    return http_geojson(BROWARD_PARCEL_QUERY + "?" + urllib.parse.urlencode(params))


def fetch_broward_by_apn(apn: str) -> dict | None:
    for token in apn_tokens(apn):
        folio = _broward_folio(token)
        if not folio:
            continue
        feat = _broward_query(
            {
                "where": f"FOLIO='{folio.replace(chr(39), chr(39) * 2)}'",
                "outFields": BROWARD_PARCEL_FIELDS,
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "geojson",
            }
        )
        if feat:
            return _annotate_broward(feat, "parcel number")
    return None


def fetch_broward_at_point(lon: float, lat: float) -> dict | None:
    feat = _broward_query(
        {
            "geometry": f"{lon},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": BROWARD_PARCEL_FIELDS,
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        }
    )
    if not feat:
        return None
    return _annotate_broward(feat, "pin location")


def fetch_dade_by_apn(apn: str) -> dict | None:
    for token in apn_tokens(apn):
        folio = token.zfill(13) if token.isdigit() else token
        url = (
            "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query?"
            + urllib.parse.urlencode(
                {
                    "where": f"FOLIO='{folio}'",
                    "outFields": "FOLIO,TRUE_OWNER1,LOT_SIZE,DOR_DESC",
                    "returnGeometry": "true",
                    "outSR": "4326",
                    "f": "geojson",
                }
            )
        )
        feat = http_geojson(url)
        if feat:
            props = feat.get("properties") or {}
            feat["county"] = "Miami-Dade"
            feat["apn"] = folio
            feat["match"] = "parcel number"
            lot = first_number(props.get("LOT_SIZE"))
            feat["acres"] = round(lot / 43560, 3) if lot else None
            feat["owner"] = props.get("TRUE_OWNER1") or ""
            feat["land_use"] = str(props.get("DOR_DESC") or "")
            return feat
    return None


def fetch_dade_at_point(lon: float, lat: float) -> dict | None:
    params = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "outFields": "FOLIO,TRUE_OWNER1,LOT_SIZE,DOR_DESC",
    }
    base = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query"
    feat = http_geojson(base + "?" + urllib.parse.urlencode(params))
    if not feat:
        return None
    props = feat.get("properties") or {}
    feat["county"] = "Miami-Dade"
    feat["apn"] = str(props.get("FOLIO") or "")
    feat["match"] = "pin location"
    raw_acres = first_number(props.get("LOT_SIZE"))
    feat["acres"] = round(raw_acres / 43560, 3) if raw_acres else None
    feat["owner"] = props.get("TRUE_OWNER1") or ""
    if props.get("DOR_DESC"):
        feat["land_use"] = str(props.get("DOR_DESC") or "")
    return feat


def _simplify_geom(geom: dict, tolerance: float = 0.00008) -> dict:
    if not geom:
        return geom
    kind = geom.get("type")
    coords = geom.get("coordinates")
    if kind == "Polygon":
        return {"type": "Polygon", "coordinates": [_simplify_ring(ring, tolerance) for ring in coords]}
    if kind == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[_simplify_ring(ring, tolerance) for ring in poly] for poly in coords]}
    return geom


def _simplify_ring(ring: list, tolerance: float) -> list:
    if len(ring) < 5:
        return ring
    closed = ring[0] == ring[-1]
    body = ring[:-1] if closed else ring
    simple = _rdp(body, tolerance)
    if len(simple) < 3:
        simple = body[:3]
    if closed and simple[0] != simple[-1]:
        simple = simple + [simple[0]]
    return simple


def _rdp(points: list, tolerance: float) -> list:
    if len(points) < 3:
        return points
    end = len(points) - 1
    farthest = 0.0
    index = 0
    for i in range(1, end):
        distance = _perp(points[i], points[0], points[end])
        if distance > farthest:
            farthest = distance
            index = i
    if farthest > tolerance:
        left = _rdp(points[: index + 1], tolerance)
        right = _rdp(points[index:], tolerance)
        return left[:-1] + right
    return [points[0], points[end]]


def _perp(point, start, end) -> float:
    if start == end:
        return ((point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2) ** 0.5
    dx, dy = end[0] - start[0], end[1] - start[1]
    scale = dx * dx + dy * dy
    if scale == 0:
        return 0.0
    t = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / scale))
    x, y = start[0] + t * dx, start[1] + t * dy
    return ((point[0] - x) ** 2 + (point[1] - y) ** 2) ** 0.5


def fetch_parcel(city: str, apn: str, address: str, lon: float | None = None, lat: float | None = None) -> dict | None:
    tokens = apn_tokens(apn)
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
                        "outFields": "PARCEL,ASSR_ACRES,OWNER",
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
                feat["match"] = "parcel number"
                feat["acres"] = first_number((feat.get("properties") or {}).get("ASSR_ACRES"))
                feat["owner"] = (feat.get("properties") or {}).get("OWNER") or ""
                return feat
    elif city == "PHX":
        for token in tokens:
            url = (
                "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1/query?"
                + urllib.parse.urlencode(
                    {
                        "where": f"APN='{token}'",
                        "outFields": "APN,LotSize_Acre,OwnerName",
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
                feat["match"] = "parcel number"
                feat["acres"] = first_number((feat.get("properties") or {}).get("LotSize_Acre"))
                feat["owner"] = (feat.get("properties") or {}).get("OwnerName") or ""
                return feat
    elif city == "MIA":
        primary = fetch_broward_by_apn(apn) if prefer_broward(address, lat) else fetch_dade_by_apn(apn)
        if primary:
            return primary
    if lon is not None and lat is not None:
        found = fetch_parcel_at_point(city, lon, lat, address)
        if found:
            return found
        if city == "MIA":
            # The pin can sit on the other side of the county line from the address hint.
            if prefer_broward(address, lat):
                found = fetch_dade_by_apn(apn) or fetch_dade_at_point(lon, lat)
            else:
                found = fetch_broward_by_apn(apn) or fetch_broward_at_point(lon, lat)
            if found:
                return found
    return None


def fetch_parcel_at_point(city: str, lon: float, lat: float, address: str) -> dict | None:
    if city == "MIA" and prefer_broward(address, lat):
        return fetch_broward_at_point(lon, lat)
    params = {
        "geometry": f"{lon},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    if city == "LAS":
        base = "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/CC_PARCELS_SHP/FeatureServer/1/query"
        params["outFields"] = "PARCEL,ASSR_ACRES,OWNER"
        county, apn_key, acres_key, owner_key = "Clark", "PARCEL", "ASSR_ACRES", "OWNER"
    elif city == "PHX":
        base = "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1/query"
        params["outFields"] = "APN,LotSize_Acre,OwnerName"
        county, apn_key, acres_key, owner_key = "Maricopa", "APN", "LotSize_Acre", "OwnerName"
    elif city == "MIA":
        return fetch_dade_at_point(lon, lat)
    else:
        return None
    feat = http_geojson(base + "?" + urllib.parse.urlencode(params))
    if not feat:
        return None
    props = feat.get("properties") or {}
    feat["county"] = county
    feat["apn"] = str(props.get(apn_key) or "")
    feat["match"] = "pin location"
    raw_acres = first_number(props.get(acres_key)) if acres_key else None
    if county == "Miami-Dade" and raw_acres:
        raw_acres = round(raw_acres / 43560, 3)
    feat["acres"] = raw_acres
    feat["owner"] = props.get(owner_key) or ""
    if props.get("DOR_DESC"):
        feat["land_use"] = str(props.get("DOR_DESC") or "")
    return feat


def http_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": "sites-map-build"})
    payload = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except Exception:
            payload = None
        if isinstance(payload, dict) and not payload.get("error"):
            return payload
        if attempt < 2:
            time.sleep(0.5 * (attempt + 1))
    return None


def http_features(url: str) -> list[dict]:
    payload = http_json(url)
    if not payload:
        return []
    return payload.get("features") or []


def http_geojson(url: str) -> dict | None:
    features = http_features(url)
    if not features:
        return None
    geom = features[0].get("geometry")
    if not geom:
        return None
    try:
        simple = _simplify_geom(geom)
    except (TypeError, ValueError, IndexError):
        return None
    return {"geometry": simple, "properties": features[0].get("properties") or {}}


def load_parcel_cache() -> dict:
    if PARCEL_CACHE.exists():
        return json.loads(PARCEL_CACHE.read_text())
    return {}


def parcel_targets(sites: list[dict], deals: list[dict]) -> list[tuple[str, dict]]:
    wanted = []
    seen = set()
    for site in sites:
        if site.get("origin") == "off-market":
            if site.get("lon") is None or site.get("lat") is None:
                continue
            key = f"site|{site['site_id']}"
            if key not in seen and site.get("city") in {"PHX", "LAS", "MIA"}:
                seen.add(key)
                wanted.append((key, {"kind": "site", "record": site}))
            continue
        if site.get("land_only") or site.get("origin") != "universe" or site.get("duplicate_of"):
            continue
        if not site.get("counts_as_site") or not site.get("in_area"):
            continue
        if site["city"] not in {"PHX", "LAS", "MIA"}:
            continue
        key = f"site|{site['site_id']}"
        if key in seen:
            continue
        seen.add(key)
        wanted.append((key, {"kind": "site", "record": site}))
    for feature in deals:
        props = feature.get("properties") or {}
        if props.get("city") not in {"PHX", "LAS", "MIA"}:
            continue
        if not feature.get("geometry"):
            continue
        key = f"deal|{props.get('deal_id')}"
        if key in seen:
            continue
        seen.add(key)
        wanted.append((key, {"kind": "deal", "record": props, "geometry": feature.get("geometry")}))
    return wanted


def _parcel_usable(cached) -> bool:
    return isinstance(cached, dict) and bool(cached.get("geometry"))


def _needs_adjoining(record: dict) -> bool:
    if record.get("tier_from_adjoining"):
        return True
    value = record.get("spare_ac_adjoining")
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def build_parcels(sites: list[dict], refresh: bool, deals: list[dict] | None = None) -> tuple[list[dict], dict]:
    cache = {} if refresh else load_parcel_cache()
    # Misses cached before the pin-location fallback are not results.
    if not refresh and cache.pop("_point_fallback", None) != 1:
        for key in list(cache):
            if not _parcel_usable(cache.get(key)):
                cache.pop(key, None)
    cache["_point_fallback"] = 1
    wanted = parcel_targets(sites, deals or [])
    features = []
    stats = Counter()
    todo = []
    for key, target in wanted:
        cached = cache.get(key)
        if _parcel_usable(cached) and not refresh:
            stats["cache_hit"] += 1
            continue
        todo.append((key, target))

    def job(item):
        key, target = item
        record = target["record"]
        city = record.get("city") or ""
        address = record.get("address") or ""
        lon = lat = None
        geometry = target.get("geometry") or {}
        if geometry.get("type") == "Point":
            lon, lat = geometry["coordinates"]
        elif record.get("lon") is not None and record.get("lat") is not None:
            lon, lat = record.get("lon"), record.get("lat")
        found = fetch_parcel(city, record.get("apn") or "", address, lon, lat)
        return key, found, "fetched" if found else "not_found"

    if todo:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(job, item) for item in todo]
            for fut in as_completed(futures):
                key, found, label = fut.result()
                cache[key] = found
                stats[label] += 1
    by_city = Counter()
    by_method = Counter()
    adjoining_count = 0
    for key, target in wanted:
        cached = cache.get(key)
        record = target["record"]
        if _parcel_usable(cached):
            _stamp_parcel(record, cached)
            _attach_adjoining(target, cached)
            features.append(parcel_feature(target, cached))
            for extra in cached.get("adjoining") or []:
                features.append(adjoining_feature(target, cached, extra))
                adjoining_count += 1
            by_city[record.get("city") or "?"] += 1
            by_method[cached.get("match") or "none"] += 1
        else:
            record["parcel_match"] = "none"
            if record.get("deal_id"):
                record["parcel_acres"] = None
    coverage = {}
    by_layer: dict[str, dict] = {}
    none_rows = []
    for key, target in wanted:
        record = target["record"]
        city = record.get("city") or "?"
        kind = "universe" if target.get("kind") == "site" else (record.get("kind") or "deal")
        bucket = coverage.setdefault(city, {"targets": 0, "matched": 0, "none": 0})
        layer = by_layer.setdefault(kind, {}).setdefault(city, {"targets": 0, "matched": 0, "none": 0, "no_geometry": 0})
        bucket["targets"] += 1
        layer["targets"] += 1
        if _parcel_usable(cache.get(key)):
            bucket["matched"] += 1
            layer["matched"] += 1
        else:
            bucket["none"] += 1
            layer["none"] += 1
            none_rows.append(
                {
                    "id": record.get("site_id") or record.get("deal_id"),
                    "city": city,
                    "kind": kind,
                    "reason": _miss_reason(target),
                }
            )
    for bucket in coverage.values():
        bucket["pct"] = round(100.0 * bucket["matched"] / bucket["targets"], 1) if bucket["targets"] else 0
    for cities in by_layer.values():
        for bucket in cities.values():
            bucket["pct"] = round(100.0 * bucket["matched"] / bucket["targets"], 1) if bucket["targets"] else 0
    stats["features"] = len(features)
    stats["adjoining"] = adjoining_count
    stats["by_city"] = dict(by_city)
    stats["by_method"] = dict(by_method)
    global LAST_CACHE
    LAST_CACHE = cache
    return features, {
        "counts": dict(stats),
        "coverage": coverage,
        "by_layer": by_layer,
        "none_rows": none_rows,
        "note": parcel_note(stats),
    }


def _stamp_parcel(record: dict, found: dict) -> None:
    record["parcel_match"] = found.get("match") or "none"
    acres = found.get("acres")
    if isinstance(acres, (int, float)) and not isinstance(acres, bool) and acres > 0:
        record["parcel_acres"] = round(float(acres), 3)
        if record.get("site_id"):
            record["lot_ac_source"] = "County assessor"
    land_use = scrub(found.get("land_use") or "")
    if land_use and record.get("site_id"):
        record["land_use"] = land_use[:160]


def _target_point(target: dict) -> tuple[float | None, float | None]:
    record = target["record"]
    geometry = target.get("geometry") or {}
    if geometry.get("type") == "Point":
        lon, lat = geometry["coordinates"]
        return lon, lat
    if record.get("lon") is not None and record.get("lat") is not None:
        return record.get("lon"), record.get("lat")
    return None, None


def _miss_reason(target: dict) -> str:
    _lon, lat = _target_point(target)
    if lat is None:
        return "no coordinates"
    return "no parcel at this pin"


def _bbox(geom: dict, pad: float = 0.0006):
    xs: list[float] = []
    ys: list[float] = []

    def walk(value):
        if isinstance(value, list):
            if len(value) >= 2 and isinstance(value[0], (int, float)) and not isinstance(value[0], bool) and isinstance(value[1], (int, float)) and not isinstance(value[1], bool):
                xs.append(float(value[0]))
                ys.append(float(value[1]))
            else:
                for item in value:
                    walk(item)

    walk((geom or {}).get("coordinates"))
    if not xs:
        return None
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad


def lookup_owner(city: str, apn: str, county: str = "") -> str:
    token = norm_apn(apn)
    if not token:
        return ""
    if county == "Broward":
        folio = _broward_folio(token)
        if not folio:
            return ""
        base = BROWARD_PARCEL_QUERY
        where, field = f"FOLIO='{folio.replace(chr(39), chr(39) * 2)}'", "NAME_LINE_1"
    elif city == "LAS":
        base = "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/CC_PARCELS_SHP/FeatureServer/1/query"
        where, field = f"PARCEL='{token}'", "OWNER"
    elif city == "PHX":
        base = "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1/query"
        where, field = f"APN='{token}'", "OwnerName"
    elif city == "MIA":
        folio = token.zfill(13) if token.isdigit() else token
        base = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query"
        where, field = f"FOLIO='{folio}'", "TRUE_OWNER1"
    else:
        return ""
    payload = http_json(base + "?" + urllib.parse.urlencode({"where": where, "outFields": field, "returnGeometry": "false", "f": "json"}))
    for feat in (payload or {}).get("features") or []:
        attrs = feat.get("attributes") or feat.get("properties") or {}
        if attrs.get(field):
            return str(attrs[field])
    return ""


def fetch_adjoining(city: str, geom: dict, owner: str, apn: str, county: str = "") -> list[dict]:
    owner = (owner or "").strip()
    box = _bbox(geom)
    if not owner or not box:
        return []
    xmin, ymin, xmax, ymax = box
    envelope = json.dumps({"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax, "spatialReference": {"wkid": 4326}})
    safe = owner.replace("'", "''")
    if county == "Broward":
        base = BROWARD_PARCEL_QUERY
        where, out_fields, apn_key = f"NAME_LINE_1='{safe}'", "FOLIO,NAME_LINE_1", "FOLIO"
    elif city == "LAS":
        base = "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/CC_PARCELS_SHP/FeatureServer/1/query"
        where, out_fields, apn_key = f"OWNER='{safe}'", "PARCEL,OWNER", "PARCEL"
    elif city == "PHX":
        base = "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1/query"
        where, out_fields, apn_key = f"OwnerName='{safe}'", "APN,OwnerName", "APN"
    elif city == "MIA":
        base = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26/query"
        where, out_fields, apn_key = f"TRUE_OWNER1='{safe}'", "FOLIO,TRUE_OWNER1", "FOLIO"
    else:
        return []
    url = base + "?" + urllib.parse.urlencode(
        {
            "where": where,
            "geometry": envelope,
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": out_fields,
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": "12",
        }
    )
    subject = norm_apn(apn)
    found = []
    for feat in http_features(url):
        props = feat.get("properties") or {}
        token = norm_apn(props.get(apn_key))
        if subject and token == subject:
            continue
        geometry = feat.get("geometry")
        if not geometry:
            continue
        try:
            simple = _simplify_geom(geometry)
        except (TypeError, ValueError, IndexError):
            continue
        found.append({"geometry": simple, "apn": str(props.get(apn_key) or "")})
    return found


def _attach_adjoining(target: dict, cached: dict) -> None:
    record = target["record"]
    if target.get("kind") != "site" or not _needs_adjoining(record) or "adjoining" in cached:
        return
    owner = cached.get("owner") or ""
    county = cached.get("county") or ""
    if not owner:
        owner = lookup_owner(record.get("city") or "", cached.get("apn") or record.get("apn") or "", county)
        cached["owner"] = owner
    cached["adjoining"] = fetch_adjoining(
        record.get("city") or "",
        cached.get("geometry") or {},
        owner,
        cached.get("apn") or record.get("apn") or "",
        county,
    )


def parcel_feature(target: dict, cached: dict) -> dict:
    record = target["record"]
    identifier = record.get("site_id") or record.get("deal_id")
    return {
        "type": "Feature",
        "geometry": cached["geometry"],
        "properties": {
            "site_id": identifier,
            "apn": cached.get("apn") or record.get("apn") or "",
            "role": "parcel",
            "match": cached.get("match") or "parcel number",
            "county": cached.get("county"),
            "city": record.get("city"),
            "kind": target.get("kind") or "site",
        },
    }


def adjoining_feature(target: dict, cached: dict, extra: dict) -> dict:
    record = target["record"]
    identifier = record.get("site_id") or record.get("deal_id")
    return {
        "type": "Feature",
        "geometry": extra.get("geometry"),
        "properties": {
            "site_id": identifier,
            "apn": extra.get("apn") or "",
            "role": "adjoining",
            "match": "parcel number",
            "county": cached.get("county"),
            "city": record.get("city"),
            "kind": target.get("kind") or "site",
        },
    }


def parcel_note(stats: Counter) -> str:
    return (
        "Parcel outlines come from the Clark, Maricopa, Miami-Dade, and Broward assessor layers. "
        "A parcel number match is tried first, then the pin location. "
        f"Counts: {dict(stats)}."
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
    for row in existing:
        row["reviewer"] = neutral_author(row.get("reviewer") or "")
        row["source_file"] = neutral_source(row.get("source_file") or "")
        for key in ("notes", "parcel_evidence", "operating_evidence"):
            if key in row:
                row[key] = plain_note(row.get(key) or "")
    seen = {
        (
            row.get("site_id"),
            row.get("reviewer"),
            row.get("source_file"),
            row.get("adjudicated_verdict"),
            row.get("aerial_verdict"),
            row.get("notes"),
        )
        for row in existing
    }
    for row in new_rows:
        row["reviewer"] = neutral_author(row.get("reviewer") or "")
        row["source_file"] = neutral_source(row.get("source_file") or "")
        for key in ("notes", "parcel_evidence", "operating_evidence"):
            if key in row:
                row[key] = plain_note(row.get(key) or "")
        signature = (
            row.get("site_id"),
            row.get("reviewer"),
            row.get("source_file"),
            row.get("adjudicated_verdict"),
            row.get("aerial_verdict"),
            row.get("notes"),
        )
        if signature in seen:
            continue
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
            if folded in {"utility_proximity", "serving_utility", "serving_utility_source"}:
                problems.append(f"removed field still shipped at {path}.{key}")
            if folded in FORBIDDEN_KEYS or "ebitda" in folded or "most_can_pay" in folded:
                problems.append(f"forbidden key {path}.{key}")
            problems.extend(scan_obj(value, f"{path}.{key}"))
    elif isinstance(obj, list):
        for i, value in enumerate(obj[:5000]):
            problems.extend(scan_obj(value, f"{path}[{i}]"))
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
    return "not categorised"


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
        reviewer = neutral_author(scrub(record.get("reviewer") or "Incoming") or "Incoming")
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


def attach_universe_capacity(sites: list[dict]) -> None:
    """Copy universe fact layers A and B. Service and load stay off the site file."""
    if not sources_present():
        return
    from scripts.key_numbers import capacity_fields

    try:
        rows = sheet_rows(source_workbook(), "Universe", 0)
    except (SystemExit, OSError, KeyError, ValueError):
        return
    index: dict[tuple[str, str], dict] = {}
    for row in rows:
        city = str(row.get("Market") or "").strip()
        apn = norm_apn(row.get("APN"))
        if city and apn and (city, apn) not in index:
            index[(city, apn)] = row
    for site in sites:
        row = index.get((str(site.get("city") or ""), norm_apn(site.get("apn"))))
        if not row:
            continue
        site.update(capacity_fields(row, service=False))


def build(write: bool, refresh_parcels: bool, muse_file: str | None = None) -> dict:
    universe = load_csv(SRC / "universe_v3.csv")
    ring_rows = {row["site_id"]: row for row in load_csv(SRC / "las_ring100_screen.csv")}
    listings = load_csv(SRC / "listings_match_v3.csv")
    recon = load_reconciliation()
    muse_override = load_muse_file(Path(muse_file)) if muse_file else {}
    workbook = source_workbook()
    census = census_counts(workbook)
    universe_rows = load_universe_rows(workbook)
    pipeline_rows = sheet_rows(workbook, "Pipeline", 3)
    land_rows = sheet_rows(workbook, "Land Sites", 3)
    assert_unique_site_ids(pipeline_rows, land_rows)
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
            "also_known_as": "",
            "summary_why": "",
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
            "second_review_verdict": None,
            "serving_utility": "",
            "serving_utility_source": "",
            "owner_mail": "",
            "assessed_value_display": "",
            "full_cash_value_display": "",
            "last_sale_date": "",
            "last_sale_price_display": "",
            "year_built": "",
            "assessor_source": "",
            "zoning_source": "",
            "aadt_count": "",
            "aadt_road": "",
            "aadt_year": "",
            "aadt_source": "",
            "phone": "",
            "phone_source": "",
            "website": "",
            "website_source": "",
            "place_note": "",
            "place_note_source": "",
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
            "research_sources": "",
            "research_note": "",
            "business_type": "Car wash",
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
            "tier_from_adjoining": False,
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
        # listed_post counts off-market targets. A live listing is applied later.
        site["_source_listed"] = (row.get("listed_post") or "").strip() == "True" or (row.get("public_listing_freshscan") or "").strip() == "True"
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
                    "notes": "Aerial review only. It does not decide the county verdict.",
                    "aerial_verdict": aerial,
                    "land_verdict_provisional": aerial,
                    "operating_evidence_tier": "",
                    "retrieved_at": "2026-11-02",
                    "reviewer": "county check",
                    "supersedes": "",
                    "source_file": "universe_v3.csv",
                }
            )
            site["reviews"].append(
                {
                    "reviewer": "county check",
                    "kind": "aerial",
                    "verdict": aerial,
                    "provisional": True,
                    "spare_ac_own": site["spare_ac_own"],
                    "spare_ac_adjoining": None,
                    "confidence": scrub(row.get("aerial_conf")),
                    "date": "2026-11-02",
                    "note": "Aerial review only. The county check is still open.",
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
                    "reviewer": "county check",
                    "kind": "aerial",
                    "verdict": aerial,
                    "provisional": True,
                    "spare_ac_own": site["spare_ac_own"],
                    "spare_ac_adjoining": None,
                    "confidence": scrub(hit["confidence"]),
                    "date": "2026-11-02",
                    "note": "The land tier comes from the aerial measurement. It does not decide the county verdict.",
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
        site["second_review_verdict"] = muse_verdict
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
            site["scale_note"] = "Spare land is on a same-owner adjoining parcel. On this scale that is MAYBE."
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
                    "reviewer": "second review",
                    "supersedes": "",
                    "source_file": "second review column" if sid not in muse_override else "second review file",
                }
            )
            site["reviews"].append(
                {
                    "reviewer": "second review",
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
            crosswalk.append({"site_id": sid, "source": "second_review", "source_key": sid})
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
                "reviewer": "county check",
                "supersedes": "",
                "source_file": "reconciliation_final.xlsx",
            }
        )
        site["reviews"].append(
            {
                "reviewer": "county check",
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

    live_universe = apply_live_universe(
        universe_rows, sites, by_id, by_apn, blank_site, screening, verdict_rows, crosswalk
    )

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

    match_apn, match_street = universe_match_index(sites)

    def match_universe(city: str, apn_value, address_text: str) -> str | None:
        return match_workbook_site(city, apn_value, address_text, match_apn, match_street)

    off_market_matched: list[dict] = []
    off_market_unmatched: list[dict] = []

    def attach_off_market_research(site: dict, row: dict) -> None:
        records = [part.strip() for part in (site.get("research_sources") or "").split(";") if part.strip()]
        for record in _source_records(row.get("Source of the numbers")):
            if record not in records:
                records.append(record)
        site["research_sources"] = "; ".join(records)[:400]
        note = clean_research_text(row)
        evidence = site.get("evidence") or ""
        prior = site.get("research_note") or ""
        if note and note not in prior and note not in evidence:
            site["research_note"] = (prior + " " + note).strip()[:700]

    def absorb_workbook_row(row: dict, kind: str):
        city = str(row.get("Market") or "").strip() or "UNK"
        label = str(row.get("Site") or "").strip()
        if is_off_market_row(row):
            matched = match_universe(city, row.get("APN or folio"), label)
            entry = {
                "city": city,
                "kind": kind,
                "label": scrub(label)[:160],
                "name": scrub(row.get("Name"))[:120],
                "apn": str(row.get("APN or folio") or ""),
                "universe_id": matched or "",
            }
            if matched:
                attach_off_market_research(by_id[matched], row)
                off_market_matched.append(entry)
            else:
                place_unmatched_off_market(row, city, label, entry)
            return
        key = f"{kind}|{label}"
        permanent = permanent_site_id(row, kind)
        if permanent:
            assigned = permanent
            reg["by_key"][key] = permanent
        else:
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
        person, firm_name = split_broker(row.get("Broker"))
        source = firm_name or person or "Listing"
        url = str(row.get("Listing link") or "").strip()
        status = "verified" if url else ("inferred" if price else None)
        attach_price(site, price, source or "Pipeline workbook", url, row.get("Last checked live"), status)
        if str(row.get("Listing status") or "").strip() == "Listed":
            site["listed"] = True
        crosswalk.append({"site_id": site["site_id"], "source": "Pipeline" if kind == "pipeline" else "Land Sites", "source_key": label})

    off_market_cache = json.loads(GEOCODE_CACHE.read_text()) if GEOCODE_CACHE.exists() else {}
    off_market_seq: Counter = Counter()

    def _geom_centroid(geom: dict) -> tuple[float, float] | None:
        ring = None
        if geom.get("type") == "Polygon":
            ring = (geom.get("coordinates") or [[]])[0]
        elif geom.get("type") == "MultiPolygon":
            ring = ((geom.get("coordinates") or [[[]]])[0] or [[]])[0]
        if not ring:
            return None
        lon = sum(point[0] for point in ring) / len(ring)
        lat = sum(point[1] for point in ring) / len(ring)
        return lon, lat

    def place_unmatched_off_market(row: dict, city: str, label: str, entry: dict) -> None:
        """A site the census does not have. Drawn on its own layer, not in the funnel."""
        if city not in {"PHX", "LAS", "MIA"}:
            off_market_unmatched.append(entry)
            return
        off_market_seq[city] += 1
        sid = f"OFF-{city}-{off_market_seq[city]:04d}"
        site = blank_site(sid, city)
        site["origin"] = "off-market"
        site["counts_as_site"] = False
        site["in_area"] = False
        site["name"] = scrub(row.get("Name") or label)[:160]
        site["address"] = scrub(re.sub(r"^(PHX|LAS|MIA|SNA)\s+", "", label, flags=re.I))[:180]
        site["apn"] = str(row.get("APN or folio") or "")
        site["business_type"] = business_type_from_row(row)
        attach_off_market_research(site, row)
        query = _geocode_query(row)
        coords = geocode_address(query, off_market_cache) if query else None
        if coords is None and site["apn"]:
            found = fetch_parcel(city, site["apn"], site["address"])
            if found and found.get("geometry"):
                coords = _geom_centroid(found["geometry"])
        if coords:
            site["lon"], site["lat"] = float(coords[0]), float(coords[1])
            site["coord_status"] = "known"
        sites.append(site)
        by_id[sid] = site
        entry["site_id"] = sid
        entry["placed"] = site.get("coord_status") == "known"
        off_market_unmatched.append(entry)

    for row in pipeline_rows:
        absorb_workbook_row(row, "pipeline")
    for row in land_rows:
        absorb_workbook_row(row, "land")
    GEOCODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    GEOCODE_CACHE.write_text(json.dumps(off_market_cache))

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
        # Charleston Car Wash (LAS-U1516, 1961 E Charleston) and the Chandler
        # Quick Quack (PHX-U519, 7455 W Chandler) stay Maybe until reviewed.
        # Terrible's #153 (LAS-U100, 4070 Arville St) stays cleared. This export
        # has 12 Pass rows after those two holds, and 10 of them are cleared on the map.
        if site["site_id"] in {"LAS-U1516", "PHX-U519"}:
            site["verdict"] = "MAYBE"
            if site.get("network_status") == "cleared":
                site["network_status"] = None
        elif site["site_id"] == "LAS-U100":
            site["verdict"] = "PASS"
            site["network_status"] = "cleared"
        if site.get("verdict"):
            site["verification"] = "county-checked"
        elif site.get("aerial_fit"):
            site["verification"] = "aerial only, pending verification"
        else:
            site["verification"] = "not screened"
        verdict = site.get("verdict")
        # FAIL and not-a-wash are eliminated. They do not keep an L10 or L4 tier.
        if verdict in {"FAIL", "NOT_A_WASH"}:
            site["land_tier"] = None
        elif verdict and not site.get("land_tier"):
            derived = tier_from_acres(site.get("spare_ac_own"), site.get("spare_ac_adjoining"))
            if derived:
                site["land_tier"] = derived
        tier = site.get("land_tier")
        own_sqft = (site.get("spare_ac_own") or 0) * 43560
        adj_sqft = (site.get("spare_ac_adjoining") or 0) * 43560
        tier_line = FIT10_SQFT if tier == "L10" else FIT4_SQFT if tier == "L4" else None
        site["tier_from_adjoining"] = bool(tier_line is not None and own_sqft < tier_line <= adj_sqft)
        eliminated = verdict in {"FAIL", "NOT_A_WASH"} or site["tenure_fail"]
        land_fit = tier in {"L10", "L4"}
        keep_pass = verdict == "PASS"
        site["is_candidate"] = bool(
            site["counts_as_site"]
            and not site["land_only"]
            and site["in_area"]
            and (land_fit or keep_pass)
            and not eliminated
        )
        site["is_held_fit"] = bool(
            site["counts_as_site"]
            and not site["land_only"]
            and site.get("expansion_horizon")
            and (land_fit or keep_pass)
            and not eliminated
        )
        if site["duplicate_of"]:
            site["why_stopped"] = f"Duplicate of {site['duplicate_of']} (same parcel). Counted once."
        elif verdict == "NOT_A_WASH":
            site["why_stopped"] = "Not a wash (" + (plain_note(site["elimination_reason"]) or "reason not categorised") + ")."
        elif site["tenure_fail"]:
            site["why_stopped"] = "The county verdict fails this site on tenure. Tenure is otherwise only a flag."
        elif verdict == "FAIL":
            site["why_stopped"] = site.get("evidence") or "County verdict is FAIL."
        elif site["is_held_fit"]:
            site["why_stopped"] = "Outside the operative service area. Held for network expansion."
        elif site["origin"] == "universe" and not site["in_area"]:
            site["why_stopped"] = "Outside the operative service area."
        sanitize_site_notes(site)
        display, alternates = display_name_parts(site.get("name") or "")
        if display:
            site["name"] = display
        site["also_known_as"] = "; ".join(alternates)
        site["summary_why"] = summary_why(site)

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
        "workbook_as_of": workbook_as_of(),
        "stages": [
            {
                "id": "census",
                "name": "Census rows",
                "unit": "rows",
                "total": census["total"],
                "by_city": census["by_city"],
                "note": "Workbook Universe tab. A census union, not a count of operating businesses. The Universe step keeps the rows marked counted, one site each.",
            },
            {
                "id": "unique",
                "name": "Unique sites",
                "unit": "sites",
                "total": len(countable),
                "by_city": by_city(countable),
                "by_class": class_breakdown(countable),
                "note": (
                    f"Counted rows on the Universe tab: {len(countable)}. "
                    f"The tab has {census['total']} rows in all. "
                    f"Census file records not on a counted row are left out"
                    + (
                        f" ({len(live_universe['dropped_existing'])})."
                        if live_universe.get("dropped_existing")
                        else "."
                    )
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
                "note": "Service area comes from the Universe tab. In is inside the current area. Out and unknown stay outside. Las Vegas rings 200 and 300 stay on the expansion horizon.",
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
                "name": "Deals contacted",
                "unit": "deals",
                "total": 0,
                "by_city": {"LAS": 0, "PHX": 0, "MIA": 0},
                "note": CONTACTED_DEAL_NOTE,
            },
        ],
        "candidates": {
            "definition": "In-area L10 and L4 sites that are not eliminated as not-a-wash and are not a tenure FAIL. Held L10 and L4 sites are a separate group.",
            "ids": [site["site_id"] for site in candidates],
            "held_ids": [site["site_id"] for site in held_fits],
        },
    }

    warnings = site_id_warnings(pipeline_rows, land_rows)
    if census["total"] != 1701:
        warnings.append(f"Census row count is {census['total']}, workbook expectation was 1,701.")
    if len(countable) != 1658 or by_city(countable) != {"LAS": 417, "PHX": 555, "MIA": 686}:
        warnings.append(f"Unique sites are {len(countable)} {by_city(countable)}, workbook counted rows are 1,658 (LAS 417 / PHX 555 / MIA 686).")
    if by_city(in_area) != {"LAS": 179, "PHX": 254, "MIA": 610}:
        warnings.append(f"In-area city split is {by_city(in_area)}, workbook service area is LV 179 / PHX 254 / MIA 610.")
    workbook_county = live_universe.get("county_verdicts") or {}
    if workbook_county != {"PASS": 14, "MAYBE": 30, "FAIL": 47, "NOT_A_WASH": 15, "UNRESOLVED": 4}:
        warnings.append(f"Workbook county verdicts before the two Maybe holds are {workbook_county}.")
    map_verdicts = {key: verdict_groups[key]["total"] for key in ("PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED")}
    if map_verdicts != {"PASS": 12, "MAYBE": 32, "FAIL": 47, "NOT_A_WASH": 15, "UNRESOLVED": 4}:
        warnings.append(f"Map verdicts are {map_verdicts}, expected Pass 12, Maybe 32, Fail 47, Not a car wash 15, Unresolved 4 after the two holds.")
    if len(cleared) != 10:
        warnings.append(f"Cleared on the map is {len(cleared)} ({[site['site_id'] for site in cleared]}). The two holds should leave 10.")
    if live_universe.get("missing_point"):
        warnings.append("Counted sites with no pin: " + ", ".join(live_universe["missing_point"][:12]))
    if screening["conflicts"]:
        warnings.append(f"Screening rows with more than one aerial verdict for the same parcel: {len(screening['conflicts'])}.")
    if len(contacted_any) and not any(site.get("contacted") for site in sites):
        warnings.append("Broker contact flags did not land on any site.")
    if len(pipeline_rows) != 79:
        warnings.append(
            f"Pipeline tab has {len(pipeline_rows)} rows (stages {dict(Counter(str(r.get('Stage')) for r in pipeline_rows))}). The older note of 79 is not in this export."
        )
    if muse_file and len(muse_override) == 0:
        warnings.append("The review file was set but no site rows were read.")
    for sid in ("PHX-U644", "PHX-U646"):
        site = by_id.get(sid)
        if site and site.get("counts_as_site"):
            warnings.append(f"{sid} in_area={site['in_area']} (screening-tab boundary note in the plan).")

    areas_fc = {"type": "FeatureCollection", "features": areas}
    depots = build_depots()
    deals_fc, deal_report = build_deal_layer(
        pipeline_rows,
        land_rows,
        sites,
        depots["features"],
        reg,
        broker_outreach(workbook),
        load_site_photos(workbook),
    )
    apply_contacted_deal_stage(funnel, deals_fc["features"])
    listed_drift = listed_flag_drift(sites)
    parcels, parcel_meta = ([], {"counts": {}, "note": "Parcel fetch skipped."})
    public_records = {"note": "Public-record fields are added when the build writes files."}
    if write:
        parcels, parcel_meta = build_parcels(sites, refresh_parcels, deals_fc["features"])
        from enrich_public import apply_public_records

        public_records = apply_public_records(sites, norm_apn)
        from enrich_context import apply_context

        public_records["context"] = apply_context(sites)
    public_records["gap_fills"] = apply_gap_fills(sites)

    attach_universe_capacity(sites)
    site_features = []
    for site in sites:
        geom = None
        if site["lat"] is not None and site["lon"] is not None:
            geom = {"type": "Point", "coordinates": [site["lon"], site["lat"]]}
        props = {k: v for k, v in site.items() if k not in {"lat", "lon", "utility_proximity", "serving_utility", "serving_utility_source", "_source_listed"}}
        site_features.append({"type": "Feature", "geometry": geom, "properties": props})
    sites_fc = {"type": "FeatureCollection", "features": site_features}
    parcels_fc = {"type": "FeatureCollection", "features": parcels}

    problems = []
    for blob in (sites_fc, areas_fc, depots, deals_fc, funnel):
        problems.extend(scan_obj(blob))
    if problems:
        raise SystemExit("Banned or forbidden content in generated data:\n" + "\n".join(problems[:30]))

    from scripts.vocabulary import collect_vocabulary

    report = {
        "generated_at": funnel["generated_at"],
        "census_rows": census,
        "live_universe": {
            "counted": live_universe.get("counted"),
            "by_city": live_universe.get("by_city"),
            "in_area_by_city": live_universe.get("in_area_by_city"),
            "matched_existing": live_universe.get("matched_existing"),
            "new_sites": live_universe.get("new_sites"),
            "dropped_existing": len(live_universe.get("dropped_existing") or []),
            "county_verdicts_before_holds": live_universe.get("county_verdicts"),
            "note": "County verdicts are the Universe tab before Charleston Car Wash and the Chandler Quick Quack are held at Maybe. Cleared on the map is the in-area Pass rows after those two holds.",
        },
        "unique_site_records": len([s for s in sites if s["origin"] == "universe"]),
        "unique_sites_counted": len(countable),
        "same_parcel_collapsed": duplicate_of,
        "in_area": {"total": len(in_area), "by_city": by_city(in_area), "by_class": class_breakdown(in_area)},
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
        "deals": deal_report,
        "off_market": {
            "matched": len(off_market_matched),
            "unmatched": len(off_market_unmatched),
            "matched_by_city": dict(Counter(item["city"] for item in off_market_matched)),
            "unmatched_by_city": dict(Counter(item["city"] for item in off_market_unmatched)),
            "unmatched_rows": off_market_unmatched,
            "note": (
                "Matched off-market rows add research to the census site and do not add a second pin. "
                "Unmatched rows are drawn in universe mode and filtered by business type. "
                "They are not part of the car-wash census counts."
            ),
        },
        "sites_without_coordinates": [
            site["site_id"] for site in sites if site["coord_status"] != "known" and site["counts_as_site"]
        ],
        "disagreements": [site["site_id"] for site in sites if site["verdict_disagreement"]],
        "acreage_notes": [site["site_id"] for site in sites if site["acreage_note"]],
        "scale_notes": [site["site_id"] for site in sites if site["scale_note"]],
        "parcels": parcel_meta,
        "public_records": public_records,
        "review_source": muse_file or "second review column",
        "vocabulary": collect_vocabulary(universe_rows, pipeline_rows, land_rows),
        "warnings": warnings,
        "skipped": [
            "Aerial-screen stages (the old 92 / 92 / 78 counts) are not funnel steps.",
            "Nightly workbook sync is not wired; drop a new export in data/source and rerun this script.",
            "Parcel outlines cover in-area universe sites and geocoded deals in Maricopa, Clark, Miami-Dade, and Broward. Match method is parcel number, then the pin.",
            "Same-owner adjoining outlines are requested where the site record has adjoining spare land.",
            "The 75–250 m review band was not recomputed. The one same-parcel pair found by APN is flagged.",
            "Edge-band distance to the polygon was not recomputed.",
            "Outreach drafts are not loaded.",
            "Place records with a phone and website were not joined. The census file has no place id, and the public places extract is too large to download here.",
            "Human verdict write-back is a later version and is not in this app.",
        ],
    }

    # Diff against the last committed build, not the working file this run overwrites.
    # A second local build would otherwise compare the new file to itself and report zeros.
    changes = summarize_changes(
        published_features("data/generated/sites.geojson"),
        sites,
        published_features("data/generated/deals.geojson"),
        deals_fc.get("features") or [],
    )
    if write:
        write_workbook_stage_files(listed_drift)
        OUT.mkdir(parents=True, exist_ok=True)
        PARCEL_CACHE.parent.mkdir(parents=True, exist_ok=True)
        (OUT / "sites.geojson").write_text(json.dumps(sites_fc))
        (OUT / "areas.geojson").write_text(json.dumps(areas_fc))
        (OUT / "depots.geojson").write_text(json.dumps(depots))
        (OUT / "deals.geojson").write_text(json.dumps(deals_fc))
        from scripts.comms import write_comms_file
        from scripts.financials import write_financials_file
        from scripts.nda import write_nda_file
        from scripts.open_loops import write_open_loops_file

        write_financials_file(workbook, OUT / "financials.json", reg)
        write_nda_file(workbook, OUT / "nda.json")
        write_comms_file(workbook, OUT / "comms.json")
        write_open_loops_file(workbook, OUT / "open-loops.json")
        (OUT / "parcels.geojson").write_text(json.dumps(parcels_fc))
        for city_code in ("PHX", "LAS", "MIA"):
            city_fc = {
                "type": "FeatureCollection",
                "features": [feature for feature in parcels if (feature.get("properties") or {}).get("city") == city_code],
            }
            (OUT / f"parcels-{city_code}.geojson").write_text(json.dumps(city_fc))
        (OUT / "funnel.json").write_text(json.dumps(funnel, indent=2))
        (OUT / "changes.json").write_text(json.dumps(changes, indent=2))
        refresh_queue_feed()
        report["changes"] = changes
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
        report["parcel_bytes"] = {
            name: (OUT / name).stat().st_size
            for name in ("parcels.geojson", "parcels-PHX.geojson", "parcels-LAS.geojson", "parcels-MIA.geojson")
        }
        (OUT / "build_report.json").write_text(json.dumps(report, indent=2))
        if PARCEL_CACHE.exists() or True:
            # cache is updated inside build_parcels via the dict; persist it
            pass
        # persist cache written by build_parcels through the module global updated below
        save_parcel_cache_from_last()
    return report


LAST_CACHE = None


def _record_props(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    props = item.get("properties") if "properties" in item else item
    return props if isinstance(props, dict) else None


def published_features(rel: str) -> list:
    """Features from the last committed build. The working copy is not the baseline."""
    try:
        raw = subprocess.check_output(
            ["git", "show", f"HEAD:{rel}"],
            cwd=ROOT,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        path = ROOT / rel
        if not path.exists():
            return []
        raw = path.read_bytes()
    try:
        return json.loads(raw).get("features") or []
    except json.JSONDecodeError:
        return []


def summarize_changes(old_sites, new_sites, old_deals=None, new_deals=None) -> dict:
    """Count sites and stage moves since the previous published build."""

    def index(rows, key):
        found = {}
        for item in rows or []:
            props = _record_props(item)
            if not props or not props.get(key):
                continue
            found[props[key]] = props
        return found

    old_by = index(old_sites, "site_id")
    new_by = index(new_sites, "site_id")
    added = sorted(set(new_by) - set(old_by))
    removed = sorted(set(old_by) - set(new_by))
    verdict_changes = []
    stage_moves = []
    for sid, site in new_by.items():
        old = old_by.get(sid)
        if not old:
            continue
        if (old.get("verdict") or None) != (site.get("verdict") or None):
            verdict_changes.append({"site_id": sid, "before": old.get("verdict"), "after": site.get("verdict")})
        if (old.get("pipeline_stage") or "") != (site.get("pipeline_stage") or ""):
            stage_moves.append(
                {"site_id": sid, "before": old.get("pipeline_stage") or "", "after": site.get("pipeline_stage") or ""}
            )
    old_deal_by = index(old_deals, "deal_id")
    new_deal_by = index(new_deals, "deal_id")
    for deal_id, deal in new_deal_by.items():
        old = old_deal_by.get(deal_id)
        if not old:
            continue
        if (old.get("stage") or "") != (deal.get("stage") or ""):
            stage_moves.append({"deal_id": deal_id, "before": old.get("stage") or "", "after": deal.get("stage") or ""})
    return {
        "new_sites": len(added),
        "removed_sites": len(removed),
        "verdict_changes": len(verdict_changes),
        "stage_moves": len(stage_moves),
        "sample_new": added[:12],
        "sample_verdicts": verdict_changes[:12],
        "sample_stages": stage_moves[:12],
    }


def save_parcel_cache_from_last():
    if LAST_CACHE is None:
        return
    PARCEL_CACHE.parent.mkdir(parents=True, exist_ok=True)
    PARCEL_CACHE.write_text(json.dumps(LAST_CACHE))


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
        raise SystemExit("Depot output failed the data check:\n" + "\n".join(problems))
    return fc


def sources_present() -> bool:
    return (SRC / "universe_v3.csv").exists() and any(SRC.glob("*.xlsx"))


def display_language_problems(loaded: dict) -> list[str]:
    """Removed proximity fields stay off the shipped files. Prose is not word-checked."""
    problems = []

    def walk(obj, path):
        if isinstance(obj, dict):
            for key, value in obj.items():
                folded = key.lower().replace("-", "_")
                if folded in {"utility_proximity", "serving_utility", "serving_utility_source"}:
                    problems.append(f"removed field still shipped at {path}.{key}")
                walk(value, f"{path}.{key}")
        elif isinstance(obj, list):
            for index, value in enumerate(obj[:8000]):
                walk(value, f"{path}[{index}]")

    for name, blob in loaded.items():
        walk(blob, name)
    return problems


def gap_fill_problems(props: list[dict]) -> list[str]:
    """Suburb, traffic, and contact fills have to survive when this export applied them.

    The overlay files are not in git. This workbook sync recorded gap_fills of zero and
    shipped the county layers without those snapshots, so the old site strings are not
    required unless the committed report says the overlays were applied.
    """
    problems = []
    by_id = {item.get("site_id"): item for item in props}
    fills = {}
    if (OUT / "build_report.json").exists():
        report = json.loads((OUT / "build_report.json").read_text())
        fills = ((report.get("public_records") or {}).get("gap_fills")) or {}
    applied = any(int(fills.get(key) or 0) > 0 for key in ("zoning", "aadt", "phone", "website", "closed"))
    if applied:
        tempe = by_id.get("PHX-U1006") or {}
        if not str(tempe.get("zoning") or "").startswith("GID") or "Tempe zoning" not in (tempe.get("zoning_source") or ""):
            problems.append("PHX-U1006 should show its Tempe zoning and the source")
        chandler = by_id.get("PHX-U513") or {}
        if chandler.get("zoning") != "PAD" or "Code only" not in (chandler.get("zoning_source") or ""):
            problems.append("PHX-U513 should show the Chandler code only")
        terrible = by_id.get("LAS-U100") or {}
        if terrible.get("aadt_count") != "14,300" or "Verified" not in (terrible.get("aadt_source") or ""):
            problems.append("LAS-U100 should show the verified traffic count on its own street")
        nearby = by_id.get("LAS-U1520") or {}
        if nearby.get("aadt_count") != "32,500" or "Nearby road" not in (nearby.get("aadt_source") or ""):
            problems.append("LAS-U1520 should show the nearby-road traffic count")
        kept = by_id.get("LAS-U935") or {}
        if kept.get("aadt_count") != "6,800":
            problems.append("LAS-U935 should keep its earlier traffic count")
        closed = by_id.get("MIA-U1294") or {}
        if closed.get("place_note") != "Listed as permanently closed" or closed.get("phone") or closed.get("website"):
            problems.append("MIA-U1294 is permanently closed and should not show a phone or website")
        approximate = by_id.get("LAS-U1531") or {}
        if "Approximate" not in (approximate.get("phone_source") or ""):
            problems.append("LAS-U1531 should label its phone as approximate")
    for item in props:
        if item.get("place_note") == "Listed as permanently closed" and (item.get("phone") or item.get("website")):
            problems.append(f"{item.get('site_id')} shows a phone or website for a permanently closed place")
            break
    return problems


def validate_committed() -> None:
    """Check the files in git. Used when the raw source folder is not present."""
    problems: list[str] = []
    required = [
        "sites.geojson",
        "areas.geojson",
        "depots.geojson",
        "parcels.geojson",
        "parcels-PHX.geojson",
        "parcels-LAS.geojson",
        "parcels-MIA.geojson",
        "deals.geojson",
        "funnel.json",
        "build_report.json",
        "unscreened.geojson",
        "nda.json",
        "comms.json",
        "open-loops.json",
    ]
    loaded = {}
    for name in required:
        path = OUT / name
        if not path.exists():
            problems.append(f"missing {name}")
            continue
        try:
            loaded[name] = json.loads(path.read_text())
        except json.JSONDecodeError:
            problems.append(f"{name} is not valid JSON")
    for name, blob in loaded.items():
        problems.extend(scan_obj(blob, name))
    problems.extend(display_language_problems(loaded))
    if problems:
        raise SystemExit("Data check failed.\n" + "\n".join(problems[:30]))

    sites = loaded["sites.geojson"]["features"]
    props = [feature.get("properties") or {} for feature in sites]
    ids = [item.get("site_id") for item in props]
    if any(not item for item in ids) or len(ids) != len(set(ids)):
        problems.append("site ids must be present and unique")
    countable = [item for item in props if item.get("counts_as_site") and item.get("origin") == "universe"]
    in_area = [item for item in countable if item.get("in_area")]
    l10 = [item for item in in_area if item.get("land_tier") == "L10"]
    l4 = [item for item in in_area if item.get("land_tier") == "L4"]
    candidates = [item for item in countable if item.get("is_candidate")]
    held = [item for item in countable if item.get("is_held_fit")]
    report = loaded["build_report.json"]
    from scripts.vocabulary import shipped_problems

    problems.extend(
        shipped_problems(loaded.get("deals.geojson", {}).get("features") or [], sites, report)
    )
    funnel = loaded["funnel.json"]
    stages = {stage["id"]: stage for stage in funnel.get("stages", [])}

    def expect(label, got, want):
        if got != want:
            problems.append(f"{label}: file says {want}, sites say {got}")

    expect("in area", len(in_area), report.get("in_area", {}).get("total"))
    expect("L10", len(l10), report.get("land_tiers", {}).get("L10"))
    expect("L4", len(l4), report.get("land_tiers", {}).get("L4"))
    expect("candidates", len(candidates), stages.get("listed", {}).get("of"))
    expect("funnel in area", stages.get("in_area", {}).get("total"), len(in_area))
    expect("funnel L10", (stages.get("land_tier", {}).get("L10") or {}).get("total"), len(l10))
    expect("funnel L4", (stages.get("land_tier", {}).get("L4") or {}).get("total"), len(l4))
    expect("held", len(held), (stages.get("land_tier", {}).get("held_fits") or {}).get("total"))
    leaked = [item.get("site_id") for item in candidates + held if item.get("verdict") in {"FAIL", "NOT_A_WASH"}]
    if leaked:
        problems.append("eliminated sites counted as candidates or held: " + ", ".join(leaked[:20]))
    tiered_fail = [item.get("site_id") for item in props if item.get("verdict") in {"FAIL", "NOT_A_WASH"} and item.get("land_tier") in {"L10", "L4"}]
    if tiered_fail:
        problems.append("eliminated sites still have a land tier: " + ", ".join(tiered_fail[:20]))
    allowed = {"id", "address", "city", "status", "confidence"}
    for feature in loaded["depots.geojson"].get("features", []):
        extra = set(feature.get("properties") or {}) - allowed
        if extra:
            problems.append("depot properties not allowed: " + ", ".join(sorted(extra)))
            break
    if VERDICTS.exists():
        with VERDICTS.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                blob = " ".join(row.get(key) or "" for key in ("notes", "parcel_evidence", "operating_evidence", "reviewer"))
                source = row.get("source_file") or ""
                if _NOTE_INTERNAL.search(blob) or re.search(r"(?i)\b(muse|indie|torque)\b", blob + " " + source):
                    problems.append(f"verdict note {row.get('site_id')}: {(blob + ' ' + source)[:120]!r}")
                    break
                if re.search(r"(?i)\bstalls?\b", blob):
                    problems.append(f"stall wording in verdict {row.get('site_id')}")
                    break
    depot_ids = [
        (feature.get("properties") or {}).get("id")
        for feature in loaded["depots.geojson"].get("features", [])
    ]
    if not depot_ids or any(not item for item in depot_ids) or len(depot_ids) != len(set(depot_ids)):
        problems.append("depot ids must be present and unique")
    deal_features = loaded.get("deals.geojson", {}).get("features", [])
    if sources_present():
        live_rows, _drift = workbook_stage_rows()
        problems.extend(shipped_stage_problems(deal_features, live_rows))
    else:
        problems.extend(shipped_stage_problems(deal_features))
    problems.extend(drift_report_exposure())
    deal_report = report.get("deals") or {}
    if len(deal_features) != deal_report.get("pipeline", 0) + deal_report.get("land", 0):
        problems.append("deal count does not match the build report")
    gap = universe_link_gap(deal_features)
    expect("shipped universe links", gap["linked"], deal_report.get("shipped_linked"))
    expect("located without universe", gap["located_without_universe"], deal_report.get("located_without_universe"))
    expect("unlocated without universe", gap["unlocated_without_universe"], deal_report.get("unlocated_without_universe"))
    if deal_report.get("located_without_universe_ids") != [item["deal_id"] for item in gap["located_missing"]]:
        problems.append("located_without_universe_ids does not match the deals file")
    gap_problems = universe_gap_problems(deal_features)
    if gap_problems:
        problems = gap_problems + problems
    else:
        print("Located LAS, PHX, and MIA deals without a universe row: 0.")
    unscreened = loaded.get("unscreened.geojson") or {}
    listing_ids = []
    for feature in unscreened.get("features") or []:
        listing_id = str((feature.get("properties") or {}).get("listing_id") or "").strip()
        if not re.fullmatch(r"L-\d+", listing_id):
            problems.append(f"unscreened listing id {listing_id!r} is not an L- id")
            continue
        listing_ids.append(listing_id)
    if len(listing_ids) != len(set(listing_ids)):
        problems.append("unscreened listing ids are not unique")
    allowed_deal = set(DEAL_FIELDS)
    for feature in deal_features:
        extra = set((feature.get("properties") or {})) - allowed_deal
        if extra:
            problems.append("deal properties not allowed: " + ", ".join(sorted(extra)))
            break
        props_deal = feature.get("properties") or {}
        problems.extend(deal_text_problems(str(props_deal.get("deal_id") or "?"), props_deal))
        problems.extend(site_note_problems({"site_id": props_deal.get("deal_id"), "evidence": props_deal.get("next_step") or "", "why_stopped": props_deal.get("asking_price_source") or ""}))
    failed = deal_report.get("geocode_failed") or []
    if not isinstance(failed, list):
        problems.append("geocode_failed must be a list")
    for item in props:
        problems.extend(site_note_problems(item))
    problems.extend(funnel_subset_problems(sites, loaded["funnel.json"], loaded.get("deals.geojson", {}).get("features", [])))
    problems.extend(gap_fill_problems(props))
    if problems:
        raise SystemExit("Data check failed.\n" + "\n".join(problems[:30]))


CONTACTED_DEAL_NOTE = (
    "Deals in this city, in the categories you have on, with an outbound email or call to the broker on file. "
    "Dropped deals stay out. Census sites are a separate count."
)


def live_contacted_deal_props(features: list[dict]) -> list[dict]:
    """Active Pipeline and Land deals with broker outreach.

    Dropped deals stay out. A blank market is not LAS, PHX, or MIA, so it stays out of this bar.
    """
    rows = []
    for feature in features:
        props = feature.get("properties") if isinstance(feature, dict) and "properties" in feature else feature
        if not isinstance(props, dict):
            continue
        if props.get("kind") not in {"pipeline", "land"}:
            continue
        if str(props.get("city") or "").strip() not in MAP_MARKETS:
            continue
        if props.get("stage_group") == "dropped":
            continue
        if not props.get("broker_contacted"):
            continue
        rows.append(props)
    return rows


def apply_contacted_deal_stage(funnel: dict, features: list[dict]) -> None:
    """Point the contacted funnel stage at live deal outreach, matching the Universe bar."""
    live = live_contacted_deal_props(features)
    by_city = {city: sum(1 for row in live if row.get("city") == city) for city in ("LAS", "PHX", "MIA")}
    for stage in funnel.get("stages", []):
        if stage.get("id") != "contacted":
            continue
        stage.clear()
        stage.update(
            {
                "id": "contacted",
                "name": "Deals contacted",
                "unit": "deals",
                "total": len(live),
                "by_city": by_city,
                "note": CONTACTED_DEAL_NOTE,
            }
        )
        return
    raise SystemExit("funnel is missing the contacted stage")


def contacted_stage_problems(funnel: dict, deals: list[dict]) -> list[str]:
    stage = next((item for item in funnel.get("stages", []) if item.get("id") == "contacted"), None)
    if not stage:
        return ["funnel is missing deals contacted"]
    live = live_contacted_deal_props(deals)
    by_city = {city: sum(1 for row in live if row.get("city") == city) for city in ("LAS", "PHX", "MIA")}
    problems = []
    if stage.get("unit") != "deals":
        problems.append(f"contacted stage unit is {stage.get('unit')}, expected deals")
    if stage.get("total") != len(live):
        problems.append(f"contacted deals total is {len(live)}, funnel says {stage.get('total')}")
    if stage.get("by_city") != by_city:
        problems.append(f"contacted deals by city are {by_city}, funnel says {stage.get('by_city')}")
    note = stage.get("note") or ""
    if "Dropped" not in note or "deal" not in note.lower():
        problems.append("contacted stage note does not describe live deal outreach")
    if "universe site" in note.lower():
        problems.append("contacted stage note still describes a universe site")
    return problems


def _universe_stage(site: dict, stage: str) -> bool:
    """Mirror lib/filter.ts inStage. Each step is a subset of the previous one."""
    props = site.get("properties") or {}
    if props.get("land_only") or props.get("origin") != "universe":
        return False
    unique = bool(props.get("counts_as_site")) and not props.get("duplicate_of")
    in_area = unique and bool(props.get("in_area"))
    land = in_area and props.get("land_tier") in {"L10", "L4"} and (props.get("verdict") or "") not in {"FAIL", "NOT_A_WASH"} and not props.get("tenure_fail")
    county = land and props.get("verification") == "county-checked"
    cleared = county and props.get("verdict") == "PASS" and props.get("network_status") == "cleared"
    listed = cleared and bool(props.get("listed"))
    contacted = listed and bool(props.get("contacted"))
    return {
        "universe": unique,
        "unique": unique,
        "in_area": in_area,
        "land": land,
        "county": county,
        "cleared": cleared,
        "listed": listed,
        "contacted": contacted,
    }[stage]


def funnel_subset_problems(features: list[dict], funnel: dict, deals: list[dict] | None = None) -> list[str]:
    """Universe through Cleared: each step is a subset of the previous one and matches its pins.

    Universe is the unique-site count. The census row count stays in the hover note.
    Listed is a sub-count on each step, and each listed sub-count matches its pins.
    The contacted stage counts live Pipeline and Land deals, not census sites.
    """
    order = ["universe", "in_area", "land", "county", "cleared"]
    problems = []
    stages = {stage["id"]: stage for stage in funnel.get("stages", [])}
    census = stages.get("census") or {}
    census_by_city = census.get("by_city") or {}
    if not isinstance(census_by_city, dict) or census.get("total") != sum(census_by_city.values()):
        problems.append(f"universe census count is {census.get('total')} {census_by_city}, which does not add up")
    if set(census_by_city) - {"LAS", "PHX", "MIA", "SNA"}:
        problems.append(f"universe census has an unexpected market: {census_by_city}")
    unique_rows = [feature for feature in features if _universe_stage(feature, "universe")]
    leaked = [
        (feature.get("properties") or {}).get("site_id")
        for feature in features
        if (feature.get("properties") or {}).get("origin") == "off-market" and _universe_stage(feature, "universe")
    ]
    if leaked:
        problems.append("off-market sites counted in the universe funnel: " + ", ".join(leaked[:8]))
    unique_stage = stages.get("unique") or {}
    if len(unique_rows) != unique_stage.get("total"):
        problems.append("universe pin count does not match the unique site total")
    unique_by_city = dict(Counter((feature.get("properties") or {}).get("city") for feature in unique_rows))
    if unique_by_city != unique_stage.get("by_city"):
        problems.append(f"universe pins by city are {unique_by_city}, expected {unique_stage.get('by_city')}")
    groups = {"all": features}
    for city in ("PHX", "LAS", "MIA"):
        groups[city] = [feature for feature in features if (feature.get("properties") or {}).get("city") == city]
    for label, rows in groups.items():
        previous = None
        for stage in order:
            chosen = [feature for feature in rows if _universe_stage(feature, stage)]
            pins = [feature for feature in chosen if (feature.get("geometry") or {}).get("type") == "Point"]
            if len(chosen) != len(pins):
                problems.append(f"{label} {stage}: count {len(chosen)} but only {len(pins)} pins")
            listed = [feature for feature in chosen if (feature.get("properties") or {}).get("listed")]
            listed_pins = [feature for feature in listed if (feature.get("geometry") or {}).get("type") == "Point"]
            if len(listed) != len(listed_pins):
                problems.append(f"{label} {stage}: listed {len(listed)} but only {len(listed_pins)} listed pins")
            contacted = [feature for feature in chosen if (feature.get("properties") or {}).get("contacted")]
            contacted_pins = [feature for feature in contacted if (feature.get("geometry") or {}).get("type") == "Point"]
            if len(contacted) != len(contacted_pins):
                problems.append(f"{label} {stage}: contacted {len(contacted)} but only {len(contacted_pins)} contacted pins")
            ids = {((feature.get("properties") or {}).get("site_id")) for feature in chosen}
            if previous is not None and not ids <= previous:
                extra = sorted(item for item in ids - previous if item)[:8]
                problems.append(f"{label} {stage} is not a subset of the previous step: {', '.join(extra)}")
            previous = ids
        held = [
            feature
            for feature in rows
            if not (feature.get("properties") or {}).get("land_only")
            and (feature.get("properties") or {}).get("origin") == "universe"
            and (feature.get("properties") or {}).get("is_held_fit")
            and (feature.get("properties") or {}).get("in_area")
        ]
        if held:
            problems.append(f"{label} held sites are inside the service area")
    by_id = {(feature.get("properties") or {}).get("site_id"): feature.get("properties") or {} for feature in features}
    for sid in ("LAS-U1516", "PHX-U519"):
        props = by_id.get(sid) or {}
        if props.get("verdict") != "MAYBE" or props.get("network_status") == "cleared":
            problems.append(f"{sid} must stay Maybe until reviewed")
    terrible = by_id.get("LAS-U100") or {}
    if terrible.get("verdict") != "PASS" or terrible.get("network_status") != "cleared":
        problems.append("LAS-U100 Terrible's #153 must stay cleared")
    in_area_rows = [feature for feature in features if _universe_stage(feature, "in_area")]
    in_area_by_city = dict(Counter((feature.get("properties") or {}).get("city") for feature in in_area_rows))
    in_area_stage = stages.get("in_area") or {}
    if len(in_area_rows) != in_area_stage.get("total") or in_area_by_city != (in_area_stage.get("by_city") or {}):
        problems.append(
            f"in service area is {len(in_area_rows)} {in_area_by_city}, funnel says {in_area_stage.get('total')} {in_area_stage.get('by_city')}"
        )
    known_verdicts = {"PASS", "MAYBE", "FAIL", "NOT_A_WASH", "UNRESOLVED"}
    for feature in unique_rows:
        verdict = (feature.get("properties") or {}).get("verdict")
        if verdict and verdict not in known_verdicts:
            problems.append(f"counted site verdict {verdict!r} is not a known verdict")
            break
    for feature in unique_rows:
        props = feature.get("properties") or {}
        if props.get("verdict") == "PASS" and props.get("network_status") == "held" and props.get("in_area"):
            problems.append(f"{props.get('site_id')} is Pass and held but still inside the service area")
    problems.extend(pipeline_pin_problems(deals or [], features))
    if deals is not None:
        problems.extend(contacted_stage_problems(funnel, deals))
    return problems


def pipeline_pin_problems(deals: list[dict], sites: list[dict]) -> list[str]:
    """Each pipeline step's count is the squares that step can draw."""
    by_id = {(feature.get("properties") or {}).get("site_id"): feature for feature in sites}
    problems = []
    groups: dict[tuple[str, str], list[dict]] = {}
    for feature in deals:
        props = feature.get("properties") or {}
        if props.get("kind") != "pipeline":
            continue
        if props.get("source_kind") == "off-market" or re.search(r"(?i)off-market", props.get("stage") or ""):
            problems.append(f"{props.get('deal_id')} is off-market and still in the pipeline")
        groups.setdefault((props.get("city") or "?", props.get("stage_group") or ""), []).append(feature)
    for (city, stage), rows in sorted(groups.items()):
        drawable = 0
        for feature in rows:
            props = feature.get("properties") or {}
            own = (feature.get("geometry") or {}).get("type") == "Point"
            site = by_id.get(props.get("universe_id") or "")
            site_point = bool(site and (site.get("geometry") or {}).get("type") == "Point")
            if own or site_point:
                drawable += 1
        ids = [(feature.get("properties") or {}).get("deal_id") for feature in rows]
        if len(ids) != len(set(ids)):
            problems.append(f"{city} {stage}: duplicate deal ids")
        squares = sum(1 for feature in rows if (feature.get("geometry") or {}).get("type") == "Point" or _matched_site_point(feature, by_id))
        if squares != drawable:
            problems.append(f"{city} {stage}: {drawable} deals to draw but {squares} squares")
    return problems


def _matched_site_point(feature: dict, by_id: dict) -> bool:
    props = feature.get("properties") or {}
    site = by_id.get(props.get("universe_id") or "")
    return bool(site and (site.get("geometry") or {}).get("type") == "Point")


def check_against_report(report: dict) -> None:
    committed = json.loads((OUT / "build_report.json").read_text())
    keys = ("in_area", "land_tiers", "verdicts", "pass_held", "contacted_of_candidates", "census_rows", "deals")
    mismatches = []
    for key in keys:
        if committed.get(key) != report.get(key):
            mismatches.append(key)
    problems = []
    for name in ("sites.geojson", "areas.geojson", "depots.geojson", "parcels.geojson", "deals.geojson", "funnel.json"):
        problems.extend(scan_obj(json.loads((OUT / name).read_text()), name))
    if mismatches or problems:
        raise SystemExit(
            "Data check failed.\n"
            + (f"Re-run scripts/build_data.py; stale sections: {mismatches}\n" if mismatches else "")
            + "\n".join(problems[:20])
        )


def refresh_queue_feed() -> None:
    """Compare this build with the previous queue snapshot. A failure here does not fail the data build."""
    try:
        subprocess.run(["npx", "tsx", "scripts/build-queue-feed.ts"], cwd=ROOT, timeout=180, check=False)
    except Exception:
        print("Queue feed was not refreshed.")


def main():
    parser = argparse.ArgumentParser(description="Build map data from data/source")
    parser.add_argument("--check", action="store_true", help="Rebuild in memory and compare to committed data")
    parser.add_argument(
        "--gap-gate",
        action="store_true",
        help="Fail if a located LAS, PHX, or MIA deal has no universe row",
    )
    parser.add_argument("--refresh-parcels", action="store_true")
    parser.add_argument("--muse-verdicts", default=os.environ.get("MUSE_VERDICTS_FILE") or None)
    args = parser.parse_args()
    if args.gap_gate:
        enforce_universe_gap()
        print("Universe gap check passed.")
        if not args.check:
            return
    if args.check:
        if sources_present():
            report = build(write=False, refresh_parcels=False, muse_file=args.muse_verdicts)
            check_against_report(report)
        else:
            print("Source folder is absent. Checking committed generated files only.")
        validate_committed()
        print("Data check passed.")
        return
    report = build(write=True, refresh_parcels=args.refresh_parcels, muse_file=args.muse_verdicts)
    _write_timeline()
    print(json.dumps({k: report[k] for k in ("in_area", "land_tiers", "verdicts_on_land_fits", "listed_of_candidates", "contacted_of_candidates", "deals", "parcels", "warnings")}, indent=2))


def _write_timeline() -> None:
    """Read the activity tab and Drive folders. Never writes the workbook.

    A Drive read failure stops the build. A missing credential skips Drive and still writes the activity rows.
    """
    import build_timeline

    workbook = source_workbook() if sources_present() else None
    summary = build_timeline.write_timeline(workbook)
    if workbook is not None:
        from scripts.financials import refresh_package_links

        refresh_package_links(workbook, OUT / "financials.json")
    if summary.get("drive") == "error":
        raise SystemExit("drive: error")
    report_path = OUT / "build_report.json"
    if report_path.exists():
        report = json.loads(report_path.read_text())
        report["timeline"] = {
            "matched_folders": int(summary.get("matched_folders") or 0),
            "unmatched_folders": int(summary.get("unmatched_folders") or 0),
            "sheet_links": int(summary.get("sheet_links") or 0),
            "warnings": len(summary.get("warnings") or []),
            "drive": summary.get("drive") or "skipped",
        }
        report_path.write_text(json.dumps(report, indent=2))
    print(json.dumps({"timeline": {key: value for key, value in summary.items() if key != "warnings"}}))


if __name__ == "__main__":
    main()
