"""Signed-in financial figures from the workbook.

Reads Financial facts and Package checklist when those tabs exist.
Otherwise the panel is built from Pipeline and Land Sites columns.
This module never writes the workbook, and it never rewrites identity
cells for PIPE-PHX-0006.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from scripts.key_numbers import (
    claim_word,
    financials_basis,
    financials_open,
    money,
    package_line,
    package_status_label,
)

# Identity cells on this row are known to be shifted. Do not write them.
PROTECTED_SITE_IDS = frozenset({"PIPE-PHX-0006"})
# Parent program folder. A package link never points here.
PARENT_FOLDER_ID = "1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk"
BLOCKED_FOLDER_IDS = frozenset({
    PARENT_FOLDER_ID,
    "11ONFb99evERFObom8lf_Qq81onW50WBw",
})
SOURCE_FOLDER_NAME = "Source files"
PACKAGE_FOLDER_NAME = "1 Financials"

FACT_HEADERS = (
    "Site ID",
    "Figure",
    "Period",
    "Value",
    "Metric label",
    "Claim",
    "Source file",
    "Page",
    "Recast role",
    "As of",
    "Captured by",
)
CHECK_HEADERS = (
    "Site ID",
    "Item",
    "State",
    "Covers period",
    "File link",
    "Asked on",
    "Owner",
    "Received on",
    "Note",
)
PERIODS = ("Latest", "Prior", "Two years prior")
CHECKLIST = (
    ("pl_years", "Three years of P&Ls plus YTD"),
    ("car_counts", "24 months of car counts"),
    ("membership", "Membership count and monthly revenue"),
    ("payroll", "Payroll summary"),
    ("rent", "Rent or lease terms"),
    ("water_bills", "Water and " + "util" + "ity bills"),
)
RECAST_ROLES = {
    "reported": "Reported",
    "addback accepted": "Addback accepted",
    "addback proposed": "Addback proposed",
    "needs support": "Needs support",
    "normalized result": "Normalized result",
}
COUNTED_ROLES = {"Reported", "Addback accepted", "Normalized result"}
DRIVE_ID = re.compile(r"/(?:folders|file/d)/([A-Za-z0-9_-]+)")
SENSITIVE_NAME = re.compile(r"(?i)(payroll|tax return|schedule c|\bw-?2\b|\b1099\b)")
EMAIL_FOLDER = re.compile(r"(?i)^4\b|emails and calls")


def column_index(letter: str) -> int:
    index = 0
    for char in letter.strip().upper():
        index = index * 26 + (ord(char) - 64)
    return index - 1


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _amount(value):
    """A typed figure. Blank and zero stay empty so the panel can show a state."""
    if _blank(value) or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", "").replace("$", ""))
        if not match:
            return None
        number = float(match.group())
    if number == 0:
        return None
    return number


def _whole_text(number) -> str:
    if number is None:
        return ""
    return money(round(float(number))) or ""


def _count_text(number) -> str:
    if number is None:
        return ""
    value = float(number)
    if value.is_integer():
        return f"{int(value):,}"
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def _cents_text(number) -> str:
    if number is None:
        return ""
    value = float(number)
    cents = int(round(abs(value) * 100))
    if cents % 100 == 0:
        return _whole_text(value)
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.2f}"


def _date_text(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool) and 20000 < float(value) < 80000:
        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()
    text = str(value).strip()
    match = re.match(r"(\d{4}-\d{2}-\d{2})", text)
    if match:
        return match.group(1)
    return ""


def _clean_note(value) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text or EMAIL_FOLDER.search(text):
        return ""
    return text[:240]


def period_bucket(value) -> tuple[str, str]:
    """Map a typed period onto Latest / Prior / Two years prior. The typed words stay."""
    typed = re.sub(r"\s+", " ", str(value or "")).strip()
    raw = typed.lower()
    if raw in {"", "latest", "current", "ttm", "ytd", "this year"}:
        return "Latest", typed or "Latest"
    if "two year" in raw or raw in {"year-2", "y-2"}:
        return "Two years prior", typed or "Two years prior"
    if raw in {"prior", "last year", "year-1", "y-1"} or raw.startswith("prior"):
        return "Prior", typed or "Prior"
    for name in PERIODS:
        if raw == name.lower():
            return name, typed or name
    return "Latest", typed or "Latest"


def claim_label(value: str, *, normalized: bool = False) -> str:
    if normalized:
        return "Normalized"
    text = str(value or "").strip().lower()
    if text in {"claimed", "broker-stated", "broker stated"}:
        return "Broker-stated"
    if text == "documented":
        return "Documented"
    if text == "verified":
        return "Verified"
    if text == "normalized":
        return "Normalized"
    return ""


def recast_role(value) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip().lower()
    return RECAST_ROLES.get(text, "")


def safe_drive_href(value) -> str:
    """A Drive file or folder link, never the parent program folder."""
    text = str(value or "").strip()
    if not text or "drive.google.com" not in text:
        return ""
    match = DRIVE_ID.search(text)
    if not match or match.group(1) in BLOCKED_FOLDER_IDS:
        return ""
    return text.split("?")[0]


def sensitive_name(value) -> bool:
    return bool(SENSITIVE_NAME.search(str(value or "")))


def excluded_material(value) -> bool:
    return bool(EMAIL_FOLDER.search(str(value or "")))


def item_id(value) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    if "p&l" in raw or "p & l" in raw or "profit" in raw:
        return "pl_years"
    if "car" in raw:
        return "car_counts"
    if "member" in raw:
        return "membership"
    if "payroll" in raw:
        return "payroll"
    if "rent" in raw or "lease" in raw:
        return "rent"
    if "water" in raw or "util" in raw:
        return "water_bills"
    return ""


def _header_matches(row: list, expected: tuple[str, ...]) -> bool:
    labels = [str(cell or "").strip() for cell in row[: len(expected)]]
    return tuple(labels) == expected


def _sheet_table(workbook, title: str, expected: tuple[str, ...]) -> list[dict]:
    if title not in workbook.sheetnames:
        return []
    rows = list(workbook[title].iter_rows(values_only=True))
    header_at = None
    for index, row in enumerate(rows[:6]):
        if row and _header_matches(list(row), expected):
            header_at = index
            break
    if header_at is None:
        return []
    out = []
    for row in rows[header_at + 1 :]:
        if not row or _blank(row[0]):
            continue
        item = {}
        for index, key in enumerate(expected):
            item[key] = row[index] if index < len(row) else None
        out.append(item)
    return out


def _by_site(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        site_id = str(row.get("Site ID") or "").strip().upper()
        if not site_id:
            continue
        grouped.setdefault(site_id, []).append(row)
    return grouped


LETTERS = {
    "revenue": "I",
    "earnings": "J",
    "label": "DU",
    "claimed": "DV",
    "years": "DW",
    "members": "DX",
    "member_revenue": "DY",
    "package": "DZ",
    "normalized": "EA",
    "cars_latest": "EB",
    "cars_prior": "EC",
    "cars_older": "ED",
    "revenue_prior": "EE",
    "revenue_older": "EF",
    "member_share": "EG",
    "addbacks": "EH",
    "checked": "EI",
    "notes": "EJ",
    "status": "BE",
    "folder": "AE",
    "source": "AG",
    "business": "CE",
}
NAMES = {
    "revenue": ("Revenue ($ a year)", "Revenue"),
    "earnings": ("EBITDA ($ a year)", "EBITDA"),
    "label": ("Claimed cash-flow label", "Cash-flow label"),
    "claimed": ("Claimed cash flow ($ a year)", "Claimed cash flow"),
    "years": ("Years operating",),
    "members": ("Membership count", "Members"),
    "member_revenue": ("Membership revenue ($ a month)", "Monthly membership revenue"),
    "package": ("Package status",),
    "normalized": ("Normalized EBITDA ($ a year)", "Normalized EBITDA"),
    "cars_latest": ("Car counts (latest)", "Car counts"),
    "cars_prior": ("Car counts (prior)",),
    "cars_older": ("Car counts (two years prior)",),
    "revenue_prior": ("Prior revenue ($ a year)", "Revenue prior year"),
    "revenue_older": ("Revenue two years prior ($ a year)",),
    "member_share": ("Membership share",),
    "addbacks": ("Addbacks ($)", "Addbacks"),
    "checked": ("Financials checked",),
    "notes": ("Financials notes",),
    "status": ("Financials status",),
    "folder": ("Folder",),
    "source": ("Source of the numbers",),
    "business": ("Business check",),
}


def _named(row: dict, key: str):
    folded = {str(name).strip().lower(): value for name, value in row.items() if not str(name).startswith("_")}
    for name in NAMES[key]:
        if name.lower() in folded and not _blank(folded[name.lower()]):
            return folded[name.lower()]
    letters = row.get("_letters") or {}
    return letters.get(key)


def _state(present: bool, package_status: str, asked_on: str, why: str) -> dict:
    status = (package_status or "").lower()
    if "refus" in status or "unavailable" in status:
        return {"state": "Not available", "since": "", "why": why or "Refused or unavailable"}
    if present and "partial" in status and "request" in status:
        return {"state": "Some on file, more asked for", "since": "", "why": ""}
    if present and "partial" in status:
        return {"state": "Some on file, more asked for", "since": "", "why": ""}
    if present:
        return {"state": "On file", "since": "", "why": ""}
    if "request" in status:
        return {"state": "Asked for", "since": asked_on, "why": ""}
    if why:
        return {"state": "Not available", "since": "", "why": why}
    return {"state": "Not asked yet", "since": "", "why": ""}


def _figure(
    *,
    figure: str,
    period: str,
    period_label: str,
    amount,
    metric: str,
    claim: str,
    source_name: str,
    source_href: str,
    page: str,
    recast: str,
    state: dict,
    cents: bool = False,
    style: str = "money",
) -> dict | None:
    if excluded_material(source_name) or excluded_material(figure):
        return None
    if sensitive_name(figure) or sensitive_name(source_name):
        return None
    text = ""
    if amount is not None:
        if style == "count":
            text = _count_text(amount)
        elif cents or recast in {"Addback accepted", "Addback proposed", "Needs support"}:
            text = _cents_text(amount)
        else:
            text = _whole_text(amount)
    return {
        "figure": figure,
        "period": period,
        "period_label": period_label,
        "text": text,
        "metric": metric,
        "claim": claim,
        "source_name": "" if sensitive_name(source_name) else source_name,
        "source_href": safe_drive_href(source_href),
        "page": str(page or "").strip(),
        "recast": recast,
        "state": state["state"],
        "since": state["since"],
        "why": state["why"],
    }


def _derived_figures(row: dict, package_status: str, basis: str, asked_on: str) -> list[dict]:
    """Headline columns only. A blank cell becomes a state, never a zero."""
    normalized = _amount(_named(row, "normalized"))
    claim = claim_word(basis, normalized) or claim_label(basis)
    label = str(_named(row, "label") or "").strip() or "Earnings"
    reported_key = "claimed" if _amount(_named(row, "claimed")) is not None else "earnings"
    slots = (
        ("Revenue", "Latest", "revenue", False, "money"),
        (label, "Latest", "claimed", False, "money"),
        ("Earnings", "Latest", "earnings", False, "money"),
        ("Normalized EBITDA", "Latest", "normalized", False, "money"),
        ("Membership count", "Latest", "members", False, "count"),
        ("Membership revenue", "Latest", "member_revenue", False, "money"),
        ("Car counts", "Latest", "cars_latest", False, "count"),
        ("Car counts", "Prior", "cars_prior", False, "count"),
        ("Car counts", "Two years prior", "cars_older", False, "count"),
        ("Revenue", "Prior", "revenue_prior", False, "money"),
        ("Revenue", "Two years prior", "revenue_older", False, "money"),
        ("Years operating", "Latest", "years", False, "count"),
        ("Addbacks", "Latest", "addbacks", True, "money"),
    )
    seen = set()
    figures = []
    why = ""
    business = str(_named(row, "business") or "")
    if re.search(r"(?i)no business|land only", business):
        why = "No business on this site"
    note = _clean_note(_named(row, "notes"))
    if note and not why:
        why = note
    for figure, period, key, cents, style in slots:
        amount = _amount(_named(row, key))
        if key == "claimed" and amount is not None and _amount(_named(row, "earnings")) == amount and label.lower() == "ebitda":
            continue
        marker = (figure, period, key)
        if marker in seen:
            continue
        seen.add(marker)
        state = _state(amount is not None, package_status, asked_on, "" if amount is not None else why)
        item_claim = "Normalized" if key == "normalized" and amount is not None else claim
        if key == "addbacks" and amount is not None:
            role = "Needs support"
        elif key == "normalized" and amount is not None:
            role = "Normalized result"
        elif key == reported_key and amount is not None:
            role = "Reported"
        else:
            role = ""
        built = _figure(
            figure=figure,
            period=period,
            period_label=period,
            amount=amount,
            metric=label if key in {"claimed", "earnings", "normalized"} else figure,
            claim=item_claim if amount is not None else "",
            source_name="",
            source_href="",
            page="",
            recast=role,
            state=state,
            cents=cents,
            style=style,
        )
        if built:
            figures.append(built)
    return figures


def _facts_from_tab(rows: list[dict], fallback_claim: str) -> tuple[list[dict], list[dict]]:
    figures = []
    listed = []
    for row in rows:
        figure = str(row.get("Figure") or "").strip()
        source = str(row.get("Source file") or "").strip()
        if not figure or excluded_material(figure) or excluded_material(source):
            continue
        href = safe_drive_href(source)
        name = source if not href else Path(source).name or source
        if sensitive_name(figure) or sensitive_name(source):
            if name and not excluded_material(name):
                listed.append({"name": name, "href": href})
            continue
        amount = _amount(row.get("Value"))
        period, period_label = period_bucket(row.get("Period"))
        role = recast_role(row.get("Recast role"))
        claim = claim_label(str(row.get("Claim") or "")) or fallback_claim
        if amount is not None:
            state = {"state": "On file", "since": "", "why": ""}
        elif str(row.get("Claim") or "").strip() or source:
            state = {"state": "Asked for", "since": "", "why": ""}
        else:
            state = {"state": "Not asked yet", "since": "", "why": ""}
        built = _figure(
            figure=figure,
            period=period,
            period_label=period_label,
            amount=amount,
            metric=str(row.get("Metric label") or "").strip() or figure,
            claim=claim if amount is not None else "",
            source_name="" if href else source,
            source_href=href,
            page=str(row.get("Page") or "").strip(),
            recast=role,
            state=state,
            cents=role in {"Addback accepted", "Addback proposed", "Needs support", "Reported"},
        )
        if built:
            figures.append(built)
    return figures, listed


def _checklist_state(raw, href: str, received: str) -> str:
    """Keep the workbook's item state. A package-level Received does not mark every item On file."""
    text = re.sub(r"\s+", " ", str(raw or "")).strip().lower()
    if text.startswith("some on file"):
        return "Some on file, more asked for"
    if text.startswith("asked for") or text == "requested":
        return "Asked for"
    if text.startswith("not available") or "unavailable" in text or text.startswith("refused"):
        return "Not available"
    if text.startswith("not asked"):
        return "Not asked yet"
    if text == "on file":
        return "On file"
    if href or received:
        return "On file"
    return "Not asked yet"


