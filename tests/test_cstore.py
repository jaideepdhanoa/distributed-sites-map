"""C-store flag: text rule, and the exact set on the committed deals."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import deal_is_c_store, is_c_store_text

EXPECTED = [
    "PIPE-LAS-0070",
    "PIPE-LAS-0071",
    "PIPE-LAS-0072",
    "PIPE-PHX-0067",
    "PIPE-PHX-0068",
    "PIPE-PHX-0069",
]


class CStoreTests(unittest.TestCase):
    def test_gas_station_segment_alone_is_not_a_c_store(self):
        self.assertFalse(is_c_store_text("Gas station", "Gas station that needs its tanks replaced"))
        self.assertFalse(is_c_store_text("Gas station", "Corner service station with a tenant"))
        self.assertFalse(deal_is_c_store("pipeline", "Gas station", "PIPE-MIA-0075"))

    def test_name_and_segment_tokens(self):
        self.assertTrue(is_c_store_text("C-store", "Mesa"))
        self.assertTrue(is_c_store_text("Gas station", "ARCO ampm gas station"))
        self.assertTrue(is_c_store_text("", "Operating c-store with gas"))
        self.assertTrue(is_c_store_text("am/pm", "Station"))
        self.assertFalse(deal_is_c_store("land", "", "Former c-store and fuel station"))

    def test_committed_deals_match_the_expected_list(self):
        data = json.loads((ROOT / "data" / "generated" / "deals.geojson").read_text())
        found = sorted(
            feature["properties"]["deal_id"]
            for feature in data["features"]
            if feature["properties"].get("is_c_store") is True
        )
        self.assertEqual(found, EXPECTED)
        for feature in data["features"]:
            props = feature["properties"]
            self.assertIn("is_c_store", props)
            self.assertIs(props["is_c_store"], props["is_c_store"] is True)


if __name__ == "__main__":
    unittest.main()
