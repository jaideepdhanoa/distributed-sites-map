"""Site photo rows from the workbook.

Columns are chosen by header name. A missing or empty Site Photos tab yields
no rows. Image bytes stay out of the sheet and out of the map payload.
"""

from __future__ import annotations

import re
from pathlib import Path

from scripts.key_numbers import _fact_date

TAB = "Site Photos"
HEADER_AT = 0
ROLES = (
    "spare_land_annotated",
    "lot_aerial",
    "access_spare",
    "electrical",
    "listing",
    "street_frontage",
)
ROLE_ORDER = {role: index for index, role in enumerate(ROLES)}
SOURCES = {
    "esri_world_imagery",
    "google_street_view",
    "broker_listing",
    "broker_email",
    "site_visit",
    "other",
}
SHEET_FOR_KIND = {"pipeline": "Pipeline", "land": "Land Sites"}
STATUS = {
    "complete": "Complete",
    "partial": "Partial",
    "deferred": "Deferred",
    "pending": "Pending",
}
SUMMARY_KEYS = (
    "photo_status",
    "photo_diligence_count",
    "photo_listing_count",
    "photos_checked",
    "photo_notes",
)
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")
_ID_IN_URL = re.compile(r"(?:[?&]id=|/d/)([A-Za-z0-9_-]{10,})")
_STILL = re.compile(
    r"(?i)(?:streetviewpixels|maps/api/streetview|streetview|ggpht\.com|geo\d\.ggpht)"
)
_PANO_AT = re.compile(r"@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,[^/\s]*3a", re.I)