def _gap_why(state: str, note) -> str:
    if state != "Not available":
        return ""
    if re.search(r"(?i)escrow", str(note or "")):
        return "Seller will share at escrow"
    return ""


def _checklist_from_tab(rows: list[dict]) -> list[dict]:
    by_id = {}
    for row in rows:
        if excluded_material(str(row.get("Item") or "")) or excluded_material(str(row.get("File link") or "")):
            continue
        key = item_id(row.get("Item"))
        if not key:
            continue
        href = safe_drive_href(row.get("File link"))
        received = _date_text(row.get("Received on"))
        state = _checklist_state(row.get("State"), href, received)
        by_id[key] = {
            "id": key,
            "state": state,
            "since": _date_text(row.get("Asked on")),
            "why": _gap_why(state, row.get("Note")),
            "period": str(row.get("Covers period") or "").strip(),
            "href": href,
            "owner": str(row.get("Owner") or "").strip(),
            "received_on": received,
            "note": "",
        }
    return [_checklist_row(key, by_id.get(key)) for key, _label in CHECKLIST]


def _checklist_row(key: str, current: dict | None) -> dict:
    if current:
        return current
    return {
        "id": key,
        "state": "Not asked yet",
        "since": "",
        "why": "",
        "period": "",
        "href": "",
        "owner": "",
        "received_on": "",
        "note": "",
    }


