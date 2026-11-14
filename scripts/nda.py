"""Read NDA Register and the Pipeline / Land site mirrors. Never writes the workbook.

The app reads data/generated/nda.json. A workbook that does not yet have the
NDA Register tab and the EY–FF columns keeps the committed fixture snapshot.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "data" / "fixtures" / "nda.json"
NOT_REQUIRED = "Not required"
NO_VALUE = "—"
NOT_GATING = "None — not gating (R-076)"
LOGGER = logging.getLogger("scripts.nda")

# Pipeline and Land Sites, header row 4. A letter is used only when that
# header name is missing entirely. Letters match the sheet after BA/BB
# (Distance to service area, Service area polygon) shifted EW–FD to EY–FF.
NDA_COLUMNS = (
    ("EY", "NDA ID", "nda_id"),
    ("EZ", "NDA status", "nda_status"),
    ("FA", "Stage blocker", "stage_blocker"),
    ("FB", "Stage blocker since", "stage_blocker_since"),
    ("FC", "NDA waiting on", "nda_waiting_on"),
    ("FD", "NDA gates", "nda_gates"),
    ("FE", "NDA days open", "nda_days_open"),
    ("FF", "NDA days in current court", "nda_days_in_court"),
)
REGISTER_HEADERS = (
    "NDA ID",
    "Counterparty firm",
    "Counterparty person",
    "Scope",
    "Site IDs",
    "NDA status",
    "NDA form",
    "NDA waiting on",
    "NDA opened date",
    "NDA sent date",
    "NDA last action date",
    "NDA waiting-on since date",
    "NDA executed date",
    "NDA gates",
    "Days open",
    "Days in current court",
    "Source",
    "Notes",
)
REGISTER_KEYS = (
    "nda_id",
    "counterparty_firm",
    "counterparty_person",
    "scope",
    "site_ids",
    "nda_status",
    "nda_form",
    "nda_waiting_on",
    "nda_opened_date",
    "nda_sent_date",
    "nda_last_action_date",
    "nda_waiting_on_since",
    "nda_executed_date",
    "nda_gates",
    "nda_days_open",
    "nda_days_in_court",
    "source",
    "notes",
)
DATE_KEYS = {
    "nda_opened_date",
    "nda_sent_date",
    "nda_last_action_date",
    "nda_waiting_on_since",
    "nda_executed_date",
}
DAY_KEYS = {"nda_days_open", "nda_days_in_court"}


def column_index(letter: str) -> int:
    index = 0
    for char in letter.strip().upper():
        index = index * 26 + (ord(char) - 64)
    return index - 1


def default_mirror() -> dict:
    return {
        "nda_id": "",
        "nda_status": NOT_REQUIRED,
        "nda_waiting_on": NO_VALUE,
        "nda_gates": NOT_GATING,
        "nda_days_open": None,
        "nda_days_in_court": None,
        "stage_blocker": NO_VALUE,
        "stage_blocker_since": "",
    }


def _clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _date_text(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool) and 20000 < float(value) < 80000:
        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()
    match = re.match(r"(\d{4}-\d{2}-\d{2})", str(value).strip())
    return match.group(1) if match else ""


def _days(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value)))
    match = re.search(r"-?\d+", str(value).replace(",", ""))
    if not match:
        return None
    return int(match.group())


def court_days(value):
    """Days in the current court, as a number.

    A zero stored with a date format comes back as 1899-12-30 or midnight.
    That is 0 days, not a calendar date. Any other date is not a day count.
    """
    from datetime import time as time_cls

    if isinstance(value, time_cls):
        return 0 if value == time_cls(0, 0) else None
    if isinstance(value, datetime):
        return 0 if value.date() == date(1899, 12, 30) else None
    if isinstance(value, date):
        return 0 if value == date(1899, 12, 30) else None
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{2,4}", text):
            return 0 if text in {"12/30/1899", "12/30/99"} else None
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[ T].*)?", text):
            return 0 if text.startswith("1899-12-30") else None
    return _days(value)


def _status(value, linked: bool) -> str:
    text = _clean(value)
    if text.lower() == "not started":
        return NOT_REQUIRED
    if not text:
        return "" if linked else NOT_REQUIRED
    return text


def nda_mirror_fields(row: dict) -> dict:
    """Site-level EY–FF mirror. Missing columns stay at the unlinked default."""
    present = any(name in row for _letter, name, _key in NDA_COLUMNS)
    nda_id = _clean(row.get("NDA ID")) if "NDA ID" in row else ""
    if not present and not nda_id:
        return default_mirror()
    linked = bool(nda_id)
    waiting = _clean(row.get("NDA waiting on")) if "NDA waiting on" in row else ""
    gates = _clean(row.get("NDA gates")) if "NDA gates" in row else ""
    blocker = _clean(row.get("Stage blocker")) if "Stage blocker" in row else ""
    since = _date_text(row.get("Stage blocker since")) if "Stage blocker since" in row else ""
    days_open = _days(row.get("NDA days open")) if "NDA days open" in row else None
    days_court = court_days(row.get("NDA days in current court")) if "NDA days in current court" in row else None
    if not linked:
        return {
            "nda_id": "",
            "nda_status": _status(row.get("NDA status") if "NDA status" in row else "", False),
            "nda_waiting_on": waiting or NO_VALUE,
            "nda_gates": gates or NOT_GATING,
            "nda_days_open": days_open,
            "nda_days_in_court": days_court,
            "stage_blocker": blocker or NO_VALUE,
            "stage_blocker_since": since,
        }
    return {
        "nda_id": nda_id,
        "nda_status": _status(row.get("NDA status") if "NDA status" in row else "", True),
        "nda_waiting_on": waiting,
        "nda_gates": gates,
        "nda_days_open": days_open,
        "nda_days_in_court": days_court,
        "stage_blocker": blocker or NO_VALUE,
        "stage_blocker_since": since,
    }


def _header_cells(row) -> list[str]:
    return [str(cell.value).strip() if cell.value is not None else "" for cell in row]


def _with_letter_fallback(header: list[str], values: list, row: dict) -> dict:
    """Use a column letter only when that header name is not on the row at all."""
    present = {str(name).strip() for name in header if str(name).strip()}
    for letter, name, _key in NDA_COLUMNS:
        if name in row or name in present:
            continue
        index = column_index(letter)
        LOGGER.warning("NDA column %s is not in the header row; using column %s", name, letter)
        if index < len(values):
            row[name] = values[index]
    return row


def _row_dict(header: list[str], values: list, *, letter_fallback: bool = False) -> dict:
    row = {}
    for index, key in enumerate(header):
        if key and index < len(values):
            row[key] = values[index]
    if letter_fallback:
        return _with_letter_fallback(header, values, row)
    return row


def _sheet_table(workbook, title: str, header_row: int, *, letter_fallback: bool = False) -> list[dict]:
    if title not in workbook.sheetnames:
        return []
    rows = list(workbook[title].iter_rows())
    if len(rows) <= header_row:
        return []
    header = _header_cells(rows[header_row])
    out = []
    for offset, row in enumerate(rows[header_row + 1 :]):
        values = [cell.value for cell in row]
        if not any(value not in (None, "") for value in values):
            continue
        item = _row_dict(header, values, letter_fallback=letter_fallback)
        item["_excel_row"] = header_row + offset + 2
        out.append(item)
    return out


def _skip_row(row: dict) -> bool:
    from scripts.build_data import is_off_market_row

    return is_off_market_row(row)


def site_mirrors(workbook) -> dict[str, dict]:
    sites: dict[str, dict] = {}
    for title in ("Pipeline", "Land Sites"):
        for row in _sheet_table(workbook, title, 3, letter_fallback=True):
            if _skip_row(row):
                continue
            site_id = _clean(row.get("Site ID")).upper()
            if not re.fullmatch(r"(PIPE|LAND)-[A-Z]{2,4}-\d{4}", site_id):
                continue
            sites[site_id] = nda_mirror_fields(row)
    return sites


def _register_row(row: dict) -> dict | None:
    nda_id = _clean(row.get("NDA ID"))
    if not nda_id:
        return None
    item = {}
    for header, key in zip(REGISTER_HEADERS, REGISTER_KEYS):
        raw = row.get(header)
        if key in DATE_KEYS:
            item[key] = _date_text(raw)
        elif key == "nda_days_in_court":
            item[key] = court_days(raw)
        elif key in DAY_KEYS:
            item[key] = _days(raw)
        elif key == "nda_status":
            item[key] = _status(raw, True)
        elif key == "site_ids":
            item[key] = _clean(raw)
        else:
            item[key] = _clean(raw)
    item["nda_id"] = nda_id
    return item


def read_register(workbook) -> list[dict]:
    rows = []
    for row in _sheet_table(workbook, "NDA Register", 0):
        item = _register_row(row)
        if item:
            rows.append(item)
    return rows


def workbook_has_nda(workbook) -> bool:
    names = set(workbook.sheetnames)
    if "NDA Register" not in names:
        return False
    if "Pipeline" not in names and "Land Sites" not in names:
        return False
    for title in ("Pipeline", "Land Sites"):
        if title not in names:
            continue
        rows = list(workbook[title].iter_rows(min_row=4, max_row=4))
        if not rows:
            continue
        header = _header_cells(rows[0])
        if "NDA ID" in header or "NDA status" in header:
            return True
        if column_index("EY") < len(header) and header[column_index("EY")] == "NDA ID":
            return True
    return False


def read_workbook_snapshot(path: Path) -> dict:
    import openpyxl

    workbook = openpyxl.load_workbook(path, read_only=False, data_only=True)
    try:
        payload = {
            "source": "workbook",
            "as_of": "",
            "label": "Read-only snapshot of NDA Register and the Pipeline and Land site mirrors.",
            "sites": site_mirrors(workbook),
            "register": read_register(workbook),
        }
    finally:
        workbook.close()
    return payload


def write_nda_file(workbook: Path, destination: Path) -> dict:
    """Write data/generated/nda.json. Does not save the workbook.

    A workbook without the register tab and the site mirror columns leaves the
    existing snapshot in place, and otherwise copies the labeled fixture.
    """
    import openpyxl

    from scripts.build_data import scan_obj

    book = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    try:
        ready = workbook_has_nda(book)
    finally:
        book.close()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not ready:
        if destination.exists():
            return {"kept": True, "source": "existing"}
        destination.write_text(FIXTURE.read_text(encoding="utf-8"))
        return {"kept": False, "source": "fixture"}
    payload = read_workbook_snapshot(workbook)
    problems = scan_obj(payload, "nda")
    if problems:
        raise SystemExit("NDA payload failed the data check:\n" + "\n".join(problems[:20]))
    destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return {
        "kept": False,
        "source": "workbook",
        "register": len(payload["register"]),
        "sites": len(payload["sites"]),
    }
