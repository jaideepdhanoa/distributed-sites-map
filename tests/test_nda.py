"""NDA Register and site mirrors. The reader never writes the workbook."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from openpyxl import Workbook  # noqa: E402

from scripts.nda import (  # noqa: E402
    NDA_COLUMNS,
    REGISTER_HEADERS,
    column_index,
    nda_mirror_fields,
    write_nda_file,
    _with_letter_fallback,
)


def _stamp(ws, row: int, values: dict[str, object]) -> None:
    ws.cell(4, 1, "Site ID")
    ws.cell(4, 2, "Stage")
    ws.cell(4, 3, "Market")
    for letter, name, _key in NDA_COLUMNS:
        ws.cell(4, column_index(letter) + 1, name)
    ws.cell(row, 1, values.get("Site ID"))
    ws.cell(row, 2, values.get("Stage") or "1 Desk screen")
    ws.cell(row, 3, values.get("Market") or "LAS")
    for letter, name, _key in NDA_COLUMNS:
        if name in values:
            ws.cell(row, column_index(letter) + 1, values[name])


class NdaReadTest(unittest.TestCase):
    def test_letter_fallback_reads_the_court_clock(self) -> None:
        header = [""] * 160
        values: list[object] = [None] * 160
        values[column_index("EW")] = "NDA-009"
        values[column_index("EX")] = "With Moove legal"
        values[column_index("FD")] = 4
        values[column_index("FC")] = 9
        row = _with_letter_fallback(header, values, {"Site ID": "PIPE-PHX-0014"})
        mirror = nda_mirror_fields(row)
        self.assertEqual(mirror["nda_id"], "NDA-009")
        self.assertEqual(mirror["nda_status"], "With Moove legal")
        self.assertEqual(mirror["nda_days_open"], 9)
        self.assertEqual(mirror["nda_days_in_court"], 4)

    def test_reader_uses_the_mirrors_and_does_not_write_the_workbook(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = Workbook()
            pipeline = book.active
            pipeline.title = "Pipeline"
            land = book.create_sheet("Land Sites")
            register = book.create_sheet("NDA Register")
            _stamp(pipeline, 5, {
                "Site ID": "PIPE-LAS-0016",
                "NDA ID": "NDA-001",
                "NDA status": "With counterparty legal",
                "NDA waiting on": "Them — legal",
                "Stage blocker": "We owe a reply",
                "Stage blocker since": date(2026, 11, 4),
                "NDA days open": 13,
                "NDA days in current court": 1,
            })
            _stamp(pipeline, 6, {"Site ID": "PIPE-PHX-0001", "Market": "PHX"})
            _stamp(pipeline, 7, {"Site ID": "PIPE-PHX-0002", "Market": "PHX", "NDA status": "Not started"})
            _stamp(land, 5, {
                "Site ID": "LAND-LAS-0001",
                "NDA ID": "NDA-001",
                "NDA status": "With counterparty legal",
                "Stage blocker": "Awaiting broker reply",
                "Stage blocker since": date(2026, 11, 7),
            })
            for index, name in enumerate(REGISTER_HEADERS, start=1):
                register.cell(1, index, name)
            register.cell(2, 1, "NDA-001")
            register.cell(2, 2, "Miracle")
            register.cell(2, 5, "PIPE-LAS-0016; LAND-LAS-0001")
            register.cell(2, 6, "With counterparty legal")
            register.cell(2, 8, "Them — legal")
            register.cell(2, 11, date(2026, 11, 10))
            register.cell(2, 15, 13)
            register.cell(2, 16, 1)
            register.cell(3, 1, "NDA-002")
            register.cell(3, 2, "Transworld")
            register.cell(3, 15, 25)
            register.cell(3, 16, 20)
            book.save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            destination = Path(folder) / "nda.json"
            result = write_nda_file(path, destination)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            self.assertEqual(result["source"], "workbook")
            payload = json.loads(destination.read_text(encoding="utf-8"))
            linked = payload["sites"]["PIPE-LAS-0016"]
            self.assertEqual(linked["nda_status"], "With counterparty legal")
            self.assertEqual(linked["nda_waiting_on"], "Them — legal")
            self.assertEqual(linked["nda_days_open"], 13)
            self.assertEqual(linked["nda_days_in_court"], 1)
            self.assertEqual(linked["stage_blocker"], "We owe a reply")
            self.assertEqual(linked["stage_blocker_since"], "2026-11-04")
            blank = payload["sites"]["PIPE-PHX-0001"]
            self.assertEqual(blank["nda_status"], "Not required")
            self.assertEqual(blank["nda_waiting_on"], "—")
            self.assertEqual(blank["nda_gates"], "None — not gating (R-076)")
            self.assertIsNone(blank["nda_days_open"])
            self.assertIsNone(blank["nda_days_in_court"])
            self.assertEqual(payload["sites"]["PIPE-PHX-0002"]["nda_status"], "Not required")
            self.assertEqual(payload["sites"]["LAND-LAS-0001"]["stage_blocker"], "Awaiting broker reply")
            self.assertEqual([row["nda_id"] for row in payload["register"]], ["NDA-001", "NDA-002"])
            self.assertEqual(payload["register"][0]["nda_last_action_date"], "2026-11-10")
            self.assertEqual(payload["register"][0]["nda_days_in_court"], 1)
            self.assertEqual(payload["register"][1]["site_ids"], "")
            self.assertNotIn("Not started", json.dumps(payload))

    def test_a_workbook_without_the_tab_keeps_the_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "book.xlsx"
            book = Workbook()
            book.active.title = "Pipeline"
            book.save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            destination = Path(folder) / "nda.json"
            destination.write_text('{"source":"fixture"}\n', encoding="utf-8")
            result = write_nda_file(path, destination)
            self.assertTrue(result["kept"])
            self.assertEqual(destination.read_text(encoding="utf-8"), '{"source":"fixture"}\n')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)


if __name__ == "__main__":
    unittest.main()