def _default_checklist(package_status: str, asked_on: str, why: str) -> list[dict]:
    """No item row means the item is not known. Package Received is not proof each item is on file."""
    lowered = (package_status or "").lower()
    if "partial" in lowered:
        state = {"state": "Some on file, more asked for", "since": "", "why": ""}
    elif "refus" in lowered or "unavailable" in lowered:
        state = {"state": "Not available", "since": "", "why": why or "Refused or unavailable"}
    elif "request" in lowered:
        state = {"state": "Asked for", "since": asked_on, "why": ""}
    else:
        state = {"state": "Not asked yet", "since": "", "why": why}
    rows = []
    for key, _label in CHECKLIST:
        rows.append({
            "id": key,
            "state": state["state"],
            "since": state["since"],
            "why": state["why"],
            "period": "",
            "href": "",
            "owner": "",
            "received_on": "",
            "note": "",
        })
    return rows


def _bridge_line(figure: dict, *, role: str, counted: bool, text: str | None = None) -> dict:
    return {
        "figure": figure["figure"],
        "text": text if text is not None else figure.get("text") or "",
        "role": role,
        "page": figure.get("page") or "",
        "source_name": figure.get("source_name") or "",
        "source_href": figure.get("source_href") or "",
        "counted": counted,
    }


def _reported_earnings(figures: list[dict], headline_text: str) -> dict | None:
    reported = [figure for figure in figures if figure.get("recast") == "Reported" and figure.get("text")]
    for figure in reported:
        if headline_text and figure["text"] == headline_text:
            return figure
    for figure in reported:
        if re.search(r"(?i)ebitda|cash flow", figure.get("figure") or ""):
            return figure
    return None


