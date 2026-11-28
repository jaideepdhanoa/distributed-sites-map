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


COVERAGE_COLUMNS = {
    "Checked on": "reviewedOn", "County status": "countyStatus", "County evidence": "county",
    "County source": "countySource", "Space status": "spaceStatus", "Space evidence": "space",
    "Layout source": "layoutSource", "Finance status": "financeStatus", "Financial basis": "finance",
    "Next decision": "next", "Source record": "source",
}
CASE_COLUMNS = {
    "Stalls": "stalls", "Scenario": "kind", "Price tested": "price", "Retained cash per year": "cash",
    "Base cost per charge": "base", "Downside cost per charge": "downside",
    "Downside parity price": "ceiling", "Replica count": "replicas",
}


def coverage_rows(book, tab, columns):
    rows = iter(book[tab].values)
    if tuple(next(rows, ())) != ("Site ID", *columns):
        raise ValueError(f"Check the {tab} column headings.")
    for cells in rows:
        if any(value is not None for value in cells):
            yield cells[0], dict(zip(columns.values(), cells[1:], strict=True))


def attach_coverage(book, sites):
    if "Evidence coverage" not in book and "Screen cases" not in book:
        return
    if "Evidence coverage" not in book or "Screen cases" not in book:
        raise ValueError("Both evidence coverage and screen cases are required.")
    for site_id, entry in coverage_rows(book, "Evidence coverage", COVERAGE_COLUMNS):
        site = sites.get(site_id)
        if site is None or "coverage" in site:
            raise ValueError("Invalid or duplicate evidence coverage site.")
        entry["reviewedOn"] = date_text(entry["reviewedOn"])
        site["coverage"] = {**entry, "cases": []}
    for site_id, case in coverage_rows(book, "Screen cases", CASE_COLUMNS):
        evidence = sites.get(site_id, {}).get("coverage")
        if evidence is None or any(row["stalls"] == case["stalls"] for row in evidence["cases"]):
            raise ValueError("Invalid or duplicate evidence footprint.")
        evidence["cases"].append(case)


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
    attach_coverage(book, sites)
    if "Planning inputs" in book:
        columns = {"Input": "kind", "Label": "label", "Value": "value",
                   "Validate": "validation", "Source": "source"}
        for site_id, item in coverage_rows(book, "Planning inputs", columns):
            if site_id not in sites:
                raise ValueError("Unknown site in Planning inputs.")
            sites[site_id].setdefault("planningInputs", []).append(item)
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
