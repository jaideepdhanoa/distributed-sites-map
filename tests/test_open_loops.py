"""Open-loops reader. It never writes the workbook or the morning brief."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from openpyxl import Workbook  # noqa: E402

from scripts.nda import REGISTER_HEADERS, column_index, court_days  # noqa: E402
from scripts.open_loops import write_open_loops_file  # noqa: E402


def _headers(ws) -> None:
    ws.cell(4, 1, "Site")
    ws.cell(4, 2, "Name")
    ws.cell(4, 3, "Market")
    ws.cell(4, column_index("E") + 1, "Stage")
    ws.cell(4, column_index("AB") + 1, "Next step")
    ws.cell(4, column_index("CI") + 1, "Site ID")
    ws.cell(4, column_index("EW") + 1, "NDA ID")
    ws.cell(4, column_index("EX") + 1, "NDA status")
    ws.cell(4, column_index("EY") + 1, "Stage blocker")
    ws.cell(4, column_index("EZ") + 1, "Stage blocker since")


def _put(ws, row: int, values: dict[str, object]) -> None:
    letters = {
        "Site": "A",
        "Name": "B",
        "Market": "C",
        "Stage": "E",
        "Next step": "AB",
        "Site ID": "CI",
        "NDA ID": "EW",
        "NDA status": "EX",
        "Stage blocker": "EY",
        "Stage blocker since": "EZ",
    }
    for key, value in values.items():
        ws.cell(row, column_index(letters[key]) + 1, value)


class OpenLoopsReadTest(unittest.TestCase):
    def test_a_date_formatted_zero_is_zero_days(self) -> None:
        self.assertEqual(court_days("12/30/1899"), 0)
        self.assertEqual(court_days(time(0, 0)), 0)
        self.assertEqual(court_days(date(1899, 12, 30)), 0)
        self.assertEqual(court_days(8), 8)
        self.assertIsNone(court_days("2026-11-11"))

    def test_reader_does_not_write_the_workbook(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = Workbook()
            pipeline = book.active
            pipeline.title = "Pipeline"
            register = book.create_sheet("NDA Register")
            _headers(pipeline)
            _put(pipeline, 5, {
                "Site": "Sample wash",
                "Name": "Sample",
                "Market": "PHX",
                "Stage": "1 Desk screen",
                "Next step": "We owe the broker a note.",
                "Site ID": "PIPE-PHX-0005",
                "Stage blocker": "We owe a reply",
                "Stage blocker since": date(2026, 11, 7),
            })
            _put(pipeline, 6, {
                "Site": "Parked wash",
                "Name": "Parked",
                "Market": "LAS",
                "Stage": "1 Desk screen",
                "Next step": "Jaideep decided Nov 11, 2026: KEEP parked as a suggested drop.",
                "Site ID": "PIPE-LAS-0015",
                "Stage blocker": "Awaiting broker reply",
                "Stage blocker since": date(2026, 10, 30),
            })
            for index, name in enumerate(REGISTER_HEADERS, start=1):
                register.cell(1, index, name)
            register.cell(2, 1, "NDA-005")
            register.cell(2, 6, "With Moove legal")
            register.cell(2, 8, "Them — signer")
            register.cell(2, 16, "12/30/1899")
            register.cell(3, 1, "NDA-009")
            register.cell(3, 6, "Not required")
            register.cell(3, 8, "—")
            register.cell(3, 15, 5)
            book.save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            destination = Path(folder) / "open-loops.json"
            result = write_open_loops_file(path, destination)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            self.assertEqual(result["source"], "workbook")
            payload = json.loads(destination.read_text(encoding="utf-8"))
            parked = next(row for row in payload["sites"] if row["site_id"] == "PIPE-LAS-0015")
            self.assertEqual(parked["stage"], "1 Desk screen")
            self.assertIn("KEEP parked as a suggested drop", parked["next_step"])
            nda = next(row for row in payload["register"] if row["nda_id"] == "NDA-005")
            self.assertEqual(nda["nda_days_in_court"], 0)
            closed = next(row for row in payload["register"] if row["nda_id"] == "NDA-009")
            self.assertEqual(closed["nda_days_open"], 5)
            self.assertEqual(closed["nda_waiting_on"], "—")
            self.assertNotIn("notes", nda)
            source = Path(ROOT / "scripts" / "open_loops.py").read_text(encoding="utf-8")
            self.assertNotIn("workbook.save", source)
            self.assertNotIn("morning-brief", source.lower())

    def test_a_workbook_without_the_register_keeps_the_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = Workbook()
            book.active.title = "Pipeline"
            book.save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            destination = Path(folder) / "open-loops.json"
            destination.write_text('{"source":"fixture"}\n', encoding="utf-8")
            result = write_open_loops_file(path, destination)
            self.assertTrue(result["kept"])
            self.assertEqual(destination.read_text(encoding="utf-8"), '{"source":"fixture"}\n')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)


if __name__ == "__main__":
    unittest.main()
