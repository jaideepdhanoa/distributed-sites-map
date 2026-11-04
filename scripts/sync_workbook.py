"""Download the Pipeline workbook. Read-only. Never writes to the Sheet."""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "source"
FILE_ID = "167rIKoApP3sMJ3vrp1lg3MT-h5yQGqmMhY_TbBIqByY"
SOURCE_FOLDER_ID = "11ONFb99evERFObom8lf_Qq81onW50WBw"
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FOLDER = "application/vnd.google-apps.folder"
# These live in the Drive folder above and are copied to data/source (kmz files into data/source/kmz).
REQUIRED_SOURCE = (
    "universe_v3.csv",
    "las_ring100_screen.csv",
    "listings_match_v3.csv",
    "depots.csv",
    "note_rewrites.json",
    "reconciliation_final.xlsx",
)


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _token(info: dict) -> str:
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


def fetch_source_folder(token: str) -> None:
    """Copy the non-workbook inputs. A base64 gzip of this folder is about 400 KB, over the 48 KB secret limit."""

    def walk(folder_id: str, dest: Path) -> None:
        dest.mkdir(parents=True, exist_ok=True)
        for item in _list_children(token, folder_id):
            name = str(item.get("name") or "")
            if not name or name.startswith("."):
                continue
            if item.get("mimeType") == FOLDER:
                walk(item["id"], dest / name)
                continue
            target = SRC / "kmz" / name if name.lower().endswith(".kmz") and dest == SRC else dest / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(_get(f"https://www.googleapis.com/drive/v3/files/{item['id']}?alt=media", token))
            print(f"Fetched {target.relative_to(ROOT)}")

    walk(SOURCE_FOLDER_ID, SRC)
    missing = [name for name in REQUIRED_SOURCE if not (SRC / name).exists()]
    if not list((SRC / "kmz").glob("*.kmz")):
        missing.append("kmz/*.kmz")
    if missing:
        raise SystemExit(
            "The Drive source folder is missing: "
            + ", ".join(missing)
            + f". Put them in folder {SOURCE_FOLDER_ID}."
        )


def export_workbook() -> None:
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
    blob = _get(f"https://www.googleapis.com/drive/v3/files/{FILE_ID}/export?mimeType={urllib.parse.quote(XLSX)}", token)
    SRC.mkdir(parents=True, exist_ok=True)
    for path in SRC.glob("*.xlsx"):
        if path.name.lower().startswith("reconciliation"):
            continue
        path.unlink()
    (SRC / "pipeline_sync.xlsx").write_bytes(blob)
    if modified:
        (SRC / "workbook_as_of.txt").write_text(modified + "\n")
    print(f"Exported workbook read-only. Modified {modified or 'unknown'}.")


def write_sync_comment(path: Path) -> None:
    report = json.loads((ROOT / "data" / "generated" / "build_report.json").read_text())
    changes = report.get("changes") or {}
    funnel = json.loads((ROOT / "data" / "generated" / "funnel.json").read_text())
    drift_path = ROOT / "data" / "drift_report.csv"
    drift = drift_path.read_text() if drift_path.exists() else ""
    text = "\n".join(
        [
            f"Data as of {funnel.get('workbook_as_of') or ''}.",
            f"New sites: {changes.get('new_sites', 0)}.",
            f"Verdict changes: {changes.get('verdict_changes', 0)}.",
            f"Stage moves: {changes.get('stage_moves', 0)}.",
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
    else:
        export_workbook()
