"""Build data/pricing/sources.json from a workbook read.

Each caller-chosen range is CSV. The first row is that range's header, and
every later row is data. Columns are read by header name, so an inserted
column inside the range does not move a figure onto its neighbor. A blank
cell stays blank. The Google sheet stays read-only. This file keeps figures,
claims, and listing status, and it drops source file links.

Land ranges, in order: the site columns (Site, Name, Market, Segment,
Land (acres), Asking price ($)); Listing status, Listing link, and Last
checked live; Inside the service area; Site ID.

Pipeline ranges, in order: the site columns (Site, Market, Segment, Stage,
Land (acres), Asking price ($), Revenue ($ a year), EBITDA ($ a year));
two unused ranges; County value ($) and Value basis; one unused range;
Financials status; Site ID; then Claimed cash-flow label, Claimed cash flow
($ a year), and Normalized EBITDA ($ a year).

Register ranges, in order: listing_id, flow, market, ref, address, price,
lot_ac, and url; then ko_reason and listing_status. Only rows whose flow
is Land are kept.
"""

from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def rows(content: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(content)))


def _headers(row: list[str]) -> dict[str, int]:
    found: dict[str, int] = {}
    for index, name in enumerate(row):
        key = str(name or "").strip().lower()
        if key and key not in found:
            found[key] = index
    return found


def _split(table: list[list[str]]) -> tuple[dict[str, int], list[list[str]]]:
    if not table:
        return {}, []
    return _headers(table[0]), table[1:]


def _cell(row: list[str], headers: dict[str, int], name: str) -> str:
    """The named cell, including a blank. A missing header is blank too."""
    index = headers.get(name.strip().lower())
    if index is None or index >= len(row):
        return ""
    return row[index]


def _join(parts: list[str]) -> str:
    return " ".join(part for part in parts if part)


def build_sources(
    land: list[list[list[str]]],
    pipe: list[list[list[str]]],
    reg: list[list[list[str]]],
    fact_lines: list[str],
) -> dict:
    if len(land) < 4 or len(pipe) < 8 or len(reg) < 2:
        raise SystemExit("Pricing ranges are incomplete.")
    lm_h, lm = _split(land[0])
    ls_h, ls = _split(land[1])
    la_h, la = _split(land[2])
    lid_h, lid = _split(land[3])
    main_h, main = _split(pipe[0])
    county_h, county = _split(pipe[3])
    basis_h, basis = _split(pipe[5])
    ids_h, ids = _split(pipe[6])
    flow_h, flow = _split(pipe[7])
    rm_h, rm = _split(reg[0])
    rs_h, rs = _split(reg[1])

    def at(table: list[list[str]], index: int) -> list[str]:
        if index < 0 or index >= len(table):
            return []
        return table[index]

    out = {
        "asOf": "2026-11-14",
        "workbook": "167rIKoApP3sMJ3vrp1lg3MT-h5yQGqmMhY_TbBIqByY",
        "land": [],
        "register": [],
        "sites": [],
        "facts": [],
    }
    for index, row in enumerate(lm):
        status = at(ls, index)
        out["land"].append({
            "id": _cell(at(lid, index), lid_h, "Site ID"),
            "market": _cell(row, lm_h, "Market"),
            "segment": _cell(row, lm_h, "Segment"),
            "acres": _cell(row, lm_h, "Land (acres)"),
            "price": _cell(row, lm_h, "Asking price ($)"),
            "status": _cell(status, ls_h, "Listing status"),
            "checked": _cell(status, ls_h, "Last checked live"),
            "area": _cell(at(la, index), la_h, "Inside the service area"),
            "link": _cell(status, ls_h, "Listing link"),
            "address": _join([_cell(row, lm_h, "Site"), _cell(row, lm_h, "Name")]),
        })
    for index, row in enumerate(rm):
        if _cell(row, rm_h, "flow") != "Land":
            continue
        status = at(rs, index)
        out["register"].append({
            "id": _cell(row, rm_h, "listing_id"),
            "market": _cell(row, rm_h, "market"),
            "address": _join([_cell(row, rm_h, "address"), _cell(row, rm_h, "ref")]),
            "acres": _cell(row, rm_h, "lot_ac"),
            "price": _cell(row, rm_h, "price"),
            "status": _cell(status, rs_h, "listing_status"),
            "ko": _cell(status, rs_h, "ko_reason"),
            "link": _cell(row, rm_h, "url"),
        })
    for index, row in enumerate(main):
        if not _cell(row, main_h, "Site"):
            continue
        claimed = at(flow, index)
        county_row = at(county, index)
        out["sites"].append({
            "id": _cell(at(ids, index), ids_h, "Site ID"),
            "market": _cell(row, main_h, "Market"),
            "segment": _cell(row, main_h, "Segment"),
            "stage": _cell(row, main_h, "Stage"),
            "acres": _cell(row, main_h, "Land (acres)"),
            "asking": _cell(row, main_h, "Asking price ($)"),
            "revenue": _cell(row, main_h, "Revenue ($ a year)"),
            "ebitda": _cell(row, main_h, "EBITDA ($ a year)"),
            "label": _cell(claimed, flow_h, "Claimed cash-flow label"),
            "claimed": _cell(claimed, flow_h, "Claimed cash flow ($ a year)"),
            "normalized": _cell(claimed, flow_h, "Normalized EBITDA ($ a year)"),
            "financialsStatus": _cell(at(basis, index), basis_h, "Financials status"),
            "countyValue": _cell(county_row, county_h, "County value ($)"),
            "countyBasis": _cell(county_row, county_h, "Value basis"),
        })
    for line in fact_lines:
        if not line.strip():
            continue
        site, figure, period, value, claim = line.split("\t")
        out["facts"].append({"id": site, "figure": figure, "period": period, "value": value, "claim": claim})
    return out


def main() -> None:
    land_path, pipe_path, reg_path, facts_path = map(Path, sys.argv[1:5])
    land = json.loads(land_path.read_text())["ranges"]
    pipe = json.loads(pipe_path.read_text())["ranges"]
    reg = json.loads(reg_path.read_text())["ranges"]
    out = build_sources(
        [rows(item["content"]) for item in land],
        [rows(item["content"]) for item in pipe],
        [rows(item["content"]) for item in reg],
        facts_path.read_text().splitlines(),
    )
    dest = ROOT / "data" / "pricing" / "sources.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2) + "\n")
    print(f"land {len(out['land'])} register {len(out['register'])} sites {len(out['sites'])} facts {len(out['facts'])}")


if __name__ == "__main__":
    main()
