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


VISIT_COLUMNS = {
    "Visit decision": "decision", "Why visit?": "reason", "Seller and economics": "commercial",
    "Power inquiry": "power", "Before booking": "beforeVisit", "On site": "fieldwork",
    "Scenario and price": "scenario", "Before an LOI": "beforeLoi", "Scenario basis": "basis",
}


def attach_visit_plans(book, sites):
    if "Visit decisions" not in book:
        return
    rows = iter(book["Visit decisions"].values)
    if tuple(next(rows, ())) != ("Site ID", *VISIT_COLUMNS):
        raise ValueError("Check the Visit decisions column headings.")
    for number, cells in enumerate(rows, 2):
        if not any(value is not None for value in cells):
            continue
        site = sites.get(cells[0])
        if site is None or "visitPlan" in site:
            raise ValueError(f"Check the site reference on visit decision row {number}.")
        if not all(isinstance(value, str) and value.strip() for value in cells[1:]):
            raise ValueError(f"Complete the visit decision on row {number}.")
        site["visitPlan"] = dict(zip(VISIT_COLUMNS.values(), cells[1:], strict=True))


def build(book, register=None):
    rows = iter(book["Opportunities"].values)
    headers = tuple(next(rows, ()))
    if headers not in (HEADERS, HEADERS + ("Drop reason",)):
        raise ValueError("The opportunity register headers have changed.")
    sites = {}
    for number, cells in enumerate(rows, 2):
        if not any(v is not None for v in cells):
            continue
        site_id, name, role, route, decision, rank, why, check, reviewed, owner, revisit, evidence, listing = cells[:len(HEADERS)]
        row = sites.setdefault(site_id, {"name": name, "primary": None, "alternatives": []})
        if not site_id or row["name"] != name or role not in ("Primary", "Alternative"):
            raise ValueError(f"Check site identity and role on opportunity row {number}.")
        option = dict(route=route, disposition=decision, rank=rank, rationale=why, next=check,
                      reviewedOn=date_text(reviewed), owner=owner, revisitOn=date_text(revisit),
                      evidence=evidence, offering=listing)
        if decision == "Dropped" and headers != HEADERS and not cells[-1]:
            raise ValueError(f"Choose a drop reason on opportunity row {number}.")
        if len(cells) > len(HEADERS) and cells[-1]:
            option["dropReason"] = cells[-1]
        if role == "Alternative":
            row["alternatives"].append(option)
        elif row["primary"] is None:
            row["primary"] = option
        else:
            raise ValueError(f"Duplicate primary opportunity on row {number}.")
    if not sites or any(not row["primary"] for row in sites.values()):
        raise ValueError("Each site needs one primary opportunity.")
    attach_visit_plans(book, sites)
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
