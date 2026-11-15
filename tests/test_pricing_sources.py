"""Pricing source rows follow header names inside each caller-chosen range."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.extract_pricing_sources import build_sources


def _shift(table: list[list[str]]) -> list[list[str]]:
    """Insert two columns after the first, the way a sheet insert shifts a range."""
    shifted = []
    for row in table:
        shifted.append([row[0], "DECOY-A", "DECOY-B", *row[1:]])
    return shifted


class PricingHeaderTest(unittest.TestCase):
    def test_inserted_columns_and_a_blank_cell_stay_on_the_header(self) -> None:
        land_main = _shift([
            ["Site", "Name", "Market", "Segment", "Stage", "Broker", "Land (acres)", "Asking price ($)"],
            ["LAS 2436 E Cheyenne Ave", "Wash N Go", "LAS", "Car wash: express tunnel", "1 Desk screen", "", "0.42", "1550000"],
            ["PHX 4405 N 7th Ave", "Former station", "PHX", "Gas station", "", "", "0.28", ""],
        ])
        land_status = _shift([
            ["Listing status", "Listing link", "Last checked live"],
            ["Listed", "https://www.loopnet.com/example", "Nov 10"],
            ["Listed", "", ""],
        ])
        land_area = _shift([
            ["Inside the service area"],
            ["Yes"],
            ["No"],
        ])
        land_ids = _shift([
            ["Site ID"],
            ["LAND-LAS-0001"],
            ["LAND-PHX-0002"],
        ])
        pipe_main = _shift([
            ["Site", "Name", "Market", "Segment", "Stage", "Broker", "Land (acres)", "Asking price ($)", "Revenue ($ a year)", "EBITDA ($ a year)"],
            ["PHX 1523 E Southern Ave", "Sample tunnel", "PHX", "Car wash: express tunnel", "1 Desk screen", "", "1.17", "1600000", "337000", "-121000"],
            ["", "Skipped", "PHX", "Car wash: express tunnel", "", "", "", "", "", ""],
        ])
        unused = [["Unused"], ["x"]]
        county = _shift([
            ["County value ($)", "Value basis"],
            ["2236814", "Maricopa County Assessor full cash value"],
            ["", ""],
        ])
        basis = _shift([
            ["Financials status"],
            ["Documented"],
            ["Unknown"],
        ])
        ids = _shift([
            ["Site ID"],
            ["PIPE-PHX-0001"],
            ["PIPE-PHX-0099"],
        ])
        flow = _shift([
            ["Claimed cash-flow label", "Claimed cash flow ($ a year)", "Years operating", "Package status", "Normalized EBITDA ($ a year)"],
            ["EBITDA", "-121000", "12", "Received", ""],
            ["", "", "", "", ""],
        ])
        register = _shift([
            ["listing_id", "flow", "market", "ref", "address", "apn", "price", "lot_ac", "url"],
            ["L-137", "Land", "LAS", "LAS 2436 E Cheyenne Ave", "2436 E Cheyenne Ave", "", "1550000", "0.42", ""],
            ["L-001", "Listing", "PHX", "skip me", "skip me", "", "1", "1", ""],
        ])
        register_status = _shift([
            ["funnel_stage", "ko_reason", "listing_status"],
            ["", "", "Listed"],
            ["", "KO — location", "Knocked out"],
        ])
        out = build_sources(
            [land_main, land_status, land_area, land_ids],
            [pipe_main, unused, unused, county, unused, basis, ids, flow],
            [register, register_status],
            ["PIPE-PHX-0001\tEBITDA\tLatest\t-121000\tDocumented"],
        )
        first, blank_price = out["land"]
        self.assertEqual(first["id"], "LAND-LAS-0001")
        self.assertEqual(first["market"], "LAS")
        self.assertEqual(first["segment"], "Car wash: express tunnel")
        self.assertEqual(first["acres"], "0.42")
        self.assertEqual(first["price"], "1550000")
        self.assertEqual(first["status"], "Listed")
        self.assertEqual(first["checked"], "Nov 10")
        self.assertEqual(first["area"], "Yes")
        self.assertEqual(first["link"], "https://www.loopnet.com/example")
        self.assertEqual(first["address"], "LAS 2436 E Cheyenne Ave Wash N Go")
        self.assertNotIn("DECOY", first["market"])
        self.assertEqual(blank_price["price"], "")
        self.assertEqual(blank_price["id"], "LAND-PHX-0002")
        self.assertEqual(len(out["register"]), 1)
        self.assertEqual(out["register"][0]["id"], "L-137")
        self.assertEqual(out["register"][0]["market"], "LAS")
        self.assertEqual(out["register"][0]["address"], "2436 E Cheyenne Ave LAS 2436 E Cheyenne Ave")
        self.assertEqual(out["register"][0]["status"], "Listed")
        self.assertEqual(out["register"][0]["ko"], "")
        site = out["sites"][0]
        self.assertEqual([item["id"] for item in out["sites"]], ["PIPE-PHX-0001"])
        self.assertEqual(site["market"], "PHX")
        self.assertEqual(site["asking"], "1600000")
        self.assertEqual(site["revenue"], "337000")
        self.assertEqual(site["ebitda"], "-121000")
        self.assertEqual(site["label"], "EBITDA")
        self.assertEqual(site["claimed"], "-121000")
        self.assertEqual(site["normalized"], "")
        self.assertEqual(site["financialsStatus"], "Documented")
        self.assertEqual(site["countyValue"], "2236814")
        self.assertNotEqual(site["label"], "DECOY-A")
        self.assertEqual(out["facts"], [{
            "id": "PIPE-PHX-0001",
            "figure": "EBITDA",
            "period": "Latest",
            "value": "-121000",
            "claim": "Documented",
        }])


if __name__ == "__main__":
    unittest.main()
