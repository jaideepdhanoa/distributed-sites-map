"""Read the workbook Activity tab. Missing tab means there is nothing to show."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import openpyxl

from timeline_policy import STATUS, clean_link, status_line

TYPE_ALIASES = {
    "call": "call",
    "visit": "visit",
    "site visit": "visit",
    "doc": "doc",
    "document": "doc",
    "email": "email",
    "brochure": "brochure",
    "flyer": "brochure",
    "om": "om",
    "financials": "financials",
    "financial": "financials",
    "photos": "photos",
    "photo": "photos",
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


def read_activity(workbook: Path | None, config: dict) -> list[dict]:
    if workbook is None or not workbook.exists():
        return []
    sheet_name = (config.get("activity") or {}).get("sheet") or "Activity"
    wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    if sheet_name not in wb.sheetnames:
        wb.close()
        return []
    rows = list(wb[sheet_name].iter_rows(values_only=True))
    wb.close()
    header_at = int((config.get("activity") or {}).get("headerRow") or 1) - 1
    if header_at < 0 or header_at >= len(rows):
        return []
    headers = [_norm(cell) for cell in rows[header_at]]
    index: dict[str, int] = {}
    for key, aliases in ((config.get("activity") or {}).get("columns") or {}).items():
        for alias in aliases:
            name = _norm(alias)
            if name in headers:
                index[key] = headers.index(name)
                break
    if "siteId" not in index:
        return []
    items = []
    for row in rows[header_at + 1 :]:
        if not row or all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        record_id = str(_cell(row, index, "siteId") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{1,80}", record_id):
            continue
        kind = TYPE_ALIASES.get(_norm(_cell(row, index, "type")))
        if kind not in STATUS:
            continue
        summary = status_line(kind, str(_cell(row, index, "summary") or ""))
        if not summary:
            continue
        items.append(
            {
                "record_id": record_id,
                "date": _date(_cell(row, index, "date")),
                "kind": "activity",
                "type": kind,
                "summary": summary,
                "link": clean_link(str(_cell(row, index, "link") or "")),
            }
        )
    return items
