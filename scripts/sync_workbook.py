"""Download the Pipeline workbook. Read-only. Never writes to the Sheet."""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "source"
FILE_ID = "167rIKoApP3sMJ3vrp1lg3MT-h5yQGqmMhY_TbBIqByY"
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CSV_MIME = "text/csv"
FOLDER = "application/vnd.google-apps.folder"
SHEET = "application/vnd.google-apps.spreadsheet"
DOC = "application/vnd.google-apps.document"
NATIVE = "application/vnd.google-apps."
EXPORT_LIMIT = 10 * 1024 * 1024
MISSING_FOLDER = "Set MAP_SYNC_INPUTS_FOLDER_ID to the Map sync inputs folder."
# Allowlisted names only. Anything else in the folder is skipped and never logged.
REQUIRED_SOURCE = (
    "universe_v3.csv",
    "las_ring100_screen.csv",
    "listings_match_v3.csv",
    "depots.csv",
    "reconciliation_final.xlsx",
)
_REQUIRED = set(REQUIRED_SOURCE)
_STEM = {name.rsplit(".", 1)[0]: name for name in REQUIRED_SOURCE if name.endswith((".csv", ".xlsx"))}


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def inputs_folder_id() -> str:
    folder_id = (os.environ.get("MAP_SYNC_INPUTS_FOLDER_ID") or "").strip()
    if not folder_id:
        raise SystemExit(MISSING_FOLDER)
    return folder_id


def _token(info: dict) -> str:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = int(time.time())
    header = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claim = _b64(
        json.dumps(
            {
                "iss": info["client_email"],
                "scope": SCOPE,
                "aud": "https://oauth2.googleapis.com/token",
                "iat": now,
                "exp": now + 3600,
            }
        ).encode()
    )
    signing = f"{header}.{claim}".encode()
    key = serialization.load_pem_private_key(info["private_key"].encode(), password=None)
    signature = key.sign(signing, padding.PKCS1v15(), hashes.SHA256())
    assertion = f"{header}.{claim}.{_b64(signature)}"
    body = urllib.parse.urlencode(
        {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}
    ).encode()
    request = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode())
    token = payload.get("access_token")
    if not token:
        raise SystemExit("Google did not return an access token")
    return token


def _get(url: str, token: str) -> bytes:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def _download(url: str, token: str, target: str) -> bytes:
    try:
        blob = _get(url, token)
    except urllib.error.HTTPError as error:
        detail = error.read()
        if error.code == 403 and b"exportSizeLimitExceeded" in detail:
            raise SystemExit(f"Upload {target} as a real file.") from None
        raise
    if len(blob) > EXPORT_LIMIT:
        raise SystemExit(f"Upload {target} as a real file.")
    return blob


def _list_children(token: str, folder_id: str) -> list[dict]:
    found = []
    page = ""
    while True:
        query = urllib.parse.quote(f"'{folder_id}' in parents and trashed=false")
        url = (
            "https://www.googleapis.com/drive/v3/files"
            f"?q={query}&fields=nextPageToken,files(id,name,mimeType)&pageSize=200"
        )
        if page:
            url += "&pageToken=" + urllib.parse.quote(page)
        payload = json.loads(_get(url, token).decode())
        found.extend(payload.get("files") or [])
        page = payload.get("nextPageToken") or ""
        if not page:
            return found


def _target_for(name: str, mime: str) -> str | None:
    """Return the local file name this Drive item may fill, or None to skip it."""
    if mime == FOLDER or mime == DOC or (mime.startswith(NATIVE) and mime != SHEET):
        return None
    if mime == SHEET:
        return _STEM.get(name)
    if name in _REQUIRED or name.lower().endswith(".kmz"):
        return name
    return None


def _csv_sheet_is_one_tab(token: str, file_id: str, target: str) -> None:
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{file_id}?fields=sheets.properties.title"
    payload = json.loads(_get(url, token).decode())
    sheets = payload.get("sheets") or []
    if len(sheets) != 1:
        raise SystemExit(f"{target} has more than one tab. Upload {target} as a real file.")


