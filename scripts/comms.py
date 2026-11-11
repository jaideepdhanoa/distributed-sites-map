"""Read the Comms Log tab. Never writes the workbook.

The app reads data/generated/comms.json. A workbook that does not yet have
the Comms Log tab keeps the committed snapshot, and otherwise copies the
labeled fixture.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "data" / "fixtures" / "comms.json"
SHEET = "Comms Log"
SITE_ID = re.compile(r"^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$")
KNOWN_DIRECTIONS = {"in", "out", "internal"}
SUMMARY_LIMIT = 300

HEADERS = (
    "Comms ID",
    "Site IDs",
    "Thread ID",
    "Link",
    "Date/time",
    "Direction",
    "Counterparty person",
    "Counterparty firm",
    "Channel",
    "Summary",
    "Asks made",
    "Asks answered",
    "Attachments",
    "State changes",
    "Source",
    "Message ID",
    "Subject",
)


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _summary(value) -> str:
    text = " ".join(_text(value).split())
    return text[:SUMMARY_LIMIT]


def _when(value) -> str:
    """Date, or date and minute, as written. Naive clocks stay America/Los_Angeles."""
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        if value.hour or value.minute or value.second:
            return value.strftime("%Y-%m-%d %H:%M")
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool) and 20000 < float(value) < 80000:
        number = float(value)
        whole = int(number)
        frac = number - whole
        day = datetime(1899, 12, 30) + timedelta(days=whole)
        minutes = int(round(frac * 24 * 60))
        if minutes <= 0 or minutes >= 24 * 60:
            return day.date().isoformat()
        hour, minute = divmod(minutes, 60)
        return f"{day.date().isoformat()} {hour:02d}:{minute:02d}"
    text = re.sub(r"\s+PT$", "", _text(value), flags=re.IGNORECASE)
    match = re.match(r"(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?$", text)
    if not match:
        return ""
    if match.group(2):
        return f"{match.group(1)} {match.group(2)}"
    return match.group(1)


def site_tokens(value) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for part in _text(value).split(";"):
        token = part.strip().upper()
        if not SITE_ID.fullmatch(token) or token in seen:
            continue
        seen.add(token)
        found.append(token)
    return found


def normalize_row(row: dict) -> dict | None:
    comms_id = _text(row.get("Comms ID"))
    if not comms_id:
        return None
    return {
        "comms_id": comms_id,
        "site_ids": _text(row.get("Site IDs")),
        "thread_id": _text(row.get("Thread ID")),
        "link": _text(row.get("Link")),
        "at": _when(row.get("Date/time")),
        "direction": _text(row.get("Direction")),
        "person": _text(row.get("Counterparty person")),
        "firm": _text(row.get("Counterparty firm")),
        "channel": _text(row.get("Channel")),
        "summary": _summary(row.get("Summary")),
        "asks_made": _text(row.get("Asks made")),
        "asks_answered": _text(row.get("Asks answered")),
        "attachments": _text(row.get("Attachments")),
        "state_changes": _text(row.get("State changes")),
        "source": " ".join(_text(row.get("Source")).split()),
        "message_id": _text(row.get("Message ID")),
        "subject": _text(row.get("Subject")),
    }


def build_payload(rows: list[dict], *, source: str, label: str, as_of: str) -> dict:
    sites: dict[str, list[str]] = {}
    unexpected: list[str] = []
    seen_unexpected: set[str] = set()
    for row in rows:
        for token in site_tokens(row.get("site_ids")):
            sites.setdefault(token, []).append(row["comms_id"])
        direction = _text(row.get("direction"))
        if direction.casefold() not in KNOWN_DIRECTIONS and direction not in seen_unexpected:
            seen_unexpected.add(direction)
            unexpected.append(direction)
    return {
        "source": source,
        "as_of": as_of,
        "label": label,
        "unexpected_directions": unexpected,
        "rows": rows,
        "sites": sites,
    }


def _header_cells(values) -> list[str]:
    return [_text(cell) for cell in values]


def records_from_table(header: list[str], data_rows: list) -> list[dict]:
    rows: list[dict] = []
    for values in data_rows:
        if values is None:
            continue
        cells = list(values)
        if not any(cell not in (None, "") for cell in cells):
            continue
        row = {}
        for index, key in enumerate(header):
            if key and index < len(cells):
                row[key] = cells[index]
        item = normalize_row(row)
        if item:
            rows.append(item)
    return rows


def workbook_has_comms(workbook) -> bool:
    if SHEET not in workbook.sheetnames:
        return False
    rows = list(workbook[SHEET].iter_rows(min_row=1, max_row=1, values_only=True))
    if not rows:
        return False
    return "Comms ID" in _header_cells(rows[0])


def read_workbook_snapshot(path: Path) -> dict:
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = book[SHEET]
        table = list(sheet.iter_rows(values_only=True))
    finally:
        book.close()
    if not table:
        header: list[str] = []
        data: list = []
    else:
        header = _header_cells(table[0])
        data = table[1:]
    return build_payload(
        records_from_table(header, data),
        source="workbook",
        label="Read-only snapshot of the Comms Log tab.",
        as_of="",
    )


def write_comms_file(workbook: Path, destination: Path) -> dict:
    """Write data/generated/comms.json. Does not save the workbook.

    A workbook without the Comms Log tab leaves the existing snapshot in
    place, and otherwise copies the labeled fixture.
    """
    import openpyxl

    from scripts.build_data import scan_obj

    book = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    try:
        ready = workbook_has_comms(book)
    finally:
        book.close()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not ready:
        if destination.exists():
            return {"kept": True, "source": "existing"}
        destination.write_text(FIXTURE.read_text(encoding="utf-8"))
        return {"kept": False, "source": "fixture"}
    payload = read_workbook_snapshot(workbook)
    problems = scan_obj(payload, "comms")
    if problems:
        raise SystemExit("Comms payload failed the data check:\n" + "\n".join(problems[:20]))
    destination.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {
        "kept": False,
        "source": "workbook",
        "rows": len(payload["rows"]),
        "sites": len(payload["sites"]),
    }
