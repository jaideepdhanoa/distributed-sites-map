"""Match site folders and count materials. File names never leave this module."""

from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

FOLDER = "application/vnd.google-apps.folder"
DOC = "application/vnd.google-apps.document"
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
SITE_ID = re.compile(r"^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$")
FOLDER_URL = re.compile(r"https://drive\.google\.com/drive/folders/([A-Za-z0-9_-]+)")
FILED_DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})\s")

CATEGORIES = (
    ("1 ", "financials", "Financials"),
    ("2 ", "property_legal", "Property and legal"),
    ("3 ", "operations", "Operations"),
)


def record_id_from_folder(name: str) -> str:
    text = (name or "").strip()
    if not text:
        return ""
    token = text.split(None, 1)[0].upper()
    return token if SITE_ID.fullmatch(token) else ""


def folder_label(name: str) -> str:
    parts = (name or "").strip().split(None, 1)
    return parts[1] if len(parts) > 1 else ""


def _norm_label(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def files_list_url(folder_id: str, page: str = "") -> str:
    safe_id = (folder_id or "").replace("'", "")
    query = {
        "q": f"'{safe_id}' in parents and trashed = false",
        "fields": "nextPageToken,files(id,name,mimeType,createdTime,description)",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
        "pageSize": "200",
    }
    if page:
        query["pageToken"] = page
    return "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(query)


def folder_id_from_row(row: dict) -> str:
    for key, target in row.get("_links") or []:
        if str(key).strip().casefold() == "folder":
            match = FOLDER_URL.search(str(target or ""))
            if match:
                return match.group(1)
    match = FOLDER_URL.search(str(row.get("Folder") or ""))
    return match.group(1) if match else ""


def read_workbook_records(path: Path | None) -> list[dict]:
    """Rows with a Site ID or a folder link. Header is Excel row 4 on both tabs."""
    if path is None or not path.exists():
        return []
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=False, data_only=True)
    records = []
    for tab, kind in (("Pipeline", "pipeline"), ("Land Sites", "land")):
        if tab not in wb.sheetnames:
            continue
        ws = wb[tab]
        rows = list(ws.iter_rows())
        if len(rows) < 4:
            continue
        header = [str(cell.value).strip() if cell.value is not None else "" for cell in rows[3]]
        for offset, row in enumerate(rows[4:]):
            if not row or row[0].value in (None, ""):
                continue
            item: dict = {"_excel_row": 5 + offset, "_tab": tab, "_kind": kind}
            for index, cell in enumerate(row):
                key = header[index] if index < len(header) else ""
                if not key:
                    continue
                item[key] = cell.value
                if cell.hyperlink is not None and cell.hyperlink.target:
                    item.setdefault("_links", []).append((key, str(cell.hyperlink.target).strip()))
            site_id = str(item.get("Site ID") or "").strip().upper()
            if site_id and not SITE_ID.fullmatch(site_id):
                site_id = ""
            label = str(item.get("Site") or "").strip()
            folder_id = folder_id_from_row(item)
            if not site_id and not folder_id:
                continue
            records.append({"site_id": site_id, "label": label, "folder_id": folder_id, "tab": tab, "excel_row": item["_excel_row"]})
    wb.close()
    return records


def _created_day(value: str) -> str:
    text = str(value or "")
    return text[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]) else ""


def _skip_file(child: dict) -> bool:
    name = str(child.get("name") or "")
    lowered = name.casefold()
    if "site memo" in lowered:
        return True
    if child.get("mimeType") == DOC and ("email log" in lowered or "transcript" in lowered):
        return True
    return False


# Drive stores description notes as HTML on one line, so a marker can sit
# inside a tag after other text. Break block tags into lines before matching.
_BLOCK_BREAK = re.compile(r"(?is)<\s*br\b[^>]*?/?>|<\s*/?\s*(?:div|p)\b[^>]*>")
_TAG = re.compile(r"(?is)<[^>]+>")
_SKIP_MARKERS = ("duplicate of:", "misfiled:", "supersedes:", "also filed under:")


def description_lines(value: str) -> list[str]:
    text = html.unescape(str(value or ""))
    text = text.replace("\xa0", " ")
    text = _BLOCK_BREAK.sub("\n", text)
    text = _TAG.sub("", text)
    return text.splitlines()


def description_marks_skip(value: str) -> bool:
    for line in description_lines(value):
        lowered = re.sub(r"\s+", " ", line).strip().casefold()
        if lowered.startswith(_SKIP_MARKERS):
            return True
    return False


def _described_out(child: dict) -> bool:
    return description_marks_skip(str(child.get("description") or ""))


