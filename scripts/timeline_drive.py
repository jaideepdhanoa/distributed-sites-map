"""List per-record Drive folders. Tests pass a fake lister; the Google client is optional."""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from timeline_policy import STATUS, clean_link, name_hidden

FOLDER = "application/vnd.google-apps.folder"
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
RECORD_ID = re.compile(r"^(?:PIPE|LAND)-[A-Z]{2,4}-\d{3,}$|^[A-Z]{2,4}-U\d+$", re.I)


def record_id_from_folder(name: str) -> str:
    head = re.split(r"\s+[–—-]\s+|\s+", (name or "").strip(), maxsplit=1)[0]
    if RECORD_ID.fullmatch(head):
        return head.upper()
    return ""


def _file_type(name: str, forced: str, config: dict) -> str:
    if forced in STATUS:
        return forced
    lowered = (name or "").lower()
    for kind, words in ((config.get("drive") or {}).get("types") or {}).items():
        if kind not in STATUS:
            continue
        for word in words:
            token = (word or "").lower()
            if token and re.search(rf"(?<![a-z0-9]){re.escape(token)}(?![a-z0-9])", lowered):
                return kind
    return ""


def _date(value: str) -> str:
    text = str(value or "")
    return text[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]) else ""


def items_from_drive(lister, root_id: str, config: dict) -> list[dict]:
    if not lister or not root_id:
        return []
    drive = config.get("drive") or {}
    items = []
    for folder in _record_folders(lister, root_id, list(drive.get("path") or [])):
        record_id = record_id_from_folder(str(folder.get("name") or ""))
        if not record_id:
            continue
        items.extend(_folder_items(lister, str(folder.get("id") or ""), record_id, config, ""))
    return items


def _record_folders(lister, folder_id: str, segments: list[str]) -> list[dict]:
    children = [item for item in lister.list_children(folder_id) if item.get("mimeType") == FOLDER]
    if not segments:
        return children
    segment = segments[0]
    rest = segments[1:]
    if segment == "{city}":
        found: list[dict] = []
        for child in children:
            found.extend(_record_folders(lister, str(child.get("id") or ""), rest))
        return found
    match = next((item for item in children if str(item.get("name") or "") == segment), None)
    if not match:
        return []
    return _record_folders(lister, str(match.get("id") or ""), rest)


def _folder_items(lister, folder_id: str, record_id: str, config: dict, forced: str) -> list[dict]:
    items = []
    subfolders = (config.get("drive") or {}).get("subfolderTypes") or {}
    for child in lister.list_children(folder_id):
        name = str(child.get("name") or "")
        if name_hidden(name, config):
            continue
        if child.get("mimeType") == FOLDER:
            mapped = subfolders.get(name, None)
            if mapped is None:
                continue
            items.extend(_folder_items(lister, str(child.get("id") or ""), record_id, config, str(mapped or "")))
            continue
        kind = _file_type(name, forced, config)
        if kind not in STATUS:
            continue
        link = clean_link(str(child.get("webViewLink") or ""))
        items.append(
            {
                "record_id": record_id,
                "date": _date(str(child.get("modifiedTime") or "")),
                "kind": "document",
                "type": kind,
                "summary": STATUS[kind],
                "link": link,
            }
        )
    return items


class GoogleDriveLister:
    """Read-only Drive listing. Constructed only when credentials and a root folder are set."""

    def __init__(self, raw: str):
        text = raw.strip()
        if text.startswith("{"):
            info = json.loads(text)
        else:
            info = json.loads(Path(text).read_text())
        from google.auth.transport.urllib3 import Request
        from google.oauth2 import service_account
        import urllib3

        self._creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
        self._http = urllib3.PoolManager()
        self._request = Request(self._http)

    def list_children(self, folder_id: str) -> list[dict]:
        self._creds.refresh(self._request)
        safe_id = folder_id.replace("'", "")
        items: list[dict] = []
        page = ""
        while True:
            query = {
                "q": f"'{safe_id}' in parents and trashed = false",
                "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
                "pageSize": "200",
            }
            if page:
                query["pageToken"] = page
            url = "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(query)
            request = urllib.request.Request(url, headers={"Authorization": f"Bearer {self._creds.token}"})
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode())
            items.extend(payload.get("files") or [])
            page = payload.get("nextPageToken") or ""
            if not page:
                return items
