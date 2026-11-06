"""Land measures and seller-stated figures for pipeline and land rows.

Columns are chosen by header name. Shipped keys stay neutral: a capacity
rating is site_capacity, and package figures are omitted rather than copied.
"""

from __future__ import annotations

import re
from datetime import date, datetime

# A broker package, a P&L, or a confidential file. Public listings stay.
_PACKAGE = re.compile(
    r"(?i)(\bp\s*&\s*ls?\b|\bp&ls?\b|\bpackages?\b|\bconfidential\b|\bnda\b|\bstatements\b|\btax returns?\b|\bsource files\b)"
)
_PUBLIC = (
    ("bizbuysell", "BizBuySell listing"),
    ("loopnet", "LoopNet listing"),
    ("crexi", "Crexi listing"),
    ("matthews", "Matthews"),
    ("realmo", "Realmo listing"),
    ("car wash brokers", "Car Wash Brokers"),
    ("citywide", "Citywide Commercial listing"),
)
_CAPACITY = {"strong": "Strong", "ok": "OK", "weak": "Weak", "unknown": "Unknown"}
_VERIFIED = re.compile(r"(?i)\b(?:appraisal|alta|survey)\b")
_ESTIMATED = re.compile(r"(?i)(?:imagery|aerial|satellite|rough|visual|assumes|±|\+/-)")
_UNKNOWN = re.compile(r"(?i)(?:no address|not yet|unknown|isn.t identified|not measured)")
_GONE = re.compile(r"(?i)delist|listing removed|not live|sold or withdrawn|withdrawn")

FIGURE_FIELDS = (
    "land_acres",
    "land_acres_basis",
    "open_land_sqft",
    "open_land_basis",
    "checked_live",
    "stated_revenue",
    "stated_revenue_display",
    "stated_cash_flow",
    "stated_cash_flow_display",
    "figures_source",
    "figures_basis",
    "figures_status",
    "site_capacity",
    "cap_a_substation_mi",
    "cap_a_line_ft",
    "cap_a_source",
    "cap_a_as_of",
    "cap_a_confidence",
    "cap_b_feeder",
    "cap_b_frontage",
    "cap_b_nearby",
    "cap_b_horizon",
    "cap_b_source",
    "cap_b_as_of",
    "cap_b_confidence",
    "cap_c_amps",
    "cap_c_volts",
    "cap_c_phase",
    "cap_c_panels",
    "cap_c_source",
    "cap_c_as_of",
    "cap_c_confidence",
    "cap_d_peak",
    "cap_d_year",
    "cap_d_source",
    "cap_d_as_of",
    "cap_d_confidence",
    "price_per_acre",
    "price_per_acre_display",
    "cash_multiple",
    "cash_multiple_display",
)