def _bridge(figures: list[dict], normalized, headline_text: str = "") -> tuple[list[dict], dict | None]:
    """Reported earnings, then each addback. Proposed and needs-support lines are not counted."""
    lines = []
    reported = _reported_earnings(figures, headline_text)
    if reported:
        lines.append(_bridge_line(reported, role="Reported", counted=True, text=_whole_text(_amount(reported["text"])) or reported["text"]))
    for figure in figures:
        role = figure.get("recast") or ""
        if role not in {"Addback accepted", "Addback proposed", "Needs support"} or not figure.get("text"):
            continue
        lines.append(_bridge_line(figure, role=role, counted=role == "Addback accepted"))
    normalized_fact = next((figure for figure in figures if figure.get("recast") == "Normalized result" and figure.get("text")), None)
    if normalized_fact:
        ending = _bridge_line(normalized_fact, role="Normalized result", counted=True)
        ending["figure"] = "Normalized EBITDA"
        return lines, ending
    if normalized is not None:
        return lines, {
            "figure": "Normalized EBITDA",
            "text": _cents_text(normalized),
            "role": "Normalized result",
            "page": "",
            "source_name": "",
            "source_href": "",
            "counted": True,
        }
    if not lines:
        return [], None
    return lines, {
        "figure": "Normalized EBITDA",
        "text": "",
        "role": "Normalized result",
        "page": "",
        "source_name": "",
        "source_href": "",
        "counted": False,
    }


