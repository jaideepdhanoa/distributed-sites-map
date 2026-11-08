"""Financials panel: workbook tabs, gap states, and no invented figures."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from openpyxl import Workbook

from scripts.financials import (
    FACT_HEADERS,
    PARENT_FOLDER_ID,
    PROTECTED_SITE_IDS,
    build_site,
    package_folder_id,
    safe_drive_href,
    sensitive_files,
    write_financials_file,
)


def _pipeline_row(**extra):
    row = {
        "Business check": "Operating",
        "Financials status": "Documented",
        "Package status": "Received",
        "Claimed cash-flow label": "EBITDA",
        "Claimed cash flow ($ a year)": -121000,
        "EBITDA ($ a year)": -121000,
        "Revenue ($ a year)": None,
        "Normalized EBITDA ($ a year)": None,
    }
    row.update(extra)
    return row


class FinancialsTest(unittest.TestCase):
    def test_missing_tabs_keep_the_headline_and_gap_states(self) -> None:
        panel = build_site("PIPE-PHX-0001", "pipeline", _pipeline_row(), None, None)
        self.assertTrue(panel["open"])
        self.assertEqual(panel["headline"]["text"], "-$121,000")
        self.assertEqual(panel["headline"]["metric"], "EBITDA")
        self.assertEqual(panel["headline"]["claim"], "Documented")
        self.assertEqual(panel["packageLine"], "Package on file")
        self.assertEqual(panel["packageHref"], "")
        self.assertFalse(panel["factsTab"])
        blanks = [item for item in panel["figures"] if not item["text"]]
        self.assertTrue(blanks)
        self.assertTrue(all(item["text"] != "$0" and item["text"] != "0" for item in panel["figures"]))
        self.assertTrue(all(item["state"] for item in blanks))
        blob = json.dumps(panel).lower()
        for banned in ("walk-away", "walkaway", "max-pay", "savings", "offer"):
            self.assertNotIn(banned, blob)

    def test_blank_is_not_zero_and_land_stays_closed(self) -> None:
        blank = build_site("PIPE-PHX-0002", "pipeline", _pipeline_row(**{"Claimed cash flow ($ a year)": 0, "EBITDA ($ a year)": None, "Package status": "None", "Financials status": "Claimed"}), None, None)
        earnings = next(item for item in blank["figures"] if item["figure"] == "EBITDA")
        self.assertEqual(earnings["text"], "")
        self.assertNotEqual(earnings["state"], "")
        land = build_site("LAND-PHX-0035", "land", _pipeline_row(**{"Business check": "Land only (no business)"}), None, None)
        self.assertFalse(land["open"])
        self.assertNotIn("packageHref", land)
        not_needed = build_site("PIPE-PHX-0003", "pipeline", _pipeline_row(**{"Financials status": "Not needed"}), None, None)
        self.assertFalse(not_needed["open"])

    def test_proposed_addback_is_visible_and_not_counted(self) -> None:
        facts = [{
            "Site ID": "PIPE-PHX-0001",
            "Figure": "Owner compensation",
            "Period": "Latest",
            "Value": 15000.5,
            "Metric label": "Addback",
            "Claim": "Documented",
            "Source file": "Recast.pdf",
            "Page": "2",
            "Recast role": "addback proposed",
            "As of": "2026-11-01",
            "Captured by": "Indie",
        }, {
            "Site ID": "PIPE-PHX-0001",
            "Figure": "Payroll register",
            "Period": "Latest",
            "Value": 10,
            "Metric label": "Payroll",
            "Claim": "Documented",
            "Source file": "Payroll register.pdf",
            "Page": "",
            "Recast role": "",
            "As of": "",
            "Captured by": "",
        }, {
            "Site ID": "PIPE-PHX-0001",
            "Figure": "Call notes",
            "Period": "Latest",
            "Value": 5,
            "Metric label": "Note",
            "Claim": "",
            "Source file": "4 Emails and calls",
            "Page": "",
            "Recast role": "",
            "As of": "",
            "Captured by": "",
        }]
        panel = build_site("PIPE-PHX-0001", "pipeline", _pipeline_row(**{"Normalized EBITDA ($ a year)": 88000}), facts, None)
        proposed = next(item for item in panel["bridge"] if item["role"] == "Addback proposed")
        self.assertEqual(proposed["text"], "$15,000.50")
        self.assertFalse(proposed["counted"])
        self.assertEqual(panel["ending"]["text"], "$88,000")
        self.assertEqual(panel["headline"]["claim"], "Normalized")
        self.assertTrue(any(item["name"] == "Payroll register.pdf" for item in panel["listed"]))
        self.assertFalse(any(item["figure"] == "Payroll register" for item in panel["figures"]))
        blob = json.dumps(panel)
        self.assertNotIn("Emails and calls", blob)
        self.assertNotIn("Indie", blob)

    def test_exact_headers_and_parent_folder_are_required(self) -> None:
        self.assertEqual(safe_drive_href(f"https://drive.google.com/drive/folders/{PARENT_FOLDER_ID}"), "")
        self.assertTrue(safe_drive_href("https://drive.google.com/file/d/abc123/view").endswith("/view"))
        checks = [{
            "Site ID": "PIPE-PHX-0001",
            "Item": "Payroll summary",
            "State": "On file",
            "Covers period": "2025",
            "File link": f"https://drive.google.com/drive/folders/{PARENT_FOLDER_ID}",
            "Asked on": "2026-11-02",
            "Owner": "A",
            "Received on": "",
            "Note": "",
        }]
        panel = build_site("PIPE-PHX-0001", "pipeline", _pipeline_row(**{"Package status": "Requested"}), None, checks)
        payroll = next(item for item in panel["checklist"] if item["id"] == "payroll")
        self.assertEqual(payroll["href"], "")
        self.assertEqual(payroll["state"], "On file")
        self.assertEqual(panel["packageLine"], "Package asked for (2026-11-02)")

    def test_protected_identity_cells_are_not_rewritten(self) -> None:
        self.assertIn("PIPE-PHX-0006", PROTECTED_SITE_IDS)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = Workbook()
            sheet = book.active
            sheet.title = "Pipeline"
            headers = {
                1: "Site ID",
                2: "Name",
                3: "Market",
                10: "EBITDA ($ a year)",
                57: "Financials status",
                83: "Business check",
            }
            for column, label in headers.items():
                sheet.cell(4, column, label)
            sheet.cell(5, 1, "PIPE-PHX-0006")
            sheet.cell(5, 2, "Pipeline")
            sheet.cell(5, 3, "PHX")
            sheet.cell(5, 10, 20212)
            sheet.cell(5, 57, "Unknown")
            sheet.cell(5, 83, "Operating")
            facts = book.create_sheet("Financial facts")
            for index, label in enumerate(FACT_HEADERS, start=1):
                facts.cell(1, index, label)
            book.save(path)
            destination = Path(folder) / "financials.json"
            write_financials_file(path, destination, {"next": {"PIPE": 1, "LAND": 1}, "by_key": {}})
            from openpyxl import load_workbook

            saved = load_workbook(path)
            self.assertEqual(saved["Pipeline"].cell(5, 2).value, "Pipeline")
            self.assertEqual(saved["Pipeline"].cell(5, 1).value, "PIPE-PHX-0006")
            payload = json.loads(destination.read_text())
            self.assertEqual(payload["sites"]["PIPE-PHX-0006"]["headline"]["text"], "$20,212")
            self.assertNotIn("name", payload["sites"]["PIPE-PHX-0006"])

    def test_workbook_item_states_and_uncounted_recast_lines(self) -> None:
        facts = [
            {"Site ID": "PIPE-PHX-0001", "Figure": "EBITDA", "Period": "FY2025", "Value": -121000, "Metric label": "EBITDA", "Claim": "Documented", "Source file": "https://drive.google.com/file/d/16unVtKFXO7en5XL7XQu0tcrnpAB5SQrR/view", "Page": "", "Recast role": "Reported", "As of": "2026-11-06", "Captured by": ""},
            {"Site ID": "PIPE-PHX-0001", "Figure": "Interest", "Period": "FY2025", "Value": 100172.89, "Metric label": "Addback: interest", "Claim": "Documented", "Source file": "https://drive.google.com/file/d/16unVtKFXO7en5XL7XQu0tcrnpAB5SQrR/view", "Page": "", "Recast role": "addback proposed", "As of": "", "Captured by": ""},
            {"Site ID": "PIPE-PHX-0001", "Figure": "Other primary income", "Period": "FY2025", "Value": 14050.38, "Metric label": "Other income", "Claim": "Documented", "Source file": "", "Page": "", "Recast role": "needs support", "As of": "", "Captured by": ""},
            {"Site ID": "PIPE-PHX-0001", "Figure": "EBITDA", "Period": "FY2024", "Value": -38000, "Metric label": "EBITDA", "Claim": "Documented", "Source file": "", "Page": "", "Recast role": "Reported", "As of": "", "Captured by": ""},
        ]
        checks = [
            {"Site ID": "PIPE-PHX-0001", "Item": "Three years of P&Ls plus YTD", "State": "Some on file, more asked for", "Covers period": "2023 to Jul 2026", "File link": "https://drive.google.com/file/d/16unVtKFXO7en5XL7XQu0tcrnpAB5SQrR/view", "Asked on": "2026-11-06", "Owner": "", "Received on": "2026-10-21", "Note": ""},
            {"Site ID": "PIPE-PHX-0001", "Item": "Rent or lease terms", "State": "Not asked yet", "Covers period": "", "File link": "", "Asked on": "", "Owner": "", "Received on": "", "Note": ""},
            {"Site ID": "PIPE-PHX-0001", "Item": "24 months of car counts", "State": "On file", "Covers period": "", "File link": "", "Asked on": "", "Owner": "", "Received on": "2026-10-21", "Note": ""},
            {"Site ID": "PIPE-1", "Item": "Payroll summary", "State": "Asked for, waiting", "Covers period": "", "File link": "", "Asked on": "2026-11-06", "Owner": "", "Received on": "", "Note": ""},
        ]
        panel = build_site(
            "PIPE-PHX-0001",
            "pipeline",
            _pipeline_row(**{"Normalized EBITDA ($ a year)": None, "Claimed cash flow ($ a year)": -121000, "EBITDA ($ a year)": -121000}),
            facts[:4],
            checks[:3],
            "https://drive.google.com/drive/folders/1OvxyiTru2ZJrNoOaOQ1eWH2OJSZ0d9b5",
        )
        roles = [(item["figure"], item["role"], item["counted"], item["text"]) for item in panel["bridge"]]
        self.assertIn(("EBITDA", "Reported", True, "-$121,000"), roles)
        self.assertIn(("Interest", "Addback proposed", False, "$100,172.89"), roles)
        self.assertIn(("Other primary income", "Needs support", False, "$14,050.38"), roles)
        self.assertEqual(panel["ending"]["figure"], "Normalized EBITDA")
        self.assertEqual(panel["ending"]["text"], "")
        self.assertFalse(panel["ending"]["counted"])
        self.assertEqual(panel["headline"]["text"], "-$121,000")
        self.assertEqual(panel["headline"]["claim"], "Documented")
        states = {item["id"]: item["state"] for item in panel["checklist"]}
        self.assertEqual(states["pl_years"], "Some on file, more asked for")
        self.assertEqual(states["rent"], "Not asked yet")
        self.assertEqual(states["car_counts"], "On file")
        self.assertEqual(panel["packageHref"], "https://drive.google.com/drive/folders/1OvxyiTru2ZJrNoOaOQ1eWH2OJSZ0d9b5")
        asked = build_site("PIPE-1", "pipeline", _pipeline_row(**{"Package status": "Requested", "Financials status": "Claimed"}), None, [checks[3]])
        self.assertEqual(next(item["state"] for item in asked["checklist"] if item["id"] == "payroll"), "Asked for")
        bare = build_site("PIPE-2", "pipeline", _pipeline_row(), None, None)
        self.assertTrue(all(item["state"] == "Not asked yet" for item in bare["checklist"]))
        self.assertEqual(safe_drive_href("https://drive.google.com/drive/folders/11ONFb99evERFObom8lf_Qq81onW50WBw"), "")

    def test_package_link_requires_the_financials_folder(self) -> None:
        class Lister:
            def __init__(self, tree):
                self.tree = tree

            def list_children(self, folder_id):
                return self.tree.get(folder_id, [])

        lister = Lister({
            "site": [{"id": "source", "name": "Source files"}],
            "source": [{"id": "fin", "name": "1 Financials"}, {"id": "mail", "name": "4 Emails and calls"}],
            "fin": [{"id": "pay", "name": "Payroll summary.pdf", "mimeType": "application/pdf"}],
            PARENT_FOLDER_ID: [{"id": "nope", "name": "1 Financials"}],
        })
        self.assertEqual(package_folder_id(lister, "missing"), "")
        self.assertEqual(package_folder_id(lister, PARENT_FOLDER_ID), "")
        self.assertEqual(package_folder_id(lister, "site"), "fin")
        names = sensitive_files(lister, "fin")
        self.assertEqual(names[0]["name"], "Payroll summary.pdf")
        self.assertIn("/file/d/pay/", names[0]["href"])
        self.assertNotIn("mail", json.dumps(names))


if __name__ == "__main__":
    unittest.main()
