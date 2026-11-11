"""Comms Log reader. The reader never writes the workbook."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from openpyxl import Workbook  # noqa: E402

from scripts.comms import (  # noqa: E402
    HEADERS,
    build_payload,
    normalize_row,
    site_tokens,
    write_comms_file,
)
from timeline_activity import read_activity  # noqa: E402
from timeline_config import load_config  # noqa: E402


def _book() -> Workbook:
    book = Workbook()
    sheet = book.active
    sheet.title = "Comms Log"
    for index, name in enumerate(HEADERS, start=1):
        sheet.cell(1, index, name)
    return book


def _put(sheet, row: int, values: dict[str, object]) -> None:
    for index, name in enumerate(HEADERS, start=1):
        if name in values:
            sheet.cell(row, index, values[name])


class CommsReadTest(unittest.TestCase):
    def test_a_multi_site_row_is_keyed_under_every_site_id(self) -> None:
        internal = normalize_row({
            "Comms ID": "CM-0021",
            "Site IDs": "PIPE-PHX-0001; PIPE-PHX-0003",
            "Date/time": datetime(2026, 10, 9, 12, 35),
            "Direction": "internal",
            "Counterparty person": "Cindel Pena",
            "Counterparty firm": "Moove",
            "Channel": "Gmail",
            "Summary": "Handover note",
        })
        shared = normalize_row({
            "Comms ID": "CM-0377",
            "Site IDs": "LAND-PHX-0059; LAND-PHX-0061",
            "Date/time": "2026-11-11 08:55",
            "Direction": "out",
            "Channel": "Gmail",
            "Link": "https://mail.google.com/mail/u/0/#inbox/1a1cb8944d8350a0",
            "Summary": "Initial inquiry on two land listings.",
        })
        junk = normalize_row({
            "Comms ID": "CM-9001",
            "Site IDs": "PIPE-PHX-0018; Apache Junction tire business",
            "Direction": "Broker",
            "Date/time": "2026-11-11 12:30 PT",
            "Summary": "x" * 340,
        })
        assert internal and shared and junk
        payload = build_payload([internal, shared, junk], source="workbook", label="test", as_of="")
        self.assertEqual(payload["sites"]["PIPE-PHX-0001"], ["CM-0021"])
        self.assertEqual(payload["sites"]["PIPE-PHX-0003"], ["CM-0021"])
        self.assertEqual(payload["sites"]["LAND-PHX-0059"], ["CM-0377"])
        self.assertEqual(payload["sites"]["LAND-PHX-0061"], ["CM-0377"])
        self.assertEqual(payload["sites"]["PIPE-PHX-0018"], ["CM-9001"])
        self.assertNotIn("Apache Junction tire business", json.dumps(payload["sites"]))
        self.assertEqual(internal["direction"], "internal")
        self.assertEqual(internal["at"], "2026-10-09 12:35")
        self.assertEqual(junk["at"], "2026-11-11 12:30")
        self.assertEqual(len(junk["summary"]), 300)
        self.assertEqual(payload["unexpected_directions"], ["Broker"])
        self.assertEqual(site_tokens("land-phx-0049; not a site"), ["LAND-PHX-0049"])

    def test_reader_uses_the_tab_and_does_not_write_the_workbook(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = _book()
            sheet = book.active
            _put(sheet, 2, {
                "Comms ID": "CM-0016",
                "Site IDs": "LAND-PHX-0049",
                "Date/time": "2026-11-05",
                "Direction": "out",
                "Counterparty firm": "Example firm",
                "Channel": "Crexi",
            })
            _put(sheet, 3, {
                "Comms ID": "CM-0021",
                "Site IDs": "PIPE-PHX-0001; PIPE-PHX-0003",
                "Date/time": datetime(2026, 10, 9, 12, 35),
                "Direction": "Internal",
                "Channel": "Gmail",
                "Summary": "Kept in the snapshot",
            })
            book.save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            destination = Path(folder) / "comms.json"
            result = write_comms_file(path, destination)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            self.assertEqual(result["source"], "workbook")
            payload = json.loads(destination.read_text(encoding="utf-8"))
            by_id = {row["comms_id"]: row for row in payload["rows"]}
            self.assertEqual(by_id["CM-0016"]["summary"], "")
            self.assertEqual(by_id["CM-0016"]["link"], "")
            self.assertEqual(by_id["CM-0021"]["direction"], "Internal")
            self.assertIn("CM-0021", payload["sites"]["PIPE-PHX-0001"])
            self.assertIn("CM-0021", payload["sites"]["PIPE-PHX-0003"])
            self.assertNotIn("body", by_id["CM-0016"])

    def test_a_workbook_without_the_tab_keeps_the_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = Workbook()
            book.active.title = "Pipeline"
            book.save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            destination = Path(folder) / "comms.json"
            destination.write_text('{"source":"fixture"}\n', encoding="utf-8")
            result = write_comms_file(path, destination)
            self.assertTrue(result["kept"])
            self.assertEqual(destination.read_text(encoding="utf-8"), '{"source":"fixture"}\n')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)

    def test_activity_source_link_is_kept_for_dedupe(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = Workbook()
            sheet = book.active
            sheet.title = "Activity"
            headers = ["Event ID", "Date", "Site ID", "Type", "Summary", "Source link", "Visibility"]
            for index, name in enumerate(headers, start=1):
                sheet.cell(1, index, name)
            sheet.cell(2, 1, "A-000088")
            sheet.cell(2, 2, "2026-10-19")
            sheet.cell(2, 3, "PIPE-LAS-0016")
            sheet.cell(2, 4, "doc")
            sheet.cell(2, 5, "Document on file")
            sheet.cell(2, 6, "https://mail.google.com/mail/u/0/#inbox/abcdef0123456789")
            sheet.cell(2, 7, "Map")
            book.save(path)
            items, warnings = read_activity(path, load_config(), {"PIPE-LAS-0016"})
            self.assertEqual(warnings, [])
            self.assertEqual(items[0]["event_id"], "A-000088")
            self.assertEqual(items[0]["source_link"], "https://mail.google.com/mail/u/0/#inbox/abcdef0123456789")


if __name__ == "__main__":
    unittest.main()
