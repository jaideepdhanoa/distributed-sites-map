"""Key-number extraction, package exclusion, and the McNab geocode query."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import geocode_queries, scan_obj
from scripts.key_numbers import coverage, key_figures


def _row(**extra):
    base = {
        "Land (acres)": 3.98,
        "Land basis": "County parcel and imagery; spare area assumes about 60% usable",
        "Spare area (sq ft)": 104100,
        "Asking price ($)": 2200000,
        "Revenue ($ a year)": None,
        "EBITDA ($ a year)": None,
        "Source of the numbers": "LoopNet listing, checked Oct 30, 2026",
        "Last checked live": "2026-10-30",
        "Power rating": "Unknown",
        "Business check": "Land only (no business)",
    }
    base.update(extra)
    return base


class KeyFiguresTest(unittest.TestCase):
    def test_land_row_is_estimated_and_vacant(self) -> None:
        figures = key_figures(_row(), "land")
        self.assertEqual(figures["land_acres"], 3.98)
        self.assertEqual(figures["land_acres_basis"], "Estimated")
        self.assertEqual(figures["open_land_sqft"], 104100)
        self.assertEqual(figures["open_land_basis"], "Estimated")
        self.assertEqual(figures["price_per_acre_display"], "$553K")
        self.assertEqual(figures["figures_status"], "vacant")
        self.assertIsNone(figures["stated_cash_flow"])
        self.assertEqual(figures["site_capacity"], "Unknown")
        self.assertEqual(figures["checked_live"], "2026-10-30")

    def test_unknown_acres_when_the_basis_is_blank(self) -> None:
        figures = key_figures(_row(**{"Land basis": None, "Land (acres)": 1.08}), "pipeline")
        self.assertEqual(figures["land_acres_basis"], "Unknown")

    def test_verified_when_a_survey_is_the_only_basis(self) -> None:
        figures = key_figures(_row(**{"Land basis": "ALTA survey"}), "land")
        self.assertEqual(figures["land_acres_basis"], "Verified")

    def test_seller_stated_cash_flow_is_claimed(self) -> None:
        figures = key_figures(
            _row(
                **{
                    "Business check": "Operating, address confirmed",
                    "Revenue ($ a year)": 1200000,
                    "EBITDA ($ a year)": 400000,
                    "Asking price ($)": 2480000,
                    "Source of the numbers": "BizBuySell listing (seller's cash flow used as EBITDA)",
                    "Power rating": "Strong",
                }
            ),
            "pipeline",
        )
        self.assertEqual(figures["figures_status"], "shown")
        self.assertEqual(figures["figures_basis"], "Claimed")
        self.assertEqual(figures["figures_source"], "BizBuySell listing")
        self.assertEqual(figures["stated_cash_flow"], 400000)
        self.assertEqual(figures["cash_multiple_display"], "6.2x cash flow")
        self.assertEqual(figures["site_capacity"], "Strong")
        self.assertNotIn("ebitda", json.dumps(figures).lower())

    def test_package_figures_are_omitted(self) -> None:
        figures = key_figures(
            _row(
                **{
                    "Business check": "",
                    "Land (acres)": 1.08,
                    "Land basis": None,
                    "Spare area (sq ft)": None,
                    "Revenue ($ a year)": 900000,
                    "EBITDA ($ a year)": 320000,
                    "Asking price ($)": 3000000,
                    "Source of the numbers": "Matthews P&L statements in the site folder",
                    "Power rating": None,
                }
            ),
            "pipeline",
        )
        self.assertEqual(figures["figures_status"], "withheld")
        self.assertIsNone(figures["stated_revenue"])
        self.assertIsNone(figures["stated_cash_flow"])
        self.assertIsNone(figures["cash_multiple"])
        self.assertEqual(figures["figures_source"], "")
        self.assertEqual(figures["land_acres"], 1.08)
        self.assertIsNone(figures["open_land_sqft"])
        blob = json.dumps(figures)
        self.assertNotIn("900000", blob)
        self.assertNotIn("320000", blob)
        problems = scan_obj(figures, "figures")
        self.assertEqual(problems, [])

    def test_coverage_counts_active_and_tracked(self) -> None:
        shown = {"type": "Feature", "properties": {**key_figures(_row(**{"EBITDA ($ a year)": 100, "Business check": ""}), "pipeline"), "stage_group": "desk", "deal_id": "PIPE-1", "name": "Shown"}}
        withheld = {
            "type": "Feature",
            "properties": {
                **key_figures(_row(**{"Source of the numbers": "broker package P&L", "EBITDA ($ a year)": 50, "Business check": ""}), "pipeline"),
                "stage_group": "dropped",
                "deal_id": "PIPE-2",
                "name": "Held",
            },
        }
        report = coverage([shown, withheld])
        self.assertEqual(report["counts"]["stated_cash_flow"]["active"], 1)
        self.assertEqual(report["counts"]["stated_cash_flow"]["tracked"], 1)
        self.assertEqual(report["withheld"], [{"deal_id": "PIPE-2", "name": "Held", "note": "Package figures not shown"}])

    def test_mcnab_query_drops_the_wrong_city(self) -> None:
        self.assertEqual(
            geocode_queries("7520 W McNab Rd, Miami, FL"),
            ["7520 W McNab Rd, Miami, FL", "7520 W McNab Rd, FL"],
        )


if __name__ == "__main__":
    unittest.main()
