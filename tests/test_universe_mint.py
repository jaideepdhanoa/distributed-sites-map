"""Universe ids stay above ids already in the census and keep a sheet WB id."""

from __future__ import annotations

import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import (
    drop_sites_without_pins,
    match_deal_universe,
    next_universe_id,
    sheet_universe_id,
    universe_id_floors,
    universe_match_index,
)


class UniverseMintTest(unittest.TestCase):
    def test_floor_and_sheet_id(self):
        floors = universe_id_floors(
            [
                {"site_id": "WB-PHX-0012"},
                {"site_id": "WB-PHX-0004"},
                {"site_id": "PIPE-PHX-0001"},
                {"site_id": "WB-LAS-0002"},
            ]
        )
        self.assertEqual(floors["PHX"], 12)
        self.assertEqual(floors["LAS"], 2)
        used = {"WB-PHX-0012", "WB-PHX-0004"}
        given = sheet_universe_id({"Universe ID": "WB-PHX-0040", "Market": "PHX"})
        self.assertEqual(given, "WB-PHX-0040")
        self.assertEqual(next_universe_id(Counter(floors), "PHX", used, given), "WB-PHX-0040")
        fresh = Counter(floors)
        self.assertEqual(next_universe_id(fresh, "PHX", used, "WB-PHX-0012"), "WB-PHX-0013")
        self.assertEqual(next_universe_id(fresh, "PHX", used | {"WB-PHX-0013"}, ""), "WB-PHX-0014")
        self.assertEqual(sheet_universe_id({"Site ID": "not-an-id"}), "")

    def test_counted_universe_id_wins_over_a_different_street(self):
        sites = [
            {
                "site_id": "WB-PHX-9001",
                "city": "PHX",
                "origin": "universe",
                "counts_as_site": True,
                "apn": "111",
                "address": "1 Other St",
                "name": "",
            },
            {
                "site_id": "WB-PHX-9002",
                "city": "PHX",
                "origin": "universe",
                "counts_as_site": True,
                "apn": "222",
                "address": "9 Main St",
                "name": "",
            },
        ]
        by_apn, by_street = universe_match_index(sites)
        row = {"Market": "PHX", "Universe ID": "WB-PHX-9001", "APN or folio": "222", "Site": "9 Main St"}
        self.assertEqual(match_deal_universe(row, sites, by_apn, by_street), "WB-PHX-9001")

    def test_universe_id_joins_when_the_street_number_differs(self):
        sites = [
            {
                "site_id": "WB-MIA-0050",
                "city": "MIA",
                "origin": "universe",
                "counts_as_site": True,
                "apn": "100-00-050",
                "address": "10 Sample St",
                "name": "",
            },
        ]
        by_apn, by_street = universe_match_index(sites)
        linked = {"Market": "MIA", "Universe ID": "WB-MIA-0050", "Site": "40 Sample St"}
        self.assertEqual(match_deal_universe(linked, sites, by_apn, by_street), "WB-MIA-0050")
        bare = {"Market": "MIA", "Site": "40 Sample St", "APN or folio": "100-00-050"}
        self.assertEqual(match_deal_universe(bare, sites, by_apn, by_street), "WB-MIA-0050")
        neither = {"Market": "MIA", "Site": "40 Sample St"}
        self.assertIsNone(match_deal_universe(neither, sites, by_apn, by_street))

    def test_an_uncounted_id_falls_back_to_the_parcel(self):
        sites = [
            {
                "site_id": "WB-PHX-9002",
                "city": "PHX",
                "origin": "universe",
                "counts_as_site": False,
                "apn": "",
                "address": "9 Main St",
                "name": "",
            },
            {
                "site_id": "PHX-U1",
                "city": "PHX",
                "origin": "universe",
                "counts_as_site": True,
                "apn": "222",
                "address": "9 Main St",
                "name": "",
            },
        ]
        by_apn, by_street = universe_match_index(sites)
        row = {"Market": "PHX", "Universe ID": "WB-PHX-9002", "APN or folio": "222", "Site": "9 Main St"}
        self.assertEqual(match_deal_universe(row, sites, by_apn, by_street), "PHX-U1")
        bare = {"Market": "PHX", "APN or folio": "222", "Site": "9 Main St"}
        self.assertEqual(match_deal_universe(bare, sites, by_apn, by_street), "PHX-U1")

    def test_a_counted_row_without_a_pin_leaves_both_totals(self):
        sites = [
            {"site_id": "WB-PHX-9001", "origin": "universe", "counts_as_site": True, "in_area": True, "lat": None, "lon": None},
            {"site_id": "WB-PHX-9002", "origin": "universe", "counts_as_site": True, "in_area": True, "lat": 33.4, "lon": -112.0},
            {"site_id": "PHX-U1", "origin": "universe", "counts_as_site": False, "lat": None, "lon": None},
        ]
        missing = drop_sites_without_pins(sites)
        self.assertEqual(missing, ["WB-PHX-9001"])
        self.assertFalse(sites[0]["counts_as_site"])
        self.assertFalse(sites[0]["in_area"])
        self.assertTrue(sites[1]["counts_as_site"])
        self.assertFalse(sites[2]["counts_as_site"])


if __name__ == "__main__":
    unittest.main()
