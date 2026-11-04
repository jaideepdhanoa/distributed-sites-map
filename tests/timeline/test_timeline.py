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
from timeline_config import load_config  # noqa: E402
from timeline_drive import DOC, FOLDER, files_list_url, match_materials  # noqa: E402
from timeline_gmail import load_gmail_items  # noqa: E402
from timeline_policy import blocked  # noqa: E402

ROOT_ID = "1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk"
PDF = "application/pdf"


def _folder(folder_id: str, name: str) -> dict:
    return {"id": folder_id, "name": name, "mimeType": FOLDER}


def _file(file_id: str, name: str, created: str = "2026-10-01T00:00:00Z", description: str = "", mime: str = PDF) -> dict:
    return {"id": file_id, "name": name, "mimeType": mime, "createdTime": created, "description": description}


TREE = {
    ROOT_ID: [
        _folder("fld-southern", "PIPE-PHX-0001 PHX 1523 E Southern Ave"),
        _folder("fld-broadway", "LAND-PHX-0036 Wrong Label"),
        _folder("fld-central", "PHX 4013-4021 S Central Ave (Colliers)"),
        _folder("fld-random", "Random folder"),
    ],
    "fld-southern": [
        {"id": "memo", "name": "PIPE-PHX-0001 PHX 1523 E Southern Ave - Site memo", "mimeType": DOC},
        _folder("src", "Source files"),
    ],
    "src": [
        _file("loose", "loose.pdf"),
        _folder("fin", "1 Financials"),
        _folder("legal", "2 Property and legal"),
        _folder("ops", "3 Operations"),
        _folder("mail4", "4 Emails and calls"),
    ],
    "fin": [
        _file("f1", "2026-10-21 A - P&L 2025.pdf"),
        _file("f2", "2026-10-22 A - Sales package.pdf"),
        _folder("nested", "Nested"),
    ],
    "nested": [_file("f3", "2026-10-23 A - Report.pdf")],
    "legal": [
        _file("s1", "2026-10-22 A - Survey.pdf"),
        _file("s2", "2026-10-22 A - Copy.pdf", description="Duplicate of: x"),
    ],
    "ops": [_file("p1", "A - photo 1.jpg", created="2026-10-20T12:00:00Z", mime="image/jpeg")],
    "fld-broadway": [_folder("src-b", "Source files")],
    "src-b": [],
    "fld-central": [_folder("src-c", "Source files")],
    "src-c": [],
}


class FakeLister:
    def __init__(self):
        self.asked: list[str] = []

    def list_children(self, folder_id: str):
        if folder_id == "mail4":
            raise AssertionError("excluded folder was listed")
        if "alt=media" in folder_id or "/export" in folder_id:
            raise AssertionError("file bytes were requested")
        self.asked.append(folder_id)
        return list(TREE.get(folder_id, []))


def workbook(path: Path) -> None:
    wb = openpyxl.Workbook()
    pipeline = wb.active
    pipeline.title = "Pipeline"
    pipeline.cell(4, 1, "Site")
    pipeline.cell(4, 2, "Market")
    pipeline.cell(4, 3, "Folder")
    pipeline.cell(4, 4, "Site ID")
    pipeline.cell(5, 1, "PHX 1523 E Southern Ave")
    pipeline.cell(5, 2, "PHX")
    pipeline.cell(5, 4, "PIPE-PHX-0001")
    land = wb.create_sheet("Land Sites")
    land.cell(4, 1, "Site")
    land.cell(4, 2, "Market")
    land.cell(4, 3, "Folder")
    land.cell(4, 4, "Site ID")
    land.cell(5, 1, "PHX 2402 E Broadway Rd")
    land.cell(5, 2, "PHX")
    land.cell(5, 4, "LAND-PHX-0036")
    land.cell(6, 1, "PHX 4013-4021 S Central Ave")
    land.cell(6, 2, "PHX")
    land.cell(6, 3, "Open folder")
    land.cell(6, 3).hyperlink = "https://drive.google.com/drive/folders/fld-central?usp=sharing"
    land.cell(6, 4, "LAND-PHX-0039")
    activity = wb.create_sheet("Activity")
    headers = [
        "Event ID", "Date", "Site ID", "Site label", "Type", "Direction", "Counterparty role",
        "Outcome", "Summary", "Source link", "File link", "Logged by", "Visibility",
    ]
    for col, header in enumerate(headers, start=1):
        activity.cell(1, col, header)
    rows = [
        ["A-000003", "2026-10-22", "PIPE-PHX-0001", "PHX 1523 E Southern Ave", "om", "", "", "", "Sales package on file", "https://mail.example/secret", "https://drive.google.com/file/d/abc", "", "Map"],
        ["A-000010", "2026-10-22", "PIPE-PHX-0001", "", "call", "", "", "", "A neutral line", "", "", "", "Map"],
        ["A-000011", "2026-10-22", "PIPE-PHX-0001", "", "legal", "", "", "", "", "", "", "", "Map"],
        ["A-000012", "2026-10-22", "PIPE-PHX-0001", "", "doc", "", "", "", "Quoted " + chr(36) + "1", "", "", "", "Map"],
        ["A-000013", "2026-10-22", "PIPE-PHX-0001", "", "visit", "", "", "", "Site visit logged", "", "", "", "Internal"],
        ["A-000099", "2026-10-22", "PIPE-PHX-9999", "", "doc", "", "", "", "Document on file", "", "", "", "Map"],
    ]
    for offset, values in enumerate(rows):
        for col, value in enumerate(values, start=1):
            activity.cell(2 + offset, col, value)
    wb.save(path)


