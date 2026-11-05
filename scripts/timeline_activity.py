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