def _claims(row: dict, package_status: str, basis: str) -> list[dict]:
    """Broker column versus document column. Prices stay out of this section."""
    claimed = _amount(_named(row, "claimed"))
    documented = _amount(_named(row, "earnings"))
    normalized = _amount(_named(row, "normalized"))
    revenue = _amount(_named(row, "revenue"))
    members = _amount(_named(row, "members"))
    docs_earnings = normalized if normalized is not None else documented
    broker_claim = basis == "Claimed"
    doc_claim = basis in {"Documented", "Verified"} or normalized is not None

    def money_side(amount, show: bool) -> str:
        if amount is None or not show:
            return ""
        return _whole_text(amount)

    def count_side(amount, show: bool) -> str:
        if amount is None or not show:
            return ""
        return _count_text(amount)

    broker_earnings = claimed if broker_claim else None
    if claimed is not None and documented is not None and round(float(claimed)) != round(float(documented)):
        broker_earnings = claimed
    package = package_line(package_status) or _state(False, package_status, "", "")["state"]
    return [
        {"topic": "Earnings", "broker": money_side(broker_earnings, broker_earnings is not None), "documents": money_side(docs_earnings, doc_claim)},
        {"topic": "Revenue", "broker": money_side(revenue, broker_claim), "documents": money_side(revenue, doc_claim)},
        {"topic": "Members", "broker": count_side(members, broker_claim), "documents": count_side(members, doc_claim)},
        {"topic": "Package contents", "broker": "", "documents": package},
    ]