def fetch_source_folder(token: str, source_dir: Path | None = None) -> None:
    """Copy the allowlisted inputs from the top level of the Map sync inputs folder."""
    folder_id = inputs_folder_id()
    src = source_dir or SRC
    chosen: dict[str, dict] = {}
    skipped = 0
    for item in _list_children(token, folder_id):
        name = str(item.get("name") or "")
        mime = str(item.get("mimeType") or "")
        target = _target_for(name, mime) if name and not name.startswith(".") else None
        if not target:
            skipped += 1
            continue
        if target in chosen:
            raise SystemExit(f"{target} duplicate in Map sync inputs")
        chosen[target] = item
    missing = [name for name in REQUIRED_SOURCE if name not in chosen]
    if not any(name.lower().endswith(".kmz") for name in chosen):
        missing.append("kmz/*.kmz")
    if missing:
        raise SystemExit(
            "The Map sync inputs folder is missing: "
            + ", ".join(missing)
            + ". Put them in the Map sync inputs folder."
        )
    src.mkdir(parents=True, exist_ok=True)
    for target, item in chosen.items():
        file_id = item["id"]
        mime = str(item.get("mimeType") or "")
        if mime == SHEET and target.endswith(".xlsx"):
            url = f"https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType={urllib.parse.quote(XLSX)}"
            blob = _download(url, token, target)
        elif mime == SHEET and target.endswith(".csv"):
            _csv_sheet_is_one_tab(token, file_id, target)
            url = f"https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType={urllib.parse.quote(CSV_MIME)}"
            blob = _download(url, token, target)
        else:
            blob = _download(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media", token, target)
        path = src / "kmz" / target if target.lower().endswith(".kmz") else src / target
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
        print(f"Fetched {target}")
    print(f"Skipped {skipped} other files")


def export_workbook() -> None:
    inputs_folder_id()
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON") or ""
    if not raw.strip():
        raise SystemExit("GOOGLE_SERVICE_ACCOUNT_JSON is not set")
    info = json.loads(raw)
    token = _token(info)
    fetch_source_folder(token)
    meta = json.loads(
        _get(f"https://www.googleapis.com/drive/v3/files/{FILE_ID}?fields=modifiedTime,name", token).decode()
    )
    modified = str(meta.get("modifiedTime") or "")[:10]
    blob = _download(
        f"https://www.googleapis.com/drive/v3/files/{FILE_ID}/export?mimeType={urllib.parse.quote(XLSX)}",
        token,
        "pipeline_sync.xlsx",
    )
    SRC.mkdir(parents=True, exist_ok=True)
    for path in SRC.glob("*.xlsx"):
        if path.name.lower().startswith("reconciliation"):
            continue
        path.unlink()
    (SRC / "pipeline_sync.xlsx").write_bytes(blob)
    if modified:
        (SRC / "workbook_as_of.txt").write_text(modified + "\n")
    print(f"Exported workbook read-only. Modified {modified or 'unknown'}.")
    # `python scripts/sync_workbook.py` puts scripts/ on sys.path, not the repo root.
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from scripts.site_photos import cache_map_images

    cache_map_images(token, SRC / "pipeline_sync.xlsx")


def timeline_comment_lines(folder_urls: int, materials: int, rows: int, timeline: dict | None) -> list[str]:
    """Matched folders counts the Drive listing. Sheet links are a separate line.

    A Folder URL copied from the workbook is not a Drive match. Counting those
    as matches would hide a service account that cannot see 2 Sites.
    """
    matched = folder_urls
    sheet_links = None
    warnings = 0
    if isinstance(timeline, dict) and timeline.get("matched_folders") is not None:
        matched = int(timeline["matched_folders"])
        if timeline.get("sheet_links") is not None:
            sheet_links = int(timeline["sheet_links"])
    if isinstance(timeline, dict) and timeline.get("warnings") is not None:
        warnings = int(timeline["warnings"])
    lines = [f"Matched folders: {matched}."]
    if sheet_links is not None:
        lines.append(f"Sheet folder links: {sheet_links}.")
    lines.extend(
        [
            f"Records with materials: {materials}.",
            f"Activity rows: {rows}.",
            f"Timeline warnings: {warnings}.",
        ]
    )
    return lines


def _timeline_lines() -> list[str]:
    materials = rows = folder_urls = 0
    timeline_path = ROOT / "data" / "generated" / "timeline.json"
    if timeline_path.exists():
        payload = json.loads(timeline_path.read_text())
        records = payload.get("records") or {}
        if isinstance(records, dict):
            for record in records.values():
                if not isinstance(record, dict):
                    continue
                if record.get("folder_url"):
                    folder_urls += 1
                if record.get("materials"):
                    materials += 1
        items = payload.get("items") or []
        if isinstance(items, list):
            rows = len(items)
    report_timeline = None
    report_path = ROOT / "data" / "generated" / "build_report.json"
    if report_path.exists():
        report_timeline = (json.loads(report_path.read_text()).get("timeline") or {})
    return timeline_comment_lines(folder_urls, materials, rows, report_timeline)


def _gap_lines() -> list[str]:
    script_dir = str(ROOT / "scripts")
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    import build_data

    return build_data.universe_gap_lines()


def sync_pr_body() -> str:
    """Pull request text. Lists every located deal that still has no Universe row."""
    return "\n".join(
        [
            "Automatic read-only export of the Pipeline workbook. Not merged.",
            "",
            "Nothing was written back to the Sheet. The map does not invent a Universe row, a coordinate, or a parcel number.",
            "",
            *_gap_lines(),
            "",
            "The comment has the knock-out drift report.",
            "",
        ]
    )


def service_area_comment_lines(report: dict | None) -> list[str]:
    """Flag workbook class values the sync did not recognize. A clean run says zero."""
    items = []
    if isinstance(report, dict):
        found = report.get("service_area_unrecognized") or []
        if isinstance(found, list):
            items = [str(item) for item in found if str(item).strip()]
    lines = [f"Unrecognized service-area classes: {len(items)}."]
    lines.extend(f"- {item}" for item in items[:30])
    return lines


def write_sync_comment(path: Path) -> None:
    report = json.loads((ROOT / "data" / "generated" / "build_report.json").read_text())
    changes = report.get("changes") or {}
    funnel = json.loads((ROOT / "data" / "generated" / "funnel.json").read_text())
    drift_path = ROOT / "data" / "drift_report.csv"
    drift = drift_path.read_text() if drift_path.exists() else ""
    text = "\n".join(
        [
            *_gap_lines(),
            "",
            f"Data as of {funnel.get('workbook_as_of') or ''}.",
            f"New sites: {changes.get('new_sites', 0)}.",
            f"Verdict changes: {changes.get('verdict_changes', 0)}.",
            f"Stage moves: {changes.get('stage_moves', 0)}.",
            *_timeline_lines(),
            *service_area_comment_lines(report),
            "",
            "Drift report (not served to the app):",
            "```",
            drift.strip() or "No drift rows.",
            "```",
        ]
    )
    path.write_text(text)


if __name__ == "__main__":
    if "--comment" in sys.argv:
        write_sync_comment(Path("/tmp/drift-comment.md"))
    elif "--pr-body" in sys.argv:
        index = sys.argv.index("--pr-body")
        target = Path(sys.argv[index + 1]) if len(sys.argv) > index + 1 else Path("/tmp/sync-pr-body.md")
        target.write_text(sync_pr_body())
    else:
        export_workbook()
