"""Land measures and seller-stated figures for pipeline and land rows.

Columns are chosen by header name. Shipped keys stay neutral: a capacity
rating is site_capacity. Package file names stay off the card. The revenue
and cash-flow figures themselves ship for every signed-in reader.
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
    "cash_flow_label",
    "package_status",
    "bays_that_fit",
    "trade_aadt",
    "trade_aadt_road",
    "trade_aadt_m",
    "trade_aadt_max",
    "trade_population",
    "trade_growth",
    "trade_income",
    "trade_washes_1mi",
    "trade_washes_3mi",
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
    "claim_word",
    "package_line",
    "financials_open",
    "access_notes",
    "score",
    "location_points",
)


def _number(value, *, allow_zero: bool = False, allow_negative: bool = False):
    """Read a measure. Zero stays empty unless this is a finished spare-area check."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
        if not match:
            return None
        number = float(match.group())
    if number > 0 or (allow_zero and number == 0) or (allow_negative and number < 0):
        return number
    return None


def money(value) -> str | None:
    if value is None:
        return None
    number = float(value)
    sign = "-" if number < 0 else ""
    return f"{sign}${abs(number):,.0f}"


def compact_money(value) -> str | None:
    if value is None:
        return None
    number = abs(float(value))
    sign = "-" if float(value) < 0 else ""
    if number >= 1_000_000:
        shown = number / 1_000_000
        text = f"{shown:.2f}"
        if text.endswith("00"):
            text = f"{shown:.0f}"
        elif text.endswith("0"):
            text = f"{shown:.1f}"
        return f"{sign}${text}M"
    if number >= 1_000:
        return f"{sign}${number / 1000:.0f}K"
    return money(value)


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


_SCRIPT_SOURCE = re.compile(r"(?i)(?:\.(?:py|js|mjs|ts|tsx|json|csv|xlsx|xls)\b|[/\\]|diligence_sweep|(?:^|[\s_])sweep(?:\.py)?\b)")
_SHEET_ERROR = re.compile(r"(?i)#(?:REF|N/A|VALUE|DIV/0|NAME|NULL|NUM|ERROR)!?")


def _fact_text(value) -> str:
    """Keep a typed source or confidence. Script names and sheet errors stay off the card."""
    text = str(value or "").strip()
    if not text or _SHEET_ERROR.search(text) or _SCRIPT_SOURCE.search(text):
        return ""
    return text


def _access_note(value) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text or _SHEET_ERROR.search(text) or _SCRIPT_SOURCE.search(text):
        return ""
    return text[:500]