def _text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_text(value, limit: int = 240) -> str:
    """Drop a caption that the map wording filter would reject."""
    text = _text(value)
    if not text:
        return ""
    from scripts.build_data import _DISPLAY_TERMS, banned_hits

    if banned_hits(text) or _DISPLAY_TERMS.search(text):
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _count(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number < 0 or number != int(number):
            return None
        return int(number)
    if re.fullmatch(r"\s*\d+\s*", str(value)):
        return int(str(value).strip())
    return None


def _host(url: str) -> str:
    match = re.match(r"https://([^/?#]+)", url, flags=re.I)
    if not match:
        return ""
    return match.group(1).lower().removeprefix("www.")


def is_pano_url(url: str) -> bool:
    """Official Maps panorama link. Not a hosted still."""
    text = _text(url)
    if not text.lower().startswith("https://"):
        return False
    host = _host(text)
    if host not in {"google.com", "maps.google.com"}:
        return False
    lowered = text.lower()
    if "map_action=pano" in lowered or "viewpoint=" in lowered:
        return True
    if "layer=c" in lowered and "cbll=" in lowered:
        return True
    return bool(_PANO_AT.search(text))


def is_street_view_still(url: str) -> bool:
    return bool(_STILL.search(_text(url)))


def is_direct_image_url(url: str) -> bool:
    """A URL that can be an img src. Folder pages and panorama links are not."""
    text = _text(url)
    if not text.lower().startswith("https://"):
        return False
    if is_pano_url(text) or is_street_view_still(text):
        return False
    lowered = text.lower()
    if "/drive/folders/" in lowered or "/file/d/" in lowered:
        return False
    if "drive.google.com/uc?" in lowered or "export=download" in lowered or "export=view" in lowered:
        return False
    return True


def file_id_from(row: dict) -> str:
    explicit = _text(row.get("Drive file ID") or row.get("file_id"))
    if _FILE_ID.fullmatch(explicit):
        return explicit
    view = _text(row.get("View URL") or row.get("view_url"))
    found = _ID_IN_URL.search(view)
    return found.group(1) if found else ""


def _view_url(row: dict) -> str:
    text = _text(row.get("View URL") or row.get("view_url"))
    if text.lower().startswith("https://"):
        return text
    for key, target in row.get("_links") or []:
        if key == "View URL" and _text(target).lower().startswith("https://"):
            return _text(target)
    return ""


def photo_summary(row: dict) -> dict:
    """Summary columns on Pipeline and Land Sites. Blank status stays blank."""
    raw = _text(row.get("Photo status"))
    status = STATUS.get(raw.lower(), "")
    notes = _safe_text(row.get("Photo notes"), 400)
    checked = _fact_date(row.get("Photos checked"))
    return {
        "photo_status": status,
        "photo_diligence_count": _count(row.get("Diligence photo count")),
        "photo_listing_count": _count(row.get("Listing photo count")),
        "photos_checked": checked,
        "photo_notes": notes,
    }


def normalize_photo(row: dict, seq: int) -> dict | None:
    """One public photo, or None when the row is not for the map."""
    site_id = _text(row.get("Site ID")).upper()
    role = _text(row.get("Role")).lower()
    if not site_id or role not in ROLE_ORDER:
        return None
    visibility = _text(row.get("Visibility")).lower()
    if visibility != "map":
        return None
    source = _text(row.get("Source")).lower()
    if source and source not in SOURCES:
        source = "other"
    view = _view_url(row)
    file_id = file_id_from(row)
    if role == "street_frontage":
        if not is_pano_url(view):
            return None
        image_url = ""
    else:
        if source == "google_street_view" or is_street_view_still(view):
            return None
        image_url = view if is_direct_image_url(view) else ""
        if not image_url and not file_id:
            return None
    sheet = _text(row.get("Sheet"))
    if sheet and sheet not in {"Pipeline", "Land Sites"}:
        return None
    photo = {
        "site_id": site_id,
        "sheet": sheet,
        "role": role,
        "visibility": "map",
        "seq": seq,
    }
    if source:
        photo["source"] = source
    as_of = _fact_date(row.get("As-of"))
    if as_of:
        photo["as_of"] = as_of
    if file_id and role != "street_frontage":
        photo["file_id"] = file_id
    if role == "street_frontage":
        photo["view_url"] = view
    elif image_url:
        photo["view_url"] = image_url
    caption = _safe_text(row.get("Caption"))
    attribution = _safe_text(row.get("Attribution"))
    if caption:
        photo["caption"] = caption
    if attribution:
        photo["attribution"] = attribution
    return photo


def load_site_photos(path: Path) -> list[dict]:
    """Rows from the Site Photos tab. A missing tab or a blank sheet is empty."""
    import openpyxl

    if not path or not Path(path).exists():
        return []
    wb = openpyxl.load_workbook(path, read_only=False, data_only=True)
    try:
        if TAB not in wb.sheetnames:
            return []
        rows = list(wb[TAB].iter_rows())
    finally:
        wb.close()
    if not rows:
        return []
    header = [str(cell.value).strip() if cell.value is not None else "" for cell in rows[HEADER_AT]]
    if "Site ID" not in header:
        return []
    out = []
    for offset, row in enumerate(rows[HEADER_AT + 1 :], start=HEADER_AT + 2):
        item: dict = {"_excel_row": offset}
        links: list[tuple[str, str]] = []
        for index, cell in enumerate(row):
            key = header[index] if index < len(header) else ""
            if not key:
                continue
            item[key] = cell.value
            target = ""
            if cell.hyperlink is not None and cell.hyperlink.target:
                target = str(cell.hyperlink.target).strip()
            if target:
                links.append((key, target))
        if links:
            item["_links"] = links
        if _text(item.get("Site ID")):
            out.append(item)
    return out


def index_photos(rows: list[dict] | None) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    seen: set[tuple] = set()
    for seq, row in enumerate(rows or []):
        photo = normalize_photo(row, seq)
        if not photo:
            continue
        identity = (photo["site_id"], photo["role"], photo.get("file_id") or photo.get("view_url") or "")
        if identity in seen:
            continue
        seen.add(identity)
        grouped.setdefault(photo["site_id"], []).append(photo)
    for items in grouped.values():
        items.sort(key=lambda item: (ROLE_ORDER[item["role"]], item["seq"]))
    return grouped


def _public_photo(photo: dict) -> dict:
    shipped = {"role": photo["role"], "visibility": "map"}
    for key in ("source", "as_of", "file_id", "view_url", "caption", "attribution"):
        if photo.get(key):
            shipped[key] = photo[key]
    return shipped


def photos_for_deal(grouped: dict[str, list[dict]], deal_id: str, kind: str) -> list[dict]:
    wanted = SHEET_FOR_KIND.get(kind, "")
    out = []
    for photo in grouped.get((deal_id or "").upper(), []):
        sheet = photo.get("sheet") or ""
        if sheet and sheet != wanted:
            continue
        out.append(_public_photo(photo))
    return out


def frontage_url(photos: list[dict]) -> str:
    for photo in photos:
        if photo.get("role") == "street_frontage" and is_pano_url(str(photo.get("view_url") or "")):
            return str(photo["view_url"])
    return ""


def photo_fields(row: dict, kind: str, deal_id: str, grouped: dict[str, list[dict]]) -> dict:
    """Fields merged onto a deal. Spare-area measures are not touched."""
    summary = photo_summary(row)
    deferred = summary.get("photo_status") == "Deferred"
    # Deferred means no usable address or parcel, so the card gets no gallery and no panorama.
    photos = [] if deferred else photos_for_deal(grouped, deal_id, kind)
    fields: dict = {"photos": photos}
    for key in SUMMARY_KEYS:
        value = summary.get(key)
        if value not in (None, ""):
            fields[key] = value
    pano = "" if summary.get("photo_status") == "Deferred" else frontage_url(photos)
    if pano:
        fields["street_view_url"] = pano
    return fields