def _headline(row: dict, basis: str, package_status: str) -> dict:
    from scripts.key_numbers import cash_flow_label

    label = cash_flow_label(_named(row, "label"))
    normalized = _amount(_named(row, "normalized"))
    claimed = _amount(_named(row, "claimed"))
    legacy = _amount(_named(row, "earnings"))
    if label == "Normalized EBITDA" and normalized is not None:
        amount = normalized
    elif claimed is not None:
        amount = claimed
    else:
        amount = legacy
        if amount is not None and not label:
            label = "EBITDA"
    if amount is not None and not label:
        label = "Earnings"
    return {
        "text": _whole_text(amount),
        "metric": label if amount is not None else "",
        "claim": claim_word(basis, normalized),
        "packageLine": package_line(package_status),
    }


def _place_periods(figures: list[dict], headline_text: str) -> None:
    """Put the headline year on Latest, the year before on Prior, and the year before that on Two years prior."""
    anchor = None
    for figure in figures:
        if headline_text and figure.get("text") == headline_text:
            years = [int(year) for year in re.findall(r"20\d{2}", figure.get("period_label") or "")]
            if years:
                anchor = years[-1]
                break
    if anchor is None:
        years = [int(year) for figure in figures for year in re.findall(r"20\d{2}", figure.get("period_label") or "")]
        anchor = max(years) if years else None
    for figure in figures:
        years = [int(year) for year in re.findall(r"20\d{2}", figure.get("period_label") or "")]
        if not years or anchor is None:
            figure["period"] = figure.get("period") or "Latest"
            continue
        year = max(years)
        if year >= anchor:
            figure["period"] = "Latest"
        elif year == anchor - 1:
            figure["period"] = "Prior"
        elif year == anchor - 2:
            figure["period"] = "Two years prior"
        else:
            figure["period"] = "Latest"


