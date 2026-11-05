import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from build_timeline import write_timeline  # noqa: E402
from timeline_config import load_config  # noqa: E402
from timeline_drive import DOC, FOLDER, description_marks_skip, files_list_url, folder_url_for, match_materials  # noqa: E402
from timeline_gmail import load_gmail_items  # noqa: E402
from timeline_policy import blocked, status_line  # noqa: E402

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
        _file("f4", "2026-10-24 A - Extra.pdf", description="Earlier note<div>Duplicate of: 2026-10-21 A</div>"),
    ],
    "nested": [_file("f3", "2026-10-23 A - Report.pdf")],
    "legal": [
        _file("s1", "2026-10-22 A - Survey.pdf"),
        _file("s2", "2026-10-22 A - Copy.pdf", description="Duplicate of: x"),
    ],
    "ops": [
        _file("p1", "A - photo 1.jpg", created="2026-10-20T12:00:00Z", mime="image/jpeg"),
        _file("p2", "2026-10-25 A - Extra.jpg", created="2026-10-25T12:00:00Z", mime="image/jpeg", description="<p>Misfiled: other place</p>"),
    ],
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

    def test_description_markers_plain_and_html(self):
        self.assertTrue(description_marks_skip("Duplicate of: x"))
        self.assertTrue(description_marks_skip("  misfiled: somewhere"))
        self.assertTrue(description_marks_skip("SUPERSEDES: older copy"))
        self.assertTrue(description_marks_skip("Also filed under: PIPE-PHX-0003"))
        self.assertTrue(description_marks_skip("Earlier note<div>Duplicate of: 2026-10-21 A</div>"))
        self.assertTrue(description_marks_skip("Hello<br>Misfiled: other folder"))
        self.assertTrue(description_marks_skip("<p>Supersedes: prior</p>"))
        self.assertTrue(description_marks_skip("Intro</div><div>Also filed under: PIPE-PHX-0001</div>"))
        self.assertTrue(description_marks_skip("Duplicate&nbsp;of: A &amp; B"))
        self.assertTrue(description_marks_skip("This is not a duplicate of: something"))
        self.assertTrue(description_marks_skip("County copy. Misfiled: the other folder"))
        self.assertTrue(description_marks_skip("<div>Recorded plat. Also filed under: the city set</div>"))
        self.assertFalse(description_marks_skip("<div>See the survey.</div>"))

    def test_union_hills_property_and_legal_drops_to_zero(self):
        """Survey 1ultfL and plat 15mbTv carry a skip marker after other text, so the category is empty."""

        class Lister:
            def list_children(self, folder_id):
                tree = {
                    "root": [_folder("uh", "PIPE-PHX-0005 PHX 515 E Union Hills Dr")],
                    "uh": [_folder("src", "Source files")],
                    "src": [_folder("legal", "2 Property and legal")],
                    "legal": [
                        _file(
                            "1ultfLsurvey",
                            "2026-10-01 A - Survey.pdf",
                            description="County survey on file. Duplicate of: the recorded set",
                        ),
                        _file(
                            "15mbTvplat",
                            "2026-10-02 A - Plat.pdf",
                            description="<div>Recorded plat. Also filed under: the city folder</div>",
                        ),
                    ],
                }
                return tree.get(folder_id, [])

        records = [{"site_id": "PIPE-PHX-0005", "label": "PHX 515 E Union Hills Dr", "folder_id": "uh"}]
        materials, _warnings, log = match_materials(Lister(), "root", records)
        self.assertEqual(log["matched"], 1)
        self.assertEqual(materials["PIPE-PHX-0005"]["materials"], [])

    def test_workbook_folder_is_kept_when_the_root_listing_omits_it(self):
        class Lister:
            def list_children(self, folder_id):
                tree = {
                    "root": [_folder("southern", "PIPE-PHX-0001 PHX 1523 E Southern Ave")],
                    "southern": [],
                    "mia": [_folder("src", "Source files")],
                    "src": [_folder("fin", "1 Financials")],
                    "fin": [_file("pnl", "2026-11-04 A - Profit and loss.pdf")],
                }
                return tree.get(folder_id, [])

        records = [
            {"site_id": "PIPE-PHX-0001", "label": "PHX 1523 E Southern Ave", "folder_id": "southern"},
            {"site_id": "PIPE-MIA-0080", "label": "MIA 7520 W McNab Rd", "folder_id": "mia"},
        ]
        materials, warnings, log = match_materials(Lister(), "root", records)
        self.assertEqual(materials["PIPE-MIA-0080"]["folder_url"], "https://drive.google.com/drive/folders/mia")
        self.assertEqual(materials["PIPE-MIA-0080"]["materials"][0]["category"], "financials")
        self.assertEqual(materials["PIPE-MIA-0080"]["materials"][0]["count"], 1)
        self.assertEqual(log["matched"], 2)
        self.assertEqual(warnings, [])
        self.assertEqual(folder_url_for("mia"), "https://drive.google.com/drive/folders/mia")

    def test_hidden_workbook_folder_still_keeps_the_link(self):
        hidden = "1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ"

        class Lister:
            def list_children(self, folder_id):
                if folder_id != hidden:
                    return []
                raise urllib.error.HTTPError("https://www.googleapis.com/drive/v3/files", 403, "Forbidden", hdrs=None, fp=None)

        records = [{"site_id": "PIPE-MIA-0080", "label": "MIA 7520 W McNab Rd", "folder_id": "1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ"}]
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "timeline.json"
            summary = write_timeline(None, lister=Lister(), drive_state="ok", destination=dest, records=records)
            payload = json.loads(dest.read_text())
        stars = payload["records"]["PIPE-MIA-0080"]
        self.assertEqual(stars["folder_url"], "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ")
        self.assertEqual(stars["materials"], [])
        self.assertEqual(summary["matched_folders"], 1)
        warning_blob = "\n".join(summary["warnings"])
        self.assertIn("1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ", warning_blob)
        self.assertIn("sites-map-sync@sites-map-sync.iam.gserviceaccount.com", warning_blob)
        self.assertIn("1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk", warning_blob)

    def test_folder_column_text_and_hyperlink(self):
        from build_data import folder_url_from_row

        self.assertEqual(
            folder_url_from_row({"Folder": "https://drive.google.com/drive/folders/abc?usp=sharing"}),
            "https://drive.google.com/drive/folders/abc",
        )
        self.assertEqual(
            folder_url_from_row({"Folder": "Open folder", "_links": [("Folder", "https://drive.google.com/drive/folders/xyz")]}),
            "https://drive.google.com/drive/folders/xyz",
        )
        self.assertEqual(folder_url_from_row({"Folder": ""}), "")

    def test_skipped_drive_still_ships_the_folder_column(self):
        records = [{"site_id": "PIPE-MIA-0080", "label": "MIA 7520 W McNab Rd", "folder_id": "1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ"}]
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "timeline.json"
            summary = write_timeline(None, lister=None, drive_state="skipped", destination=dest, records=records)
            payload = json.loads(dest.read_text())
        self.assertEqual(summary["drive"], "skipped")
        self.assertEqual(
            payload["records"]["PIPE-MIA-0080"]["folder_url"],
            "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ",
        )

    def test_stage_line_drops_a_parenthetical(self):
        self.assertEqual(status_line("stage", "Stage set to Dropped (date approximate)"), "Stage set to Dropped")
        self.assertEqual(status_line("stage", "Stage set to Dropped"), "Stage set to Dropped")

    def test_drive_read_error_does_not_write_a_timeline(self):
        class Boom:
            def list_children(self, _folder_id):
                raise RuntimeError("drive: error")

        dest = Path(tempfile.mkdtemp()) / "timeline.json"
        with self.assertRaises(SystemExit) as caught:
            write_timeline(None, lister=Boom(), drive_state="ok", destination=dest, records=[])
        self.assertIn("drive: error", str(caught.exception))
        self.assertFalse(dest.exists())

    def test_added_plural_terms_are_blocked(self):
        payload = json.loads((ROOT / "config" / "timeline-terms.json").read_text())
        import base64

        words = [base64.b64decode(item).decode().removeprefix("term:") for item in payload["words"]]
        sample = next(word for word in words if word.endswith("s") and len(word) >= 4)
        self.assertTrue(blocked(f"see {sample} here"))
        self.assertFalse(blocked("Sales package on file"))


if __name__ == "__main__":
    unittest.main()
