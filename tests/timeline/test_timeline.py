import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from build_timeline import write_timeline  # noqa: E402
from timeline_activity import read_activity  # noqa: E402
from timeline_config import load_config  # noqa: E402
from timeline_drive import FOLDER, items_from_drive, record_id_from_folder  # noqa: E402
from timeline_gmail import load_gmail_items  # noqa: E402


def hidden_word() -> str:
    payload = json.loads((ROOT / "config" / "timeline-terms.json").read_text())
    for item in payload["words"]:
        text = __import__("base64").b64decode(item).decode().removeprefix("term:")
        if len(text) >= 6:
            return text
    raise AssertionError("term list is empty")


class TimelineTests(unittest.TestCase):
    def test_activity_keeps_a_neutral_row_and_drops_blocked_text(self):
        word = hidden_word()
        number = "-".join(["555", "010", "0199"])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Activity"
            ws.append(["Date", "Site ID", "Type", "Summary", "Link"])
            ws.append(["2026-11-01", "PIPE-PHX-0008", "call", "Spoke with the listing desk.", "https://example.com/listing"])
            ws.append(["2026-11-02", "PIPE-PHX-0008", "doc", f"See {word} today", ""])
            ws.append(["2026-11-03", "PHX-U180", "visit", f"Meet at {number}", ""])
            ws.append(["2026-11-04", "PHX-U180", "email", "desk@example.com", ""])
            ws.append(["2026-11-05", "PHX-U180", "mystery", "A plain line.", ""])
            wb.save(path)
            items = read_activity(path, load_config())
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["record_id"], "PIPE-PHX-0008")
        self.assertEqual(items[0]["summary"], "Spoke with the listing desk.")
        self.assertEqual(items[0]["link"], "https://example.com/listing")
        self.assertNotIn(word, json.dumps(items))
        self.assertNotIn(number, json.dumps(items))

    def test_missing_activity_tab_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            wb = openpyxl.Workbook()
            wb.active.title = "Pipeline"
            wb.save(path)
            self.assertEqual(read_activity(path, load_config()), [])

    def test_drive_shows_type_and_hides_private_files(self):
        word = hidden_word()
        config = load_config()

        class Fake:
            def list_children(self, folder_id):
                if folder_id == "root":
                    return [
                        {"id": "rec", "name": "PIPE-PHX-0008 – 1 Main", "mimeType": FOLDER},
                        {"id": "notes", "name": "Notes", "mimeType": FOLDER},
                    ]
                if folder_id == "rec":
                    return [
                        {
                            "id": "b",
                            "name": "brochure.pdf",
                            "mimeType": "application/pdf",
                            "modifiedTime": "2026-10-02T12:00:00Z",
                            "webViewLink": "https://example.com/brochure",
                        },
                        {"id": "photos", "name": "Photos", "mimeType": FOLDER},
                        {
                            "id": "hidden",
                            "name": f"{word}.pdf",
                            "mimeType": "application/pdf",
                            "modifiedTime": "2026-10-03T12:00:00Z",
                            "webViewLink": "https://example.com/hidden",
                        },
                    ]
                if folder_id == "photos":
                    return [
                        {
                            "id": "img",
                            "name": "front.jpg",
                            "mimeType": "image/jpeg",
                            "modifiedTime": "2026-10-01T12:00:00Z",
                            "webViewLink": "https://example.com/photo",
                        }
                    ]
                return []

        items = items_from_drive(Fake(), "root", config)
        self.assertEqual(sorted(item["type"] for item in items), ["brochure", "photos"])
        blob = json.dumps(items)
        self.assertNotIn(word, blob)
        self.assertNotIn("front.jpg", blob)
        self.assertNotIn("brochure.pdf", blob)
        self.assertTrue(all(item["summary"] in {"Brochure on file", "Photos on file"} for item in items))

    def test_city_path_finds_the_record_folder(self):
        config = load_config()
        config["drive"]["path"] = ["Sites", "{city}"]

        class Fake:
            def list_children(self, folder_id):
                tree = {
                    "root": [{"id": "sites", "name": "Sites", "mimeType": FOLDER}],
                    "sites": [{"id": "phx", "name": "PHX", "mimeType": FOLDER}],
                    "phx": [{"id": "rec", "name": "PHX-U180", "mimeType": FOLDER}],
                    "rec": [
                        {
                            "id": "om",
                            "name": "om.pdf",
                            "mimeType": "application/pdf",
                            "modifiedTime": "2026-09-01T00:00:00Z",
                            "webViewLink": "https://example.com/om",
                        }
                    ],
                }
                return tree.get(folder_id, [])

        items = items_from_drive(Fake(), "root", config)
        self.assertEqual([item["record_id"] for item in items], ["PHX-U180"])
        self.assertEqual(items[0]["type"], "om")
        self.assertEqual(items[0]["summary"], "OM on file")

    def test_folder_names_and_gmail_hook(self):
        self.assertEqual(record_id_from_folder("PIPE-PHX-0008 – 1 Main"), "PIPE-PHX-0008")
        self.assertEqual(record_id_from_folder("Listing"), "")
        self.assertEqual(load_gmail_items(load_config(), ["PIPE-PHX-0008"]), [])
        os.environ["DRIVE_FOLDER_TEMPLATE"] = "Sites/{recordId}"
        os.environ["ACTIVITY_SHEET"] = "Log"
        try:
            config = load_config()
            self.assertEqual(config["drive"]["folderTemplate"], "Sites/{recordId}")
            self.assertEqual(config["activity"]["sheet"], "Log")
        finally:
            del os.environ["DRIVE_FOLDER_TEMPLATE"]
            del os.environ["ACTIVITY_SHEET"]

    def test_write_does_not_include_gmail_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            dest = Path(tmp) / "timeline.json"
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Activity"
            ws.append(["date", "site id", "type", "summary", "link"])
            ws.append(["2026-08-01", "PHX-U180", "visit", "", ""])
            wb.save(path)
            summary = write_timeline(path, lister=None, drive_state="skipped", destination=dest)
            payload = json.loads(dest.read_text())
        self.assertEqual(summary["gmail"], "not_built")
        self.assertEqual(summary["drive"], "skipped")
        self.assertEqual(payload["items"][0]["summary"], "Visit logged")
        self.assertNotIn("subject", payload["items"][0])


if __name__ == "__main__":
    unittest.main()
