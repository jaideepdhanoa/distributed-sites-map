"""Read Map rows from the workbook Activity tab."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import openpyxl

from timeline_policy import STATUS, status_line

MAP_TYPES = {
    "listing",
    "brochure",
    "om",
    "financials",
    "photos",
    "legal",
    "doc",
    "visit",
    "stage",
}


def _norm(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _date(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]):
        return text[:10]
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _cell(row, index: dict, key: str):
    position = index.get(key)
    if position is None or position >= len(row):
        return ""
    return row[position]


def read_activity(workbook: Path | None, config: dict, known_ids: set[str] | None = None) -> tuple[list[dict], list[str]]:
    if workbook is None or not workbook.exists():
        return [], []
    sheet_name = (config.get("activity") or {}).get("sheet") or "Activity"
    wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    if sheet_name not in wb.sheetnames:
        wb.close()
        return [], []
    rows = list(wb[sheet_name].iter_rows(values_only=True))
    wb.close()
    header_at = int((config.get("activity") or {}).get("headerRow") or 1) - 1
    if header_at < 0 or header_at >= len(rows):
        return [], []
    headers = [_norm(cell) for cell in rows[header_at]]
    index: dict[str, int] = {}
    for key, aliases in ((config.get("activity") or {}).get("columns") or {}).items():
        for alias in aliases:
            name = _norm(alias)
            if name in headers:
                index[key] = headers.index(name)
                break
    if "siteId" not in index:
        return [], []
    warnings: list[str] = []
    items: list[dict] = []
    for row in rows[header_at + 1 :]:
        if not row or all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        if _norm(_cell(row, index, "visibility")) != "map":
            continue
        event_id = str(_cell(row, index, "eventId") or "").strip()
        record_id = str(_cell(row, index, "siteId") or "").strip().upper()
        if known_ids is not None and record_id not in known_ids:
            warnings.append(f"Activity {event_id or '?'} does not match a Site ID")
            continue
        kind = _norm(_cell(row, index, "type"))
        if kind not in MAP_TYPES or kind not in STATUS:
            continue
        when = _date(_cell(row, index, "date"))
        if not when:
            continue
        summary = status_line(kind, str(_cell(row, index, "summary") or ""))
        if not summary:
            continue
        items.append({"record_id": record_id, "event_id": event_id, "date": when, "type": kind, "summary": summary})
    return items, warnings


def broker_contact_dates(workbook: Path | None, config: dict | None = None) -> dict[str, str]:
    """Latest broker email or call per Site ID.

    The same Activity tab feeds the timeline. Outbound rows and internal rows
    both count. Only the date is returned. Summary text is never copied out.
    """
    if workbook is None or not workbook.exists():
        return {}
    if config is None:
        from timeline_config import load_config

        config = load_config()
    sheet_name = (config.get("activity") or {}).get("sheet") or "Activity"
    wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    if sheet_name not in wb.sheetnames:
        wb.close()
        return {}
    rows = list(wb[sheet_name].iter_rows(values_only=True))
    wb.close()
    header_at = int((config.get("activity") or {}).get("headerRow") or 1) - 1
    if header_at < 0 or header_at >= len(rows):
        return {}
    headers = [_norm(cell) for cell in rows[header_at]]

    def col(*names: str) -> int | None:
        for name in names:
            if name in headers:
                return headers.index(name)
        return None

    site_at = col("site id", "site_id", "record id")
    type_at = col("type", "kind")
    date_at = col("date", "when")
    direction_at = col("direction")
    role_at = col("counterparty role", "counterparty", "role")
    if site_at is None or type_at is None or date_at is None:
        return {}
    latest: dict[str, str] = {}
    for row in rows[header_at + 1 :]:
        if not row:
            continue
        kind = _norm(row[type_at] if type_at < len(row) else "")
        if kind not in {"email", "call"}:
            continue
        direction = _norm(row[direction_at] if direction_at is not None and direction_at < len(row) else "")
        role = _norm(row[role_at] if role_at is not None and role_at < len(row) else "")
        if direction not in {"out", "internal"} or role != "broker":
            continue
        record_id = str(row[site_at] if site_at < len(row) else "").strip().upper()
        when = _date(row[date_at] if date_at < len(row) else "")
        if record_id and when and when > latest.get(record_id, ""):
            latest[record_id] = when
    return latest
