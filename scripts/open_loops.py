"""Read Pipeline and Land rows for the open-loops panel. Never writes the workbook.

The panel is derived in lib/openLoops.ts from this snapshot, so the API and the
tests share one rule set. A workbook without the NDA columns keeps the
committed fixture. This module does not change Stage and does not update a saved job.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "data" / "fixtures" / "open-loops.json"
FIXTURE_LABEL = (
    "Fixture snapshot of open loops as of Nov 11, 2026 PT. "
    "Day counts are frozen to that date. A later sync recomputes them from the since dates."
)
REGISTER_KEEP = (
    "nda_id",
    "counterparty_firm",
    "counterparty_person",
    "site_ids",
    "nda_status",
    "nda_waiting_on",
    "nda_waiting_on_since",
    "nda_gates",
    "nda_days_open",
    "nda_days_in_court",
)
_FORBIDDEN_SENTENCE = re.compile(r"(?i)\bAVs?\b|\bcharging\b|\bautonomous\b")


def as_of_la() -> str:
    return datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()


def public_step(text: str, limit: int = 600) -> str:
    """Keep the next-step text the panel can show. Drop sentences we do not ship."""
    chunks = re.split(r"\n+|(?<=[.!?])\s+", str(text or "").replace("\r", "\n"))
    kept = []
    for chunk in chunks:
        piece = re.sub(r"\s+", " ", chunk).strip(" ;")
        if not piece or _FORBIDDEN_SENTENCE.search(piece):
            continue
        kept.append(piece)
    joined = " ".join(kept).strip()
    if len(joined) <= limit:
        return joined
    return joined[: limit - 1].rstrip() + "…"


def _site_row(row: dict) -> dict | None:
    from scripts.nda import _clean, _date_text

    site_id = _clean(row.get("Site ID")).upper()
    if not re.fullmatch(r"(PIPE|LAND)-[A-Z]{2,4}-\d{4}", site_id):
        return None
    name = _clean(row.get("Name"))
    site = _clean(row.get("Site"))
    blocker = _clean(row.get("Stage blocker")) or "—"
    return {
        "site_id": site_id,
        "label": public_step(name or site, 180),
        "market": _clean(row.get("Market")),
        "stage": _clean(row.get("Stage")),
        "next_step": public_step(row.get("Next step") or ""),
        "nda_id": _clean(row.get("NDA ID")),
        "stage_blocker": blocker,
        "stage_blocker_since": _date_text(row.get("Stage blocker since")),
    }


def read_loop_sites(workbook) -> list[dict]:
    from scripts.nda import _sheet_table

    sites: dict[str, dict] = {}
    for title in ("Pipeline", "Land Sites"):
        for row in _sheet_table(workbook, title, 3):
            item = _site_row(row)
            if item:
                sites[item["site_id"]] = item
    return [sites[key] for key in sorted(sites)]


def read_loop_register(workbook) -> list[dict]:
    from scripts.nda import read_register

    rows = []
    for row in read_register(workbook):
        rows.append({key: row.get(key, "") for key in REGISTER_KEEP})
    return rows


def snapshot_from_workbook(workbook, *, source: str, as_of: str, label: str) -> dict:
    return {
        "source": source,
        "as_of": as_of,
        "label": label,
        "register": read_loop_register(workbook),
        "sites": read_loop_sites(workbook),
    }


def write_open_loops_file(workbook: Path, destination: Path) -> dict:
    """Write data/generated/open-loops.json. Does not save the workbook."""
    import openpyxl

    from scripts.build_data import scan_obj
    from scripts.nda import workbook_has_nda

    book = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    try:
        ready = workbook_has_nda(book)
        payload = (
            snapshot_from_workbook(
                book,
                source="workbook",
                as_of=as_of_la(),
                label="Read-only snapshot of open loops. Day counts use the sync date in America/Los_Angeles.",
            )
            if ready
            else None
        )
    finally:
        book.close()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if payload is None:
        if destination.exists():
            return {"kept": True, "source": "existing"}
        destination.write_text(FIXTURE.read_text(encoding="utf-8"))
        return {"kept": False, "source": "fixture"}
    problems = scan_obj(payload, "open-loops")
    if problems:
        raise SystemExit("Open-loops payload failed the data check:\n" + "\n".join(problems[:20]))
    destination.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return {
        "kept": False,
        "source": "workbook",
        "register": len(payload["register"]),
        "sites": len(payload["sites"]),
    }