class TimelineTests(unittest.TestCase):
    def setUp(self):
        self._root = os.environ.pop("GOOGLE_DRIVE_ROOT_FOLDER_ID", None)

    def tearDown(self):
        if self._root is not None:
            os.environ["GOOGLE_DRIVE_ROOT_FOLDER_ID"] = self._root

    def test_fixture_counts_folder_link_and_activity_lines(self):
        lister = FakeLister()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            dest = Path(tmp) / "timeline.json"
            workbook(path)
            summary = write_timeline(path, lister=lister, drive_state="ok", destination=dest)
            payload = json.loads(dest.read_text())
        southern = payload["records"]["PIPE-PHX-0001"]
        by_category = {item["category"]: item for item in southern["materials"]}
        self.assertEqual(by_category["financials"]["count"], 3)
        self.assertEqual(by_category["financials"]["latest"], "2026-10-23")
        self.assertEqual(by_category["property_legal"]["count"], 1)
        self.assertEqual(by_category["operations"]["count"], 1)
        self.assertEqual(by_category["operations"]["latest"], "2026-10-20")
        self.assertEqual(southern["folder_url"], "https://drive.google.com/drive/folders/fld-southern")
        self.assertEqual(southern["last_touched"], "2026-10-23")
        self.assertEqual(payload["records"]["LAND-PHX-0039"]["folder_url"], "https://drive.google.com/drive/folders/fld-central")
        self.assertEqual(summary["matched_folders"], 3)
        self.assertEqual(summary["unmatched_folders"], 1)
        types = [item["type"] for item in payload["items"] if item["record_id"] == "PIPE-PHX-0001"]
        self.assertEqual(types, ["om", "legal"])
        legal = next(item for item in payload["items"] if item["type"] == "legal")
        self.assertEqual(legal["summary"], "Property or legal document on file")
        self.assertNotIn("link", legal)
        blob = json.dumps(payload)
        for banned in (".pdf", ".jpg", "mail.google", "/file/d/", "loose.pdf", "Survey", '"link"', '"name"', '"description"'):
            self.assertNotIn(banned, blob)
        warning_blob = "\n".join(summary["warnings"])
        self.assertIn("LAND-PHX-0036 label differs from folder fld-broadway", warning_blob)
        self.assertIn("Activity A-000099 does not match a Site ID", warning_blob)
        self.assertNotIn(".pdf", warning_blob)
        self.assertNotIn(".jpg", warning_blob)
        self.assertNotIn("mail4", lister.asked)

    def test_list_url_never_requests_bytes(self):
        url = files_list_url("abc")
        self.assertNotIn("alt=media", url)
        self.assertNotIn("export", url)
        self.assertIn("createdTime", url)
        self.assertIn("description", url)
        self.assertNotIn("webViewLink", url)

    def test_two_folders_prefer_the_folder_cell(self):
        class Lister:
            def list_children(self, folder_id):
                if folder_id != "root":
                    return []
                return [
                    _folder("one", "PIPE-PHX-0001 First"),
                    _folder("two", "PIPE-PHX-0001 Second"),
                ]

        records = [{"site_id": "PIPE-PHX-0001", "label": "First", "folder_id": "two"}]
        _materials, warnings, log = match_materials(Lister(), "root", records)
        self.assertEqual(log["matched"], 1)
        self.assertIn("PIPE-PHX-0001 matched 2 folders; used two", warnings)

    def test_mail_stub_stays_empty(self):
        self.assertEqual(load_gmail_items(load_config(), ["PIPE-PHX-0001"]), [])

    def test_added_plural_terms_are_blocked(self):
        payload = json.loads((ROOT / "config" / "timeline-terms.json").read_text())
        import base64

        words = [base64.b64decode(item).decode().removeprefix("term:") for item in payload["words"]]
        sample = next(word for word in words if word.endswith("s") and len(word) >= 4)
        self.assertTrue(blocked(f"see {sample} here"))
        self.assertFalse(blocked("Sales package on file"))


if __name__ == "__main__":
    unittest.main()
