"""Workbook labels the Auto service category reads after a sync.

Generated geojson is left as synced. These checks lock the fold from Segment
and Segment group onto business_type, without writing the sheet or the file.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import business_type_from_row, business_type_from_text


class BusinessTypeTests(unittest.TestCase):
    def test_auto_service_segment_group_is_not_a_car_wash(self):
        self.assertEqual(business_type_from_text("Auto service"), "Auto repair")
        self.assertEqual(business_type_from_text("General auto repair"), "Auto repair")
        self.assertEqual(business_type_from_text("Tire and light auto service"), "Tire and lube")
        self.assertEqual(business_type_from_text("Auto repair"), "Auto repair")
        self.assertEqual(business_type_from_text("Tire and lube"), "Tire and lube")
        self.assertEqual(business_type_from_text("Car wash"), "Car wash")
        self.assertEqual(business_type_from_text("Other"), "Other")
        self.assertNotEqual(business_type_from_text("Auto service"), "Car wash")
        self.assertNotEqual(business_type_from_text("General auto repair"), "Other")

    def test_segment_wins_and_a_blank_segment_uses_the_group(self):
        self.assertEqual(
            business_type_from_row({"Segment": "General auto repair", "Segment group": "Auto service"}),
            "Auto repair",
        )
        self.assertEqual(
            business_type_from_row({"Segment": "", "Segment group": "Auto service"}),
            "Auto repair",
        )
        self.assertEqual(
            business_type_from_row({"Segment": "Car wash", "Segment group": "Car wash"}),
            "Car wash",
        )
        self.assertEqual(
            business_type_from_row({"Segment": "", "Segment group": "Car wash"}),
            "Car wash",
        )
        for name in ("Rinse My Ride", "Clean Get Away Car Wash", "Fast Lap Xpress Wash"):
            self.assertEqual(
                business_type_from_row({"Name": name, "Segment": "Car wash", "Segment group": "Car wash"}),
                "Car wash",
                name,
            )


if __name__ == "__main__":
    unittest.main()