def _number(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number > 0 else None
    match = re.search(r"\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not match:
        return None
    number = float(match.group())
    return number if number > 0 else None


def money(value) -> str | None:
    if value is None:
        return None
    return f"${float(value):,.0f}"


def compact_money(value) -> str | None:
    if value is None:
        return None
    number = abs(float(value))
    if number >= 1_000_000:
        shown = number / 1_000_000
        text = f"{shown:.2f}"
        if text.endswith("00"):
            text = f"{shown:.0f}"
        elif text.endswith("0"):
            text = f"{shown:.1f}"
        return f"${text}M"
    if number >= 1_000:
        return f"${number / 1000:.0f}K"
    return money(number)


def land_basis(text: str, acres) -> str:
    if acres is None:
        return ""
    raw = (text or "").strip()
    if not raw or _UNKNOWN.search(raw):
        return "Unknown"
    if _VERIFIED.search(raw) and not _ESTIMATED.search(raw):
        return "Verified"
    return "Estimated"


def capacity_rating(value) -> str:
    return _CAPACITY.get(str(value or "").strip().lower(), "Unknown")


def _fact_text(value) -> str:
    """Keep a typed source or confidence only when the map wording filter allows it."""
    text = str(value or "").strip()
    if not text:
        return ""
    from scripts.build_data import _DISPLAY_TERMS, banned_hits

    if banned_hits(text) or _DISPLAY_TERMS.search(text):
        return ""
    return text


def _fact_number(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number else None
    match = re.fullmatch(r"\s*-?\d+(?:\.\d+)?\s*", str(value))
    if not match:
        return None
    return float(match.group())


def _fact_date(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool) and 20000 < float(value) < 80000:
        from datetime import timedelta

        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().isoformat()
    text = str(value).strip()
    match = re.match(r"(\d{4}-\d{2}-\d{2})", text)
    if match:
        return match.group(1)
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        number = float(text)
        if 20000 < number < 80000:
            from datetime import timedelta

            return (datetime(1899, 12, 30) + timedelta(days=number)).date().isoformat()
    return ""


def _store_number(value):
    number = _fact_number(value)
    if number is None:
        return None
    if number.is_integer():
        return int(number)
    return round(number, 4)


def capacity_fields(row: dict, *, service: bool) -> dict:
    """Typed fact layers. Blank cells stay absent. Free-text notes are not a source."""
    out = {}

    def put(key, value):
        if value is None or value == "":
            return
        out[key] = value

    put("cap_a_substation_mi", _store_number(row.get("pwr_a_substation_mi")))
    put("cap_a_line_ft", _store_number(row.get("pwr_a_hv_line_ft")))
    put("cap_a_source", _fact_text(row.get("pwr_a_source_type")))
    put("cap_a_as_of", _fact_date(row.get("pwr_a_as_of")))
    put("cap_a_confidence", _fact_text(row.get("pwr_a_confidence")))
    put("cap_b_feeder", _fact_text(row.get("pwr_b_feeder_id")))
    put("cap_b_frontage", _store_number(row.get("pwr_b_hosting_mw_frontage")))
    put("cap_b_nearby", _store_number(row.get("pwr_b_hosting_mw_nearby")))
    horizon = row.get("pwr_b_hosting_horizon")
    if isinstance(horizon, float) and horizon.is_integer():
        horizon = int(horizon)
    put("cap_b_horizon", _fact_text("" if horizon is None else str(horizon)))
    put("cap_b_source", _fact_text(row.get("pwr_b_source_type")))
    put("cap_b_as_of", _fact_date(row.get("pwr_b_as_of")))
    put("cap_b_confidence", _fact_text(row.get("pwr_b_confidence")))
    if not service:
        return out
    put("cap_c_amps", _store_number(row.get("pwr_c_service_amps")))
    put("cap_c_volts", _store_number(row.get("pwr_c_service_volts")))
    put("cap_c_phase", _fact_text(row.get("pwr_c_service_phase")))
    put("cap_c_panels", _store_number(row.get("pwr_c_panel_count")))
    put("cap_c_source", _fact_text(row.get("pwr_c_source_type")))
    put("cap_c_as_of", _fact_date(row.get("pwr_c_as_of")))
    put("cap_c_confidence", _fact_text(row.get("pwr_c_confidence")))
    put("cap_d_peak", _store_number(row.get("pwr_d_peak_kw")))
    put("cap_d_year", _store_number(row.get("pwr_d_kwh_year")))
    put("cap_d_source", _fact_text(row.get("pwr_d_source_type")))
    put("cap_d_as_of", _fact_date(row.get("pwr_d_as_of")))
    put("cap_d_confidence", _fact_text(row.get("pwr_d_confidence")))
    return out


def checked_live(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    match = re.match(r"(\d{4}-\d{2}-\d{2})", str(value).strip())
    return match.group(1) if match else ""


def package_source(text: str) -> bool:
    return bool(_PACKAGE.search(text or ""))


def public_source(text: str) -> str:
    raw = text or ""
    if package_source(raw):
        return ""
    lowered = raw.lower()
    for needle, label in _PUBLIC:
        if needle in lowered:
            return label
    return "Listing" if raw.strip() else ""


def _round_acres(value: float) -> float:
    return round(value, 2)


def listing_gone(status) -> bool:
    """True when the workbook says the listing is gone or no longer live."""
    return bool(_GONE.search(str(status or "")))


def key_figures(row: dict, kind: str) -> dict:
    """Fields safe to ship. Package figures are dropped, not blanked quietly."""
    acres = _number(row.get("Land (acres)"))
    basis = land_basis(str(row.get("Land basis") or ""), acres)
    spare = _number(row.get("Spare area (sq ft)"))
    asking = _number(row.get("Asking price ($)"))
    revenue = _number(row.get("Revenue ($ a year)"))
    cash = _number(row.get("EBITDA ($ a year)"))
    source_text = str(row.get("Source of the numbers") or "")
    business = str(row.get("Business check") or "")
    vacant = kind == "land" or bool(re.search(r"(?i)no business|land only", business))
    withheld = package_source(source_text) and (revenue is not None or cash is not None)
    if withheld:
        status = "withheld"
        revenue_out = cash_out = None
        figures_basis = ""
        figures_source = ""
    elif revenue is None and cash is None:
        status = "vacant" if vacant else "absent"
        revenue_out = cash_out = None
        figures_basis = ""
        figures_source = ""
    else:
        status = "shown"
        revenue_out = round(revenue, 2) if revenue is not None else None
        cash_out = round(cash, 2) if cash is not None else None
        figures_basis = "Claimed"
        figures_source = public_source(source_text)
    per_acre = round(asking / acres, 2) if asking and acres else None
    multiple = round(asking / cash_out, 1) if asking and cash_out else None
    multiple_text = None
    if multiple is not None:
        text = f"{multiple:.1f}"
        if text.endswith(".0"):
            text = text[:-2]
        multiple_text = f"{text}x cash flow"
    return {
        "land_acres": _round_acres(acres) if acres is not None else None,
        "land_acres_basis": basis,
        "open_land_sqft": int(round(spare)) if spare is not None else None,
        "open_land_basis": "Estimated" if spare is not None else "",
        "checked_live": checked_live(row.get("Last checked live")),
        "stated_revenue": revenue_out,
        "stated_revenue_display": money(revenue_out),
        "stated_cash_flow": cash_out,
        "stated_cash_flow_display": money(cash_out),
        "figures_source": figures_source,
        "figures_basis": figures_basis,
        "figures_status": status,
        "site_capacity": capacity_rating(row.get("Power rating")),
        **capacity_fields(row, service=True),
        "price_per_acre": per_acre,
        "price_per_acre_display": compact_money(per_acre),
        "cash_multiple": multiple,
        "cash_multiple_display": multiple_text,
    }


def coverage(features: list[dict]) -> dict:
    """Active means not dropped. Tracked includes dropped rows."""
    fields = {
        "land_acres": lambda props: props.get("land_acres") is not None,
        "open_land_sqft": lambda props: props.get("open_land_sqft") is not None,
        "checked_live": lambda props: bool(props.get("checked_live")),
        "stated_revenue": lambda props: props.get("stated_revenue") is not None,
        "stated_cash_flow": lambda props: props.get("stated_cash_flow") is not None,
        "price_per_acre": lambda props: props.get("price_per_acre") is not None,
        "cash_multiple": lambda props: props.get("cash_multiple") is not None,
        "site_capacity_rated": lambda props: props.get("site_capacity") not in (None, "", "Unknown"),
    }
    active = []
    tracked = []
    withheld = []
    for feature in features:
        props = feature.get("properties") or {}
        tracked.append(props)
        if props.get("stage_group") != "dropped":
            active.append(props)
        if props.get("figures_status") == "withheld":
            withheld.append(
                {
                    "deal_id": props.get("deal_id"),
                    "name": props.get("name"),
                    "note": "Package figures not shown",
                }
            )
    counts = {}
    for name, test in fields.items():
        counts[name] = {
            "active": sum(1 for props in active if test(props)),
            "active_total": len(active),
            "tracked": sum(1 for props in tracked if test(props)),
            "tracked_total": len(tracked),
        }
    return {"counts": counts, "withheld": withheld}