def build_site(deal_id: str, kind: str, row: dict, fact_rows: list[dict] | None, check_rows: list[dict] | None, package_href: str = "", listed: list[dict] | None = None) -> dict:
    """One site. Missing tabs fall back to Pipeline columns. No invented figures."""
    status = financials_basis(_named(row, "status"))
    business = str(_named(row, "business") or "")
    package_status = package_status_label(_named(row, "package"))
    open_panel = financials_open(kind, business, str(_named(row, "status") or ""))
    if not open_panel:
        return {"open": False}
    asked_on = ""
    if check_rows:
        dates = [_date_text(item.get("Asked on")) for item in check_rows]
        asked_on = sorted(day for day in dates if day)[:1]
        asked_on = asked_on[0] if asked_on else ""
    normalized = _amount(_named(row, "normalized"))
    if fact_rows:
        figures, sensitive = _facts_from_tab(fact_rows, claim_word(status, normalized))
    else:
        figures = _derived_figures(row, package_status, status, asked_on)
        sensitive = []
    if check_rows:
        checklist = _checklist_from_tab(check_rows)
    else:
        why = "No business on this site" if re.search(r"(?i)no business|land only", business) else ""
        checklist = _default_checklist(package_status, asked_on, why)
    headline = _headline(row, status, package_status)
    if asked_on and package_status == "Requested":
        headline["packageLine"] = package_line(package_status, asked_on)
    _place_periods(figures, headline.get("text") or "")
    bridge, ending = _bridge(figures, normalized, headline.get("text") or "")
    href = safe_drive_href(package_href)
    listed_out = []
    for item in (listed or []) + sensitive:
        name = str(item.get("name") or "").strip()
        link = safe_drive_href(item.get("href") or "")
        if not name or excluded_material(name) or not sensitive_name(name):
            continue
        listed_out.append({"name": name, "href": link})
    return {
        "open": True,
        "packageStatus": package_status,
        "packageLine": headline["packageLine"],
        "packageHref": href,
        "headline": headline,
        "figures": figures,
        "bridge": bridge,
        "ending": ending,
        "claims": _claims(row, package_status, status),
        "checklist": checklist,
        "listed": listed_out,
        "factsTab": bool(fact_rows),
        "checklistTab": bool(check_rows),
    }


def _row_from_sheet(header: list[str], values, links) -> dict:
    row = {}
    letters = {}
    letter_keys = {column_index(letter): key for key, letter in LETTERS.items()}
    for index, cell in enumerate(values):
        key = header[index] if index < len(header) else ""
        if key:
            row[key] = cell
        if index in letter_keys and not _blank(cell):
            letters[letter_keys[index]] = cell
    row["_letters"] = letters
    row["_links"] = links
    return row


def read_workbook(path: Path, reg: dict | None = None) -> tuple[list[tuple[str, str, dict]], dict[str, list[dict]], dict[str, list[dict]]]:
    import openpyxl

    from scripts.build_data import is_off_market_row, registry_load, shipped_deal_id

    workbook = openpyxl.load_workbook(path, read_only=False, data_only=True)
    if reg is None:
        reg = registry_load()
    sites = []
    for kind, title in (("pipeline", "Pipeline"), ("land", "Land Sites")):
        if title not in workbook.sheetnames:
            continue
        rows = list(workbook[title].iter_rows())
        if len(rows) < 5:
            continue
        header = [str(cell.value).strip() if cell.value is not None else "" for cell in rows[3]]
        for index, row in enumerate(rows[4:], start=1):
            values = [cell.value for cell in row]
            links = []
            for cell, key in zip(row, header):
                if key and cell.hyperlink is not None and cell.hyperlink.target:
                    links.append((key, str(cell.hyperlink.target)))
            item = _row_from_sheet(header, values, links)
            if is_off_market_row(item):
                continue
            if not any(not _blank(item.get(key)) for key in ("Site ID", "Name", "Site", "APN or folio")):
                continue
            deal_id = shipped_deal_id(item, kind, index, reg)
            sites.append((deal_id, kind, item))
    facts = _by_site(_sheet_table(workbook, "Financial facts", FACT_HEADERS))
    checks = _by_site(_sheet_table(workbook, "Package checklist", CHECK_HEADERS))
    workbook.close()
    return sites, facts, checks


