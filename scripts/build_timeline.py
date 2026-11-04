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
from timeline_drive import GoogleDriveLister, items_from_drive  # noqa: E402
from timeline_gmail import load_gmail_items  # noqa: E402


def _drive_lister(config: dict):
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    root = (config.get("drive") or {}).get("rootFolderId") or ""
    if not raw or not root:
        return None, "skipped"
    try:
        return GoogleDriveLister(raw), "ok"
    except Exception:
        return None, "error"


def write_timeline(workbook: Path | None = None, lister=None, drive_state: str | None = None, destination: Path | None = None) -> dict:
    config = load_config()
    activity = read_activity(workbook, config)
    if lister is None and drive_state is None:
        lister, drive_state = _drive_lister(config)
    documents = []
    if lister is not None:
        try:
            documents = items_from_drive(lister, (config.get("drive") or {}).get("rootFolderId") or "", config)
            drive_state = drive_state or "ok"
        except Exception:
            documents = []
            drive_state = "error"
    gmail = load_gmail_items(config, [])
    items = _dedupe(activity + documents + gmail)
    items.sort(key=lambda item: (item.get("date") or "", item.get("record_id") or ""), reverse=True)
    target = destination or OUT
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "items": items,
    }
    target.write_text(json.dumps(payload, indent=2) + "\n")
    return {
        "activity": len(activity),
        "documents": len(documents),
        "gmail": "not_built",
        "drive": drive_state or "skipped",
        "items": len(items),
    }


def _dedupe(items: list[dict]) -> list[dict]:
    seen = set()
    kept = []
    for item in items:
        key = (item.get("record_id"), item.get("date"), item.get("type"), item.get("link"), item.get("summary"))
        if key in seen:
            continue
        seen.add(key)
        kept.append(item)
    return kept


def main():
    parser = argparse.ArgumentParser(description="Read the activity tab and Drive folders into timeline.json")
    parser.add_argument("--workbook", default="")
    args = parser.parse_args()
    workbook = Path(args.workbook) if args.workbook else None
    print(json.dumps(write_timeline(workbook)))


if __name__ == "__main__":
    main()
