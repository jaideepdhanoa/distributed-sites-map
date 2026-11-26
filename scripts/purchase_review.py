"""Extract the acquisition model from the private workbook export by column name."""
import json
import math
import re
from datetime import date, datetime

FIELDS = {
    "ask": "Asking price ($)", "revenue": "Revenue ($ a year)", "ebitda": "EBITDA ($ a year)",
    "normalized": "Normalized EBITDA ($ a year)", "cash": "Cash from the business ($ a year)",
    "charge": "Financing cost at asking price ($ a year)", "allowance": "Land cost a site can carry at the target ($ a year)",
    "ceiling": "Most Moove can pay ($)", "landCap": "Market value of the land ($)",
    "walkAway": "Walk-away price ($)", "required": "EBITDA needed at asking price ($ a year)",
    "networkCost": "Network of sites like this, free land ($, 10 years)",
    "stalls": "Stalls on site (from Stalls that fit)", "fit": "Stalls that fit",
    "cars": "Cars (latest year)", "priorCars": "Cars (prior year)", "priorRevenue": "Revenue (prior year)",
    "memberShare": "Membership share of revenue", "claim": "Claimed cash flow ($ a year)",
    "screeningPrice": "Screening price ($)",
}
ASSUMPTIONS = {
    "closing": "Closing and transaction costs (% of price)", "upkeep": "Upkeep spending (% of revenue)",
    "oversight": "Moove's cost to oversee the business ($ a year)", "capital": "Cost of capital for owned sites, flat (%)",
    "margin": "EBITDA margin used when a site's revenue is unknown (%)", "target": "Target saving vs. hub per charge (%)",
    "lower": "Lower saving to show alongside the target (%)", "hub": "Hub cost over 10 years, with letter of credit ($)",
    "horizon": "Analysis horizon (years)", "demand": "Stalls of charging demand to match the hub",
    "defaultStalls": "Default stalls: business plus spare land", "sharedStalls": "Default stalls: shared site",
}
def number(v):
    if isinstance(v, bool) or v is None: return None
    if isinstance(v, str) and not re.fullmatch(r"-?\d+(?:\.\d+)?", v.strip()): return None
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None

def write_purchase_review(book, sites, destination, facts):
    import openpyxl
    wb = openpyxl.load_workbook(book, read_only=True, data_only=True)
    try:
        assumptions = {str(r[0]).strip(): number(r[1]) for r in wb["Assumptions"].iter_rows(max_col=2, values_only=True)} if "Assumptions" in wb else {}
    finally:
        wb.close()
    from scripts.financials import PROTECTED_SITE_IDS
    rows = {}
    for site, kind, row in sites:
        if kind != "pipeline" or site in PROTECTED_SITE_IDS: continue
        amounts = {k: number(row.get(label)) for k, label in FIELDS.items()}
        checked = row.get("Financials checked")
        if isinstance(checked, (date, datetime)): checked = checked.isoformat()[:10]
        text = lambda key: str(row.get(key) or "").strip()[:80]
        # Preserve source identity and period only on an exact amount and measure match.
        periods = {}
        for key, metric in [("normalized", "normalized ebitda"), ("ebitda", "ebitda"), ("revenue", "revenue")]:
            matches = [f for f in facts.get(site, []) if str(f.get("Figure") or "").lower() == metric and
                       number(f.get("Value")) is not None and amounts[key] is not None and abs(number(f["Value"]) - amounts[key]) < 1]
            if len(matches) == 1:
                periods[key] = str(matches[0].get("Period") or "")[:80]
        rows[site] = {**amounts, "periods": periods, "claimLabel": text("Claimed cash-flow label"), "status": text("Financials status"),
            "package": text("Package status"), "open": text("Business stays open"), "archetype": text("Archetype"),
            "ownership": text("Real estate in the sale"), "checked": checked if isinstance(checked,str) and re.fullmatch(r"\d{4}-\d\d-\d\d",checked) else "",
            "textInputs": [k for k, label in FIELDS.items() if amounts[k] is not None and isinstance(row.get(label), str)]}
    destination.write_text(json.dumps({"version":1,"assumptions":{k:assumptions.get(label) for k,label in ASSUMPTIONS.items()},"sites":rows},separators=(",",":")))
