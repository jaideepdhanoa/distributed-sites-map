"""Build the private opportunity register for the signed-in selection review."""
from datetime import date
import json
from pathlib import Path
from openpyxl import load_workbook

HEADERS = ("Site ID", "Site name", "Role", "Route", "Disposition", "Rank", "Rationale",
           "Next check or reopening trigger", "Reviewed on", "Owner", "Revisit on",
           "Pipeline evidence", "Offering evidence")


def date_text(value):
    return value.strftime("%Y-%m-%d") if isinstance(value, date) else value


def build(book, register=None):
    rows = iter(book["Opportunities"].values)
    if tuple(next(rows, ())) != HEADERS:
        raise ValueError("The opportunity register headers have changed.")
    sites = {}
    for number, cells in enumerate(rows, 2):
        if not any(v is not None for v in cells):
            continue
        site_id, name, role, route, decision, rank, why, check, reviewed, owner, revisit, evidence, listing = cells
        row = sites.setdefault(site_id, {"name": name, "primary": None, "alternatives": []})
        if not site_id or row["name"] != name or role not in ("Primary", "Alternative"):
            raise ValueError(f"Check site identity and role on opportunity row {number}.")
        option = dict(route=route, disposition=decision, rank=rank, rationale=why, next=check,
                      reviewedOn=date_text(reviewed), owner=owner, revisitOn=date_text(revisit),
                      evidence=evidence, offering=listing)
        if role == "Alternative":
            row["alternatives"].append(option)
        elif row["primary"] is None:
            row["primary"] = option
        else:
            raise ValueError(f"Duplicate primary opportunity on row {number}.")
    if not sites or any(not row["primary"] for row in sites.values()):
        raise ValueError("Each site needs one primary opportunity.")
    return {"version": 1, "register": register, "sites": sites}


if __name__ == "__main__":
    source = Path("data/source/reviews/opportunity-reviews.xlsx")
    if not source.is_file():
        raise SystemExit("The private opportunity register is missing. The previous snapshot is retained.")
    location = source.with_suffix(".url")
    with source.open("rb") as f:
        book = load_workbook(f, read_only=True, data_only=True)
        try:
            result = build(book, location.read_text().strip() if location.exists() else None)
        finally:
            book.close()
    Path("data/generated/opportunity-reviews.json").write_text(json.dumps(result, ensure_ascii=False))
