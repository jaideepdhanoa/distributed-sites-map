import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from build_data import assert_unique_site_ids, permanent_site_id, shipped_deal_id, site_id_warnings  # noqa: E402


class SiteIdTests(unittest.TestCase):
    def test_a_row_inserted_above_does_not_change_a_set_site_id(self):
        reg = {"next": {"PIPE": 1, "LAND": 1}, "by_key": {}}
        row = {"Site ID": "PIPE-PHX-0005", "Site": "PHX example", "Market": "PHX", "_excel_row": 12}
        self.assertEqual(shipped_deal_id(row, "pipeline", 1, reg), "PIPE-PHX-0005")
        self.assertEqual(shipped_deal_id(row, "pipeline", 8, reg), "PIPE-PHX-0005")

    def test_without_the_column_row_order_still_applies(self):
        reg = {"next": {"PIPE": 1, "LAND": 1}, "by_key": {}}
        row = {"Site": "PHX example", "Market": "PHX"}
        self.assertEqual(shipped_deal_id(row, "pipeline", 1, reg), "PIPE-PHX-0001")
        self.assertEqual(shipped_deal_id(row, "pipeline", 2, reg), "PIPE-PHX-0002")

    def test_blank_cell_uses_the_registry_before_row_order(self):
        row = {"Site ID": "", "Site": "SNA example", "Market": "SNA", "_excel_row": 6}
        reg = {"next": {"PIPE": 1, "LAND": 1}, "by_key": {"pipeline|SNA example": "PIPE-XX-0002"}}
        self.assertEqual(shipped_deal_id(row, "pipeline", 2, reg), "PIPE-XX-0002")
        notes = site_id_warnings([row], [])
        self.assertIn("Pipeline row 6 has no usable Site ID", notes)
        self.assertNotIn("SNA example", " ".join(notes))

    def test_duplicate_and_wrong_tab_are_errors(self):
        rows = [
            {"Site ID": "PIPE-PHX-0001", "_excel_row": 5},
            {"Site ID": "PIPE-PHX-0001", "_excel_row": 9},
        ]
        with self.assertRaises(SystemExit):
            assert_unique_site_ids(rows, [])
        with self.assertRaises(SystemExit):
            permanent_site_id({"Site ID": "PIPE-PHX-0001", "_excel_row": 8}, "land")

    def test_missing_column_does_not_name_the_label(self):
        notes = site_id_warnings([{"Site": "PHX private label", "_excel_row": 5}], [])
        self.assertTrue(any("no Site ID column" in note for note in notes))
        self.assertNotIn("private", " ".join(notes))


if __name__ == "__main__":
    unittest.main()