def _walk_files(lister, folder_id: str, site_id: str, warnings: list[str]) -> tuple[int, str]:
    count = 0
    latest = ""
    for child in lister.list_children(folder_id):
        if child.get("mimeType") == FOLDER:
            nested_count, nested_latest = _walk_files(lister, str(child.get("id") or ""), site_id, warnings)
            count += nested_count
            if nested_latest > latest:
                latest = nested_latest
            continue
        if _skip_file(child) or _described_out(child):
            continue
        count += 1
        match = FILED_DATE.match(str(child.get("name") or ""))
        if match:
            day = match.group(1)
        else:
            day = _created_day(str(child.get("createdTime") or ""))
            warnings.append(f"{site_id} has a file without a filed date")
        if day > latest:
            latest = day
    return count, latest


def _category_for(name: str) -> tuple[str, str] | None:
    for prefix, category, label in CATEGORIES:
        if name.startswith(prefix):
            return category, label
    return None


def _excluded_category(name: str) -> bool:
    return name.startswith("4 ")


def materials_for_folder(lister, folder_id: str, site_id: str, warnings: list[str]) -> list[dict]:
    children = lister.list_children(folder_id)
    source = next((child for child in children if child.get("mimeType") == FOLDER and str(child.get("name") or "") == "Source files"), None)
    if source is None:
        return []
    loose = 0
    counts: dict[str, dict] = {}
    for child in lister.list_children(str(source.get("id") or "")):
        name = str(child.get("name") or "")
        if child.get("mimeType") == FOLDER:
            if _excluded_category(name):
                continue
            category = _category_for(name)
            if category is None:
                warnings.append(f"{site_id} has an unrecognized materials folder {child.get('id') or ''}".rstrip())
                continue
            key, label = category
            count, latest = _walk_files(lister, str(child.get("id") or ""), site_id, warnings)
            if count:
                counts[key] = {"category": key, "label": label, "count": count, "latest": latest}
            continue
        loose += 1
    if loose:
        warnings.append(f"{site_id} has {loose} loose file{'s' if loose != 1 else ''} in Source files")
    return [counts[key] for _prefix, key, _label in CATEGORIES if key in counts]


def match_materials(lister, root_id: str, records: list[dict]) -> tuple[dict, list[str], dict]:
    """Return record materials, warnings, and log counts. Names are not returned."""
    warnings: list[str] = []
    if not lister or not root_id:
        return {}, warnings, {"matched": 0, "unmatched": 0}
    by_site = {row["site_id"]: row for row in records if row.get("site_id")}
    by_folder = {row["folder_id"]: row for row in records if row.get("folder_id")}
    grouped: dict[str, list[dict]] = {}
    fallback: list[dict] = []
    unmatched = 0
    for folder in lister.list_children(root_id):
        if folder.get("mimeType") != FOLDER:
            continue
        token = record_id_from_folder(str(folder.get("name") or ""))
        if token and token in by_site:
            grouped.setdefault(token, []).append(folder)
            continue
        if str(folder.get("id") or "") in by_folder:
            fallback.append(folder)
            continue
        unmatched += 1
    chosen: dict[str, dict] = {}
    for site_id, folders in grouped.items():
        record = by_site[site_id]
        if len(folders) == 1:
            folder = folders[0]
        else:
            folder = next((item for item in folders if str(item.get("id") or "") == record.get("folder_id")), folders[0])
            warnings.append(f"{site_id} matched {len(folders)} folders; used {folder.get('id')}")
        chosen[site_id] = folder
        if _norm_label(folder_label(str(folder.get("name") or ""))) != _norm_label(record.get("label") or ""):
            warnings.append(f"{site_id} label differs from folder {folder.get('id')}")
    for folder in fallback:
        record = by_folder[str(folder.get("id") or "")]
        site_id = record.get("site_id") or ""
        if not site_id or site_id in chosen:
            continue
        chosen[site_id] = folder
        if _norm_label(str(folder.get("name") or "")) != _norm_label(record.get("label") or ""):
            warnings.append(f"{site_id} label differs from folder {folder.get('id')}")
    records_out: dict[str, dict] = {}
    for site_id, folder in chosen.items():
        folder_id = str(folder.get("id") or "")
        materials = materials_for_folder(lister, folder_id, site_id, warnings)
        records_out[site_id] = {
            "folder_url": f"https://drive.google.com/drive/folders/{folder_id}",
            "materials": materials,
        }
    return records_out, warnings, {"matched": len(chosen), "unmatched": unmatched}


class GoogleDriveLister:
    """Read-only metadata listing. Never downloads file bytes."""

    def __init__(self, raw: str):
        text = raw.strip()
        info = json.loads(text) if text.startswith("{") else json.loads(Path(text).read_text())
        from google.auth.transport.urllib3 import Request
        from google.oauth2 import service_account
        import urllib3

        self._creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
        self._http = urllib3.PoolManager()
        self._request = Request(self._http)

    def list_children(self, folder_id: str) -> list[dict]:
        self._creds.refresh(self._request)
        items: list[dict] = []
        page = ""
        while True:
            url = files_list_url(folder_id, page)
            request = urllib.request.Request(url, headers={"Authorization": f"Bearer {self._creds.token}"})
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode())
            items.extend(payload.get("files") or [])
            page = payload.get("nextPageToken") or ""
            if not page:
                return items