def build_payload(sites: list[tuple[str, str, dict]], facts: dict[str, list[dict]], checks: dict[str, list[dict]], links: dict[str, str] | None = None) -> dict:
    links = links or {}
    payload = {}
    for deal_id, kind, row in sites:
        payload[deal_id] = build_site(deal_id, kind, row, facts.get(deal_id), checks.get(deal_id), links.get(deal_id, ""))
    return {"sites": payload}


def write_financials_file(workbook: Path, destination: Path, reg: dict | None = None) -> dict:
    """Write data/generated/financials.json. Does not write the workbook.

    A workbook export that does not yet contain the two tabs leaves an existing
    snapshot in place, so a later sync cannot wipe figures that were already read.
    """
    import openpyxl

    book = openpyxl.load_workbook(workbook, read_only=True)
    names = list(book.sheetnames)
    book.close()
    if "Financial facts" not in names and "Package checklist" not in names and destination.exists():
        return {"sites": 0, "kept": True}
    sites, facts, checks = read_workbook(workbook, reg)
    payload = build_payload(sites, facts, checks)
    from scripts.build_data import scan_obj

    problems = scan_obj(payload, "financials")
    if problems:
        raise SystemExit("Financials payload failed the data check:\n" + "\n".join(problems[:20]))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload))
    return {"sites": len(payload["sites"]), "open": sum(1 for item in payload["sites"].values() if item.get("open"))}


def package_folder_id(lister, site_folder_id: str) -> str:
    """AE folder, then Source files, then 1 Financials. Missing means no link."""
    if not lister or not site_folder_id or site_folder_id in BLOCKED_FOLDER_IDS:
        return ""
    children = lister.list_children(site_folder_id)
    source = next((child for child in children if child.get("name") == SOURCE_FOLDER_NAME), None)
    search = lister.list_children(str(source.get("id") or "")) if source else children
    folder = next((child for child in search if child.get("name") == PACKAGE_FOLDER_NAME and not excluded_material(str(child.get("name") or ""))), None)
    if folder is None and source is not None:
        folder = next((child for child in children if child.get("name") == PACKAGE_FOLDER_NAME), None)
    found = str((folder or {}).get("id") or "")
    if not found or found in BLOCKED_FOLDER_IDS:
        return ""
    return found


def sensitive_files(lister, folder_id: str) -> list[dict]:
    """Payroll and tax files by name and link. File bytes are never read."""
    if not lister or not folder_id:
        return []
    found = []
    for child in lister.list_children(folder_id):
        name = str(child.get("name") or "")
        if excluded_material(name):
            continue
        if child.get("mimeType") == "application/vnd.google-apps.folder":
            continue
        if not sensitive_name(name):
            continue
        file_id = str(child.get("id") or "")
        href = f"https://drive.google.com/file/d/{file_id}/view" if file_id and file_id not in BLOCKED_FOLDER_IDS else ""
        found.append({"name": name, "href": href})
    return found


def refresh_package_links(workbook: Path | None, destination: Path) -> int:
    """Fill package links after a Drive listing. No listing means the links stay blank."""
    if workbook is None or not destination.exists():
        return 0
    import os

    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        return 0
    from scripts.timeline_drive import GoogleDriveLister, read_workbook_records

    try:
        lister = GoogleDriveLister(raw)
    except Exception:
        return 0
    payload = json.loads(destination.read_text())
    updated = 0
    for record in read_workbook_records(workbook):
        site_id = str(record.get("site_id") or "")
        current = (payload.get("sites") or {}).get(site_id)
        if not current or not current.get("open"):
            continue
        folder_id = package_folder_id(lister, str(record.get("folder_id") or ""))
        href = safe_drive_href(f"https://drive.google.com/drive/folders/{folder_id}") if folder_id else ""
        listed = sensitive_files(lister, folder_id) if folder_id else []
        if href:
            current["packageHref"] = href
            updated += 1
        if listed:
            current["listed"] = listed
    destination.write_text(json.dumps(payload))
    return updated
