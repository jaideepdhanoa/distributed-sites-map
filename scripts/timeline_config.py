"""Load timeline naming rules. Environment variables override the file."""

from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_config() -> dict:
    path = Path(os.environ.get("TIMELINE_CONFIG") or (ROOT / "config" / "timeline.json"))
    config = json.loads(path.read_text())
    activity = config.setdefault("activity", {})
    drive = config.setdefault("drive", {})
    gmail = config.setdefault("gmail", {})
    if os.environ.get("ACTIVITY_SHEET"):
        activity["sheet"] = os.environ["ACTIVITY_SHEET"]
    if os.environ.get("ACTIVITY_HEADER_ROW"):
        activity["headerRow"] = int(os.environ["ACTIVITY_HEADER_ROW"])
    if os.environ.get("DRIVE_FOLDER_TEMPLATE"):
        drive["folderTemplate"] = os.environ["DRIVE_FOLDER_TEMPLATE"]
    if os.environ.get("GOOGLE_DRIVE_ROOT_FOLDER_ID"):
        drive["rootFolderId"] = os.environ["GOOGLE_DRIVE_ROOT_FOLDER_ID"]
    if os.environ.get("GMAIL_LABEL_TEMPLATE"):
        gmail["labelTemplate"] = os.environ["GMAIL_LABEL_TEMPLATE"]
    return config
