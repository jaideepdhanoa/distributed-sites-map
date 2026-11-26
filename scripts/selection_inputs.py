"""Publish only the workbook fields used by the signed-in selection review."""
import math
import re

from scripts.financials import PROTECTED_SITE_IDS


def number(cell):
    if isinstance(cell, bool) or cell is None:
        return None
    try:
        value = float(str(cell).strip().replace(",", ""))
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def selection_inputs(rows):
    result = {}
    for row in rows:
        key = str(row.get("Site ID") or "").strip()
        if key in PROTECTED_SITE_IDS or not re.fullmatch(r"PIPE-[A-Z]{3}-\d{4,}", key):
            continue
        result[key] = {
            "stage": row.get("Stage") or "",
            "segment": row.get("Segment") or "",
            "land": row.get("Archetype") == "Land only" or row.get("Knock-out") == "Land only",
            "unavailable": row.get("Listing status") == "Sold or withdrawn" or row.get("Knock-out") == "No longer for sale",
            "control": row.get("Tenant lease blocks site") == "Yes" or row.get("Real estate in the sale") == "No",
            "section": row.get("Scorecard section") or "",
            "screen": number(row.get("Saving vs. hub at the screening price")),
            "recorded": number(row.get("Stalls that fit")),
        }
    return result


if __name__ == "__main__":
    import json
    from scripts.build_data import OUT, sheet_rows, source_workbook

    rows = sheet_rows(source_workbook(), "Pipeline", 3)
    (OUT / "selection-inputs.json").write_text(json.dumps(selection_inputs(rows), sort_keys=True))
