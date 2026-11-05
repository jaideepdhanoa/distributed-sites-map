"""Build data/generated/timeline.json from the activity tab and Drive folders.

The workbook and Drive are read only. Run this after a workbook sync:

    python3 scripts/build_timeline.py --workbook path/to/export.xlsx
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "generated" / "timeline.json"
sys.path.insert(0, str(ROOT / "scripts"))

from timeline_activity import read_activity  # noqa: E402
from timeline_config import load_config  # noqa: E402
from timeline_drive import GoogleDriveLister, match_materials, read_workbook_records  # noqa: E402
from timeline_gmail import load_gmail_items  # noqa: E402


def _drive_lister(config: dict):
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    root = (config.get("drive") or {}).get("rootFolderId") or ""
    if not raw or not root:
        return None, "skipped", ""
    try:
        return GoogleDriveLister(raw), "ok", ""
    except Exception as exc:
        return None, "error", str(exc)


def _last_touched(materials: list[dict], items: list[dict]) -> str:
    days = [str(item.get("latest") or "") for item in materials]
    days.extend(str(item.get("date") or "") for item in items)
    days = [day for day in days if day]
    return max(days) if days else ""


def write_timeline(workbook: Path | None = None, lister=None, drive_state: str | None = None, destination: Path | None = None, records: list[dict] | None = None) -> dict:
    config = load_config()
    if records is None:
        records = read_workbook_records(workbook)
    known = {row["site_id"] for row in records if row.get("site_id")}
    activity, activity_warnings = read_activity(workbook, config, known if workbook else None)
    drive_error = ""
    if lister is None and drive_state is None:
        lister, drive_state, drive_error = _drive_lister(config)
    materials: dict = {}
    drive_warnings: list[str] = []
    log = {"matched": 0, "unmatched": 0}
    if drive_state == "error":
        raise SystemExit(f"drive: error: {drive_error or 'the Drive client could not be created'}")
    try:
        # A missing Drive client still keeps Folder-column links. Counts need the listing.
        materials, drive_warnings, log = match_materials(lister, (config.get("drive") or {}).get("rootFolderId") or "", records)
        if lister is not None:
            drive_state = drive_state or "ok"
    except Exception as exc:
        raise SystemExit(f"drive: error: {exc}") from exc
    load_gmail_items(config, [])
    by_record: dict[str, list[dict]] = {}
    for item in activity:
        by_record.setdefault(item["record_id"], []).append(item)
    record_ids = set(materials) | set(by_record)
    payload_records = {}
    for site_id in sorted(record_ids):
        folder = materials.get(site_id) or {}
        rows = sorted(by_record.get(site_id) or [], key=lambda item: item.get("date") or "", reverse=True)
        entry = {
            "materials": folder.get("materials") or [],
            "last_touched": _last_touched(folder.get("materials") or [], rows),
        }
        if folder.get("folder_url"):
            entry = {"folder_url": folder["folder_url"], **entry}
        if not entry["materials"] and not rows and not entry.get("folder_url"):
            continue
        payload_records[site_id] = entry
    items = sorted(activity, key=lambda item: (item.get("date") or "", item.get("record_id") or ""), reverse=True)
    for warning in activity_warnings + drive_warnings:
        print(warning, file=sys.stderr)
    print(
        json.dumps({"matched_folders": log["matched"], "unmatched_folders": log["unmatched"], "activity_rows": len(items)}),
        file=sys.stderr,
    )
    target = destination or OUT
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "records": payload_records,
        "items": items,
    }
    target.write_text(json.dumps(payload, indent=2) + "\n")
    return {
        "activity": len(items),
        "matched_folders": log["matched"],
        "unmatched_folders": log["unmatched"],
        "records": len(payload_records),
        "mail": "not_built",
        "drive": drive_state or "skipped",
        "warnings": activity_warnings + drive_warnings,
    }


def main():
    parser = argparse.ArgumentParser(description="Read the activity tab and Drive folders into timeline.json")
    parser.add_argument("--workbook", default="")
    args = parser.parse_args()
    workbook = Path(args.workbook) if args.workbook else None
    print(json.dumps({key: value for key, value in write_timeline(workbook).items() if key != "warnings"}))


if __name__ == "__main__":
    main()
