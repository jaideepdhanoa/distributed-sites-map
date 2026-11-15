"""C-store flag: the text rule, and that committed deals follow it.

A new workbook row is fine. The live id list is not frozen. Each committed
flag has to match deal_is_c_store on the kind, the Segment column, and the name.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import deal_is_c_store, is_c_store_text


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
        self.assertTrue(is_c_store_text("Gas / c-store", "Green Valley Grocery & 76 Fuel"))
        self.assertTrue(deal_is_c_store("pipeline", "Gas / c-store", "Green Valley Grocery & 76 Fuel, 7690 S Durango Dr"))
        self.assertFalse(deal_is_c_store("land", "Gas / c-store", "Green Valley Grocery & 76 Fuel"))
        self.assertFalse(deal_is_c_store("land", "", "Former c-store and fuel station"))

    def test_committed_flags_follow_the_classification_rule(self):
        data = json.loads((ROOT / "data" / "generated" / "deals.geojson").read_text())
        segments = _segments()
        flagged = []
        checked = 0
        for feature in data["features"]:
            props = feature["properties"]
            self.assertIn("is_c_store", props)
            self.assertIs(props["is_c_store"], props["is_c_store"] is True)
            deal_id = str(props.get("deal_id") or "")
            kind = str(props.get("kind") or "")
            name = str(props.get("name") or "")
            if deal_id not in segments:
                if props["is_c_store"] is True or kind != "pipeline" or is_c_store_text("", name):
                    self.assertEqual(props["is_c_store"], deal_is_c_store(kind, "", name), deal_id)
                continue
            expected = deal_is_c_store(kind, segments[deal_id], name)
            self.assertEqual(props["is_c_store"], expected, deal_id)
            checked += 1
            if expected:
                flagged.append(deal_id)
        self.assertGreater(checked, 0)
        self.assertTrue(flagged)


def _segments() -> dict[str, str]:
    """Workbook Segment column, as kept on the pricing export."""
    payload = json.loads((ROOT / "data" / "pricing" / "sources.json").read_text())
    found: dict[str, str] = {}
    for row in payload.get("land") or []:
        deal_id = str(row.get("id") or "").strip()
        if deal_id:
            found[deal_id] = str(row.get("segment") or "")
    for row in payload.get("sites") or []:
        deal_id = str(row.get("id") or "").strip()
        if deal_id:
            found[deal_id] = str(row.get("segment") or "")
    return found


if __name__ == "__main__":
    unittest.main()