def _score(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number != number:
            return None
        return int(number) if number.is_integer() else round(number, 2)
    text = str(value).strip()
    if not text or _SHEET_ERROR.search(text):
        return None
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", text):
        return None
    number = float(text)
    return int(number) if number.is_integer() else round(number, 2)


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


def cash_flow_label(value) -> str:
    """Workbook cash-flow label. Long notes and file names stay off the card."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return ""
    key = text.lower().replace("’", "'")
    labels = {
        "ebitda": "EBITDA",
        "normalized ebitda": "Normalized EBITDA",
        "seller's cash flow": "Seller's cash flow",
        "sellers cash flow": "Seller's cash flow",
    }
    if key in labels:
        return labels[key]
    if "normalized" in key and "ebitda" in key:
        return "Normalized EBITDA"
    if key == "ebitda":
        return "EBITDA"
    if len(text) > 40:
        return ""
    return text


def package_status_label(value) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    if "refus" in text or "unavailable" in text:
        return "Refused or unavailable"
    if "partial" in text and "request" in text:
        return "Partial, more requested"
    if "partial" in text:
        return "partial"
    return {"received": "Received", "none": "None", "requested": "Requested"}.get(text, "")


def financials_basis(value) -> str:
    return {"documented": "Documented", "verified": "Verified", "claimed": "Claimed", "unknown": "Unknown"}.get(
        str(value or "").strip().lower(), ""
    )


def claim_word(basis: str, normalized) -> str:
    """BE Claimed reads as Broker-stated. A filled normalized figure reads as Normalized."""
    if normalized is not None:
        return "Normalized"
    return {"Claimed": "Broker-stated", "Documented": "Documented", "Verified": "Verified"}.get(basis or "", "")


def package_line(status: str, asked_on: str = "") -> str:
    """Headline package line. Empty means the card shows nothing for the package."""
    text = (status or "").strip().lower()
    if not text or text == "none" or "refus" in text:
        return ""
    if "partial" in text:
        return "Partial package"
    if text == "received":
        return "Package on file"
    if "requested" in text:
        day = (asked_on or "").strip()
        return f"Package asked for ({day})" if day else "Package asked for"
    return ""


def financials_open(kind: str, business: str, status: str) -> bool:
    """Land, no business, and Not needed stay off the cash-flow tile and the panel."""
    if kind == "land":
        return False
    if re.search(r"(?i)no business|land only", business or ""):
        return False
    if re.search(r"(?i)not needed", str(status or "")):
        return False
    return True


def _whole(value, *, allow_zero: bool = False, allow_negative: bool = False):
    number = _number(value, allow_zero=allow_zero, allow_negative=allow_negative)
    if number is None:
        return None
    if float(number).is_integer():
        return int(number)
    return number


def _road_name(value) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return ""
    return text[:80]


def key_figures(row: dict, kind: str) -> dict:
    """Fields safe to ship. Package file names stay off the card; claimed cash flow is labeled."""
    acres = _number(row.get("Land (acres)"))
    basis = land_basis(str(row.get("Land basis") or ""), acres)
    # A completed aerial can record 0 sq ft. Asking and acres still treat 0 as empty.
    spare = _number(row.get("Spare area (sq ft)"), allow_zero=True)
    asking = _number(row.get("Asking price ($)"))
    revenue = _number(row.get("Revenue ($ a year)"))
    label = cash_flow_label(row.get("Claimed cash-flow label"))
    claimed = _number(row.get("Claimed cash flow ($ a year)"), allow_negative=True)
    normalized = _number(row.get("Normalized EBITDA ($ a year)"), allow_negative=True)
    legacy = _number(row.get("EBITDA ($ a year)"), allow_negative=True)
    if label == "Normalized EBITDA" and normalized is not None:
        cash = normalized
    elif claimed is not None:
        cash = claimed
    else:
        cash = legacy
        if cash is not None and not label:
            label = "EBITDA"
    source_text = str(row.get("Source of the numbers") or "")
    business = str(row.get("Business check") or "")
    vacant = kind == "land" or bool(re.search(r"(?i)no business|land only", business))
    packaged = package_source(source_text)
    recorded_basis = financials_basis(row.get("Financials status"))
    package_state = package_status_label(row.get("Package status"))
    revenue_out = round(revenue, 2) if revenue is not None else None
    cash_out = round(cash, 2) if cash is not None else None
    if cash_out is None and revenue_out is None:
        status = "vacant" if vacant else "absent"
        figures_basis = recorded_basis
        figures_source = ""
    else:
        status = "shown"
        if packaged:
            # The figure ships. The package file name does not.
            figures_basis = recorded_basis
            figures_source = ""
        else:
            figures_basis = recorded_basis or "Claimed"
            figures_source = public_source(source_text)
    per_acre = round(asking / acres, 2) if asking and acres else None
    multiple = round(asking / cash_out, 1) if asking and cash_out and cash_out > 0 else None
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
        "cash_flow_label": label if cash_out is not None else "",
        "package_status": package_state,
        "claim_word": claim_word(figures_basis, normalized),
        "package_line": package_line(package_state),
        "financials_open": financials_open(kind, business, str(row.get("Financials status") or "")),
        "bays_that_fit": _whole(row.get("Stalls that fit"), allow_zero=True),
        "trade_aadt": _whole(row.get("AADT (nearest)"), allow_zero=True),
        "trade_aadt_road": _road_name(row.get("AADT road")),
        "trade_aadt_m": _whole(row.get("AADT segment distance (m)"), allow_zero=True),
        "trade_aadt_max": _whole(row.get("AADT max within 800 m"), allow_zero=True),
        "trade_population": _whole(row.get("Population within 3 miles"), allow_zero=True),
        "trade_growth": _number(row.get("Population growth (3-mile)"), allow_zero=True, allow_negative=True),
        "trade_income": _whole(row.get("Median household income (3-mile)"), allow_zero=True),
        "trade_washes_1mi": _whole(row.get("Washes within 1 mile"), allow_zero=True),
        "trade_washes_3mi": _whole(row.get("Washes within 3 miles"), allow_zero=True),
        "site_capacity": capacity_rating(row.get("Power rating")),
        **capacity_fields(row, service=True),
        "price_per_acre": per_acre,
        "price_per_acre_display": compact_money(per_acre),
        "cash_multiple": multiple,
        "cash_multiple_display": multiple_text,
        "access_notes": _access_note(row.get("Access and visibility notes")),
        # Copied from the workbook. The service-area class does not recompute either number.
        "score": _score(row.get("Score (of 100)")),
        "location_points": _score(row.get("Location points")),
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
