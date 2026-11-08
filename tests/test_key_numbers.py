"""Key-number extraction, package exclusion, and the McNab geocode query."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import deal_place_label, distinct_pipeline_names, geocode_queries, listing_url_from_row, row_is_data, scan_obj
from scripts.key_numbers import capacity_fields, coverage, key_figures, listing_gone


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
        self.assertFalse(figures["financials_open"])
        self.assertEqual(figures["package_line"], "")
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
        self.assertEqual(figures["claim_word"], "Broker-stated")
        self.assertEqual(figures["package_line"], "")
        self.assertTrue(figures["financials_open"])
        self.assertEqual(figures["figures_source"], "BizBuySell listing")
        self.assertEqual(figures["stated_cash_flow"], 400000)
        self.assertEqual(figures["cash_flow_label"], "EBITDA")
        self.assertEqual(figures["cash_multiple_display"], "6.2x cash flow")
        self.assertEqual(figures["site_capacity"], "Strong")
        self.assertNotIn("ebitda", (figures["figures_source"] or "").lower())

    def test_package_cash_flow_is_labeled(self) -> None:
        figures = key_figures(
            _row(
                **{
                    "Business check": "",
                    "Land (acres)": 1.08,
                    "Land basis": None,
                    "Spare area (sq ft)": None,
                    "Revenue ($ a year)": 900000,
                    "EBITDA ($ a year)": -121000,
                    "Claimed cash-flow label": "EBITDA",
                    "Claimed cash flow ($ a year)": -121000,
                    "Package status": "Received",
                    "Financials status": "Documented",
                    "Asking price ($)": 3000000,
                    "Source of the numbers": "Matthews P&L statements in the site folder",
                    "Stalls that fit": 0,
                    "AADT (nearest)": 840,
                    "AADT road": "07  SOUTHERN AVE",
                    "AADT segment distance (m)": 58,
                    "AADT max within 800 m": 27012,
                    "Population within 3 miles": 95070,
                    "Population growth (3-mile)": -0.0557,
                    "Median household income (3-mile)": 78843,
                    "Washes within 1 mile": 1,
                    "Washes within 3 miles": 6,
                    "Power rating": None,
                }
            ),
            "pipeline",
        )
        self.assertEqual(figures["figures_status"], "shown")
        self.assertIsNone(figures["stated_revenue"])
        self.assertEqual(figures["stated_cash_flow"], -121000)
        self.assertEqual(figures["stated_cash_flow_display"], "-$121,000")
        self.assertEqual(figures["cash_flow_label"], "EBITDA")
        self.assertEqual(figures["package_status"], "Received")
        self.assertEqual(figures["claim_word"], "Documented")
        self.assertEqual(figures["package_line"], "Package on file")
        self.assertTrue(figures["financials_open"])
        self.assertEqual(figures["figures_basis"], "Documented")
        self.assertIsNone(figures["cash_multiple"])
        self.assertEqual(figures["figures_source"], "")
        self.assertEqual(figures["bays_that_fit"], 0)
        self.assertEqual(figures["trade_aadt"], 840)
        self.assertEqual(figures["trade_washes_1mi"], 1)
        self.assertEqual(figures["land_acres"], 1.08)
        blob = json.dumps(figures).lower()
        self.assertNotIn("matthews", blob)
        self.assertNotIn("folder", blob)
        self.assertNotIn("900000", blob)
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
        self.assertEqual(report["counts"]["stated_cash_flow"]["tracked"], 2)
        self.assertEqual(report["withheld"], [])

    def test_measured_zero_spare_area_is_open_land(self) -> None:
        for raw in (0, 0.0, "0", "0.0", "0 "):
            figures = key_figures(_row(**{"Spare area (sq ft)": raw}), "pipeline")
            self.assertEqual(figures["open_land_sqft"], 0)
            self.assertIsNotNone(figures["open_land_sqft"])
            self.assertEqual(figures["open_land_basis"], "Estimated")

    def test_blank_spare_area_stays_unmeasured(self) -> None:
        for raw in (None, "", " ", "not measured"):
            figures = key_figures(_row(**{"Spare area (sq ft)": raw}), "pipeline")
            self.assertIsNone(figures["open_land_sqft"])
            self.assertEqual(figures["open_land_basis"], "")

    def test_zero_stays_empty_for_other_key_figures(self) -> None:
        figures = key_figures(
            _row(
                **{
                    "Land (acres)": 0,
                    "Asking price ($)": "0",
                    "Revenue ($ a year)": 0,
                    "EBITDA ($ a year)": 0.0,
                    "Spare area (sq ft)": 0,
                    "Business check": "Operating, address confirmed",
                }
            ),
            "pipeline",
        )
        self.assertIsNone(figures["land_acres"])
        self.assertEqual(figures["land_acres_basis"], "")
        self.assertIsNone(figures["stated_revenue"])
        self.assertIsNone(figures["stated_cash_flow"])
        self.assertIsNone(figures["price_per_acre"])
        self.assertIsNone(figures["cash_multiple"])
        self.assertEqual(figures["open_land_sqft"], 0)
        self.assertIsNone(figures["stated_revenue_display"])
        self.assertIsNone(figures["stated_cash_flow_display"])

    def test_listing_gone_matches_withdrawn_status(self) -> None:
        self.assertTrue(listing_gone("Sold or withdrawn"))
        self.assertTrue(listing_gone("Delisted"))
        self.assertFalse(listing_gone("Listed"))
        self.assertFalse(listing_gone(""))

    def test_typed_facts_keep_values_and_drop_blocked_source_text(self) -> None:
        fields = capacity_fields(
            {
                "pwr_a_substation_mi": 0.81,
                "pwr_a_hv_line_ft": 392,
                "pwr_a_source_type": "OSM proximity (Overpass)",
                "pwr_a_source_pointer": "BA Power notes",
                "pwr_a_as_of": "2026-11-03",
                "pwr_a_confidence": "Estimated",
                "pwr_a_captured_by": "Indie",
                "pwr_b_hosting_mw_frontage": 0,
                "pwr_b_hosting_horizon": 2028,
                "pwr_b_source_type": "utility hosting map",
                "pwr_c_service_amps": 1200,
                "pwr_c_source_type": "listing claim",
                "pwr_c_confidence": "Claimed",
                "upgrade_usd": 50000,
                "AZ Power rating (deprecated)": "Strong",
            },
            service=True,
        )
        self.assertEqual(fields["cap_a_substation_mi"], 0.81)
        self.assertEqual(fields["cap_a_line_ft"], 392)
        self.assertEqual(fields["cap_a_source"], "OSM proximity (Overpass)")
        self.assertEqual(fields["cap_a_as_of"], "2026-11-03")
        self.assertEqual(fields["cap_a_confidence"], "Estimated")
        self.assertNotIn("cap_b_source", fields)
        self.assertEqual(fields["cap_b_frontage"], 0)
        self.assertEqual(fields["cap_b_horizon"], "2028")
        self.assertEqual(fields["cap_c_amps"], 1200)
        self.assertEqual(fields["cap_c_source"], "listing claim")
        self.assertNotIn("upgrade_usd", fields)
        self.assertNotIn("site_capacity", fields)
        problems = scan_obj(fields, "facts")
        self.assertEqual(problems, [])

    def test_blank_name_row_stays_when_the_site_id_is_filled(self) -> None:
        self.assertFalse(row_is_data({"Site": "", "Name": None}))
        self.assertTrue(row_is_data({"Site": "", "Name": "", "Site ID": "LAND-PHX-0033"}))
        self.assertTrue(row_is_data({"Asking price ($)": 950000}))

    def test_listing_url_supplies_a_blank_street(self) -> None:
        label = deal_place_label({"Site": "", "Name": "", "Listing link": "https://www.loopnet.com/Listing/5020-S-16th-St-Phoenix-AZ/39334803/"})
        self.assertEqual(label, "5020 S 16th St")

    def test_photo_notes_url_is_not_the_listing_link(self) -> None:
        sketch = "https://maps.clarkcountynv.gov/assessor/apps/aowebimages/aowebimage.aspx?sketch=16224402010"
        notes = (
            "No listing link on row. Clark County Assessor building sketch filed for APN 162-24-402-010 "
            f"(not a photograph) — {sketch} (checked/filed 2026-11-06)."
        )
        blank = {
            "Listing link": "",
            "Listing status": "Listed",
            "Photo notes": notes,
            "What we know": f"See the sketch {sketch}",
            "Land evidence": sketch,
            "Source of the numbers": sketch,
            "_links": [("Photo notes", sketch), ("What we know", sketch)],
        }
        self.assertEqual(listing_url_from_row(blank), "")
        typed = {
            **blank,
            "Listing link": "View listing",
            "_links": [("Listing link", "https://www.loopnet.com/Listing/1523-E-Southern-Ave-Phoenix-AZ/40461709/"), ("Photo notes", sketch)],
        }
        self.assertEqual(listing_url_from_row(typed), "https://www.loopnet.com/Listing/1523-E-Southern-Ave-Phoenix-AZ/40461709/")
        direct = {**blank, "Listing link": "https://www.bizbuysell.com/business-opportunity/example/"}
        self.assertEqual(listing_url_from_row(direct), "https://www.bizbuysell.com/business-opportunity/example/")
        text_only = {
            **blank,
            "Listing link": "No public listing - broker email only (Car Wash Brokers package, Oct 21)",
            "Photo notes": "https://mcassessor.maricopa.gov/mcs/?q=144-32-001B",
            "_links": [("Photo notes", "https://mcassessor.maricopa.gov/mcs/?q=144-32-001B")],
        }
        self.assertEqual(listing_url_from_row(text_only), "")
        deals = json.loads((ROOT / "data" / "generated" / "deals.geojson").read_text())["features"]
        sites = json.loads((ROOT / "data" / "generated" / "sites.geojson").read_text())["features"]
        by_deal = {feature["properties"]["deal_id"]: feature["properties"] for feature in deals}
        by_site = {feature["properties"]["site_id"]: feature["properties"] for feature in sites}
        las = by_deal["PIPE-LAS-0011"]
        self.assertEqual(las.get("listing_url") or "", "")
        self.assertIn("maps.clarkcountynv.gov", las.get("photo_notes") or "")
        for deal_id in ("LAND-PHX-0045", "LAND-PHX-0046", "LAND-LAS-0050", "LAND-PHX-0050", "PIPE-PHX-0081"):
            self.assertEqual(by_deal[deal_id].get("listing_url") or "", "", deal_id)
        for site_id in ("PHX-U326", "WB-PHX-0027", "WB-PHX-0028", "WB-LAS-0028"):
            self.assertEqual(by_site[site_id].get("listing_url") or "", "", site_id)
        self.assertIn("loopnet.com", by_deal["PIPE-PHX-0001"]["listing_url"])
        self.assertIn("bizbuysell.com", by_deal["PIPE-LAS-0072"]["listing_url"])
        self.assertIn("loopnet.com", by_deal["LAND-PHX-0033"]["listing_url"])

    def test_duplicate_universe_name_uses_the_pipeline_name(self) -> None:
        sites = [
            {"site_id": "PHX-U193", "origin": "universe", "name": "Sonoran Express Car Wash", "address": "1523 E Southern Ave"},
            {"site_id": "PHX-U432", "origin": "universe", "name": "Sonoran Express Car Wash", "address": "16843 N 43rd Ave"},
        ]
        features = [
            {"properties": {"universe_id": "PHX-U193", "kind": "pipeline", "name": "Sonoran Express"}},
            {"properties": {"universe_id": "PHX-U432", "kind": "pipeline", "name": "Express wash"}},
        ]
        self.assertEqual(distinct_pipeline_names(sites, features), 1)
        self.assertEqual(sites[0]["name"], "Sonoran Express Car Wash")
        self.assertEqual(sites[1]["name"], "Express wash")
        chain = [
            {"site_id": "PHX-U217", "origin": "universe", "name": "Super Star Car Wash", "address": "3930 E Baseline Rd"},
            {"site_id": "PHX-U501", "origin": "universe", "name": "Super Star Car Wash", "address": "1905 W Baseline Rd"},
        ]
        chain_deals = [
            {"properties": {"universe_id": "PHX-U217", "kind": "pipeline", "name": "3930 E Baseline Rd"}},
            {"properties": {"universe_id": "PHX-U501", "kind": "pipeline", "name": "1905 W Baseline Rd"}},
        ]
        self.assertEqual(distinct_pipeline_names(chain, chain_deals), 0)
        self.assertEqual(chain[0]["name"], "Super Star Car Wash")

    def test_mcnab_query_drops_the_wrong_city(self) -> None:
        self.assertEqual(
            geocode_queries("7520 W McNab Rd, Miami, FL"),
            ["7520 W McNab Rd, Miami, FL", "7520 W McNab Rd, FL"],
        )


if __name__ == "__main__":
    unittest.main()
