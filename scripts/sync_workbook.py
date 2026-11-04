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
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


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


def unpack_source_bundle() -> None:
    raw = os.environ.get("DATA_SOURCE_BUNDLE") or ""
    if not raw.strip():
        return
    import io
    import tarfile

    blob = base64.b64decode(raw)
    SRC.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        archive.extractall(SRC, filter="data")
    print("Unpacked the source bundle")


def export_workbook() -> None:
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON") or ""
    if not raw.strip():
        raise SystemExit("GOOGLE_SERVICE_ACCOUNT_JSON is not set")
    info = json.loads(raw)
    token = _token(info)
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
        unpack_source_bundle()
        export_workbook()
