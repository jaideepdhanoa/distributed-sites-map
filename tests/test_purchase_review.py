import json
from pathlib import Path
import tempfile
import unittest
from openpyxl import Workbook
from scripts.purchase_review import ASSUMPTIONS, FIELDS, write_purchase_review


class PurchaseReviewTest(unittest.TestCase):
    def test_sparse_workbook_preserves_zero_and_only_matches_unambiguous_earnings(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            book = Workbook()
            tab = book.active
            tab.title = "Assumptions"
            tab.append([ASSUMPTIONS["capital"], .08])
            book.save(folder / "input.xlsx")
            site = "PIPE-PHX-9999"
            row = {FIELDS["ebitda"]: "200", FIELDS["cash"]: 0, FIELDS["normalized"]: -12}
            facts = {site: [{"Figure": "Normalized EBITDA", "Value": -12, "Period": "FY 2030"},
                            {"Figure": "EBITDA", "Value": 200, "Period": "FY 2029"},
                            {"Figure": "EBITDA", "Value": 200, "Period": "FY 2030"}]}
            write_purchase_review(folder / "input.xlsx", [(site, "pipeline", row), ("LAND-PHX-9999", "land", row)],
                                  folder / "output.json", facts)
            data = json.loads((folder / "output.json").read_text())
            self.assertEqual(list(data["sites"]), [site])
            item = data["sites"][site]
            self.assertEqual(item["periods"], {"normalized": "FY 2030"})
            self.assertEqual(item["textInputs"], ["ebitda"])
            self.assertEqual(item["cash"], 0)
            self.assertIsNone(item["revenue"])
            self.assertEqual(data["assumptions"]["capital"], .08)
