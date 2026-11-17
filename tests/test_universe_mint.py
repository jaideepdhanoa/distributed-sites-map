"""Universe ids stay above ids already in the census and keep a sheet WB id."""

from __future__ import annotations

import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import next_universe_id, sheet_universe_id, universe_id_floors


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


if __name__ == "__main__":
    unittest.main()
