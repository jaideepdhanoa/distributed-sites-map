"""Fake Drive responses for the Map sync inputs fetch."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import scripts.sync_workbook as sync

SHEET = "application/vnd.google-apps.spreadsheet"
DOC = "application/vnd.google-apps.document"
FOLDER = "application/vnd.google-apps.folder"
FILE = "application/octet-stream"
FOLDER_ID = "map-sync-inputs"
CHILD_FOLDER = "child-folder-do-not-list"
DECOY = "decoy-seller-notes.pdf"
DECOY_ID = "decoy-file-id"


def _files(extra: list[dict] | None = None, *, include_universe: bool = True, recon_sheet: bool = False) -> list[dict]:
    rows = []
    if include_universe:
        rows.append({"id": "id-universe", "name": "universe_v3.csv", "mimeType": FILE})
    rows.extend(
        [
            {"id": "id-ring", "name": "las_ring100_screen.csv", "mimeType": FILE},
            {"id": "id-listings", "name": "listings_match_v3.csv", "mimeType": FILE},
            {"id": "id-depots", "name": "depots.csv", "mimeType": FILE},
            {"id": "id-kmz", "name": "service-area-PHX.kmz", "mimeType": FILE},
            {"id": CHILD_FOLDER, "name": "Seller files", "mimeType": FOLDER},
            {"id": DECOY_ID, "name": DECOY, "mimeType": FILE},
        ]
    )
    if recon_sheet:
        rows.append({"id": "id-recon-sheet", "name": "reconciliation_final", "mimeType": SHEET})
    else:
        rows.append({"id": "id-recon", "name": "reconciliation_final.xlsx", "mimeType": FILE})
    rows.extend(extra or [])
    return rows


class Listing(list):
    def __init__(self, files: list[dict]):
        super().__init__()
        self.files = files

    def get(self, url: str, token: str) -> bytes:
        self.append(url)
        if "drive/v3/files?" in url and "q=" in url:
            if CHILD_FOLDER in url:
                raise AssertionError("listed a child folder")
            return json.dumps({"files": self.files}).encode()
        if "spreadsheets/" in url:
            return json.dumps({"sheets": [{"properties": {"title": "Only"}}]}).encode()
        if "/export?" in url:
            return b"exported"
        if "alt=media" in url:
            if DECOY_ID in url:
                raise AssertionError("downloaded a skipped file")
            return b"media"
        raise AssertionError("unexpected request")


class SyncFetchTest(unittest.TestCase):
    def setUp(self) -> None:
        self._env = sync.os.environ.get("MAP_SYNC_INPUTS_FOLDER_ID")
        sync.os.environ["MAP_SYNC_INPUTS_FOLDER_ID"] = FOLDER_ID
        self.stdout = io.StringIO()
        self._out = sync.sys.stdout
        sync.sys.stdout = self.stdout

    def tearDown(self) -> None:
        sync.sys.stdout = self._out
        if self._env is None:
            sync.os.environ.pop("MAP_SYNC_INPUTS_FOLDER_ID", None)
        else:
            sync.os.environ["MAP_SYNC_INPUTS_FOLDER_ID"] = self._env

    def test_lists_only_the_top_level(self) -> None:
        listing = Listing(_files())
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            sync.fetch_source_folder("token", Path(tmp))
        lists = [url for url in listing if "q=" in url]
        self.assertEqual(len(lists), 1)
        self.assertIn(FOLDER_ID, lists[0])
        self.assertNotIn(CHILD_FOLDER, "".join(listing))

    def test_skips_files_that_are_not_allowlisted(self) -> None:
        listing = Listing(_files())
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            sync.fetch_source_folder("token", Path(tmp))
        self.assertNotIn(DECOY_ID, "".join(listing))
        self.assertNotIn(DECOY, self.stdout.getvalue())
        self.assertIn("Skipped 2 other files", self.stdout.getvalue())

    def test_exports_a_sheet_named_reconciliation_final(self) -> None:
        listing = Listing(_files(recon_sheet=True))
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            sync.fetch_source_folder("token", Path(tmp))
            saved = Path(tmp) / "reconciliation_final.xlsx"
            self.assertEqual(saved.read_bytes(), b"exported")
        export = [url for url in listing if "id-recon-sheet/export" in url]
        self.assertEqual(len(export), 1)
        self.assertIn("spreadsheetml.sheet", export[0])
        self.assertNotIn("id-recon-sheet?alt=media", "".join(listing))
        self.assertIn("Fetched reconciliation_final.xlsx", self.stdout.getvalue())

    def test_a_google_doc_does_not_satisfy_a_csv(self) -> None:
        listing = Listing(
            _files(
                [{"id": "id-doc", "name": "universe_v3", "mimeType": DOC}],
                include_universe=False,
            )
        )
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit) as raised:
                sync.fetch_source_folder("token", Path(tmp))
        self.assertIn("universe_v3.csv", str(raised.exception))
        self.assertIn("Map sync inputs folder", str(raised.exception))
        self.assertNotIn("id-doc", "".join(listing))

    def test_duplicate_fails(self) -> None:
        listing = Listing(
            _files([{"id": "id-sheet", "name": "universe_v3", "mimeType": SHEET}])
        )
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit) as raised:
                sync.fetch_source_folder("token", Path(tmp))
        self.assertIn("universe_v3.csv", str(raised.exception))
        self.assertIn("duplicate in Map sync inputs", str(raised.exception))
        self.assertFalse(any("alt=media" in url or "/export?" in url for url in listing))

    def test_missing_folder_id_makes_no_drive_call(self) -> None:
        sync.os.environ.pop("MAP_SYNC_INPUTS_FOLDER_ID", None)
        calls: list[str] = []

        def fail(url: str, token: str) -> bytes:
            calls.append(url)
            raise AssertionError("Drive was called")

        sync._get = fail
        with self.assertRaises(SystemExit) as raised:
            sync.fetch_source_folder("token")
        self.assertEqual(str(raised.exception), sync.MISSING_FOLDER)
        self.assertEqual(calls, [])

    def test_a_one_tab_csv_sheet_is_exported(self) -> None:
        files = _files(include_universe=False)
        files.append({"id": "id-universe-sheet", "name": "universe_v3", "mimeType": SHEET})
        listing = Listing(files)
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            sync.fetch_source_folder("token", Path(tmp))
            self.assertEqual((Path(tmp) / "universe_v3.csv").read_bytes(), b"exported")
        self.assertTrue(any("spreadsheets/id-universe-sheet" in url for url in listing))
        self.assertTrue(any("id-universe-sheet/export" in url and "text/csv" in url for url in listing))

    def test_note_rewrites_and_extra_kmz_names(self) -> None:
        files = _files(
            [
                {"id": "id-notes", "name": "note_rewrites.json", "mimeType": FILE},
                {"id": "id-las", "name": "service-area-LAS.kmz", "mimeType": FILE},
                {"id": "id-mia", "name": "service-area-MIA.kmz", "mimeType": FILE},
            ]
        )
        listing = Listing(files)
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            sync.fetch_source_folder("token", Path(tmp))
            root = Path(tmp)
            self.assertFalse((root / "note_rewrites.json").exists())
            self.assertEqual((root / "kmz" / "service-area-LAS.kmz").read_bytes(), b"media")
            self.assertEqual((root / "kmz" / "service-area-MIA.kmz").read_bytes(), b"media")
        self.assertNotIn("id-notes", "".join(listing))
        self.assertNotIn("note_rewrites.json", self.stdout.getvalue())

    def test_missing_rewrites_are_empty(self) -> None:
        import scripts.build_data as build

        original = build._rewrite_paths
        build._rewrite_paths = lambda: [Path("/tmp/does-not-exist-note-rewrites.json")]
        try:
            self.assertEqual(build._load_rewrites("notes"), {})
            self.assertEqual(build._load_rewrites("deals"), {})
        finally:
            build._rewrite_paths = original

    def test_logs_do_not_name_skipped_files(self) -> None:
        listing = Listing(_files())
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            sync.fetch_source_folder("token", Path(tmp))
        log = self.stdout.getvalue()
        self.assertNotIn(DECOY, log)
        self.assertNotIn("Seller files", log)
        self.assertIn("Fetched universe_v3.csv", log)
        self.assertIn("Fetched service-area-PHX.kmz", log)


class TimelineCommentTest(unittest.TestCase):
    def test_sheet_links_are_not_called_drive_matches(self) -> None:
        lines = sync.timeline_comment_lines(
            14,
            2,
            65,
            {"matched_folders": 2, "sheet_links": 14, "warnings": 1},
        )
        self.assertEqual(lines[0], "Matched folders: 2.")
        self.assertEqual(lines[1], "Sheet folder links: 14.")
        self.assertIn("Records with materials: 2.", lines)
        self.assertIn("Timeline warnings: 1.", lines)


class UniverseGapSyncTextTest(unittest.TestCase):
    def test_pr_body_and_comment_list_every_open_deal_id(self) -> None:
        import scripts.build_data as build

        status = build.universe_gap_status(
            json.loads((ROOT / "data" / "generated" / "deals.geojson").read_text())["features"]
        )
        body = sync.sync_pr_body()
        self.assertIn("Not merged.", body)
        self.assertIn("Nothing was written back to the Sheet.", body)
        if status["located_ids"]:
            self.assertIn("The check fails.", body)
        else:
            self.assertIn("Located LAS, PHX, and MIA deals without a Universe row: 0.", body)
        for deal_id in status["located_ids"]:
            self.assertIn(f"- {deal_id}", body)
        for item in status["outside"]:
            if item["deal_id"]:
                self.assertIn(f"- {item['deal_id']} ({item['city']})", body)
                self.assertNotIn(item["deal_id"], "\n".join(build.universe_gap_problems(
                    json.loads((ROOT / "data" / "generated" / "deals.geojson").read_text())["features"]
                )))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "comment.md"
            sync.write_sync_comment(path)
            comment = path.read_text()
        for deal_id in status["located_ids"]:
            self.assertIn(f"- {deal_id}", comment)
        self.assertLess(
            comment.index("Located LAS, PHX, and MIA deals without a Universe row:"),
            comment.index("Drift report"),
        )
        if status["located_ids"]:
            self.assertLess(comment.index(status["located_ids"][0]), comment.index("Drift report"))


class DriftReasonTest(unittest.TestCase):
    def test_stall_phrase_becomes_lot_too_small(self) -> None:
        import scripts.build_data as build

        self.assertEqual(build.scrub_drift_reason("Under 4 stalls fit"), "Lot too small")
        self.assertNotIn("stall", build.scrub_drift_reason("only 4 stalls fit").lower())


class ExportLimitTest(unittest.TestCase):
    def test_oversized_sheet_export_asks_for_a_real_file(self) -> None:
        def boom(url: str, token: str) -> bytes:
            if "/export?" not in url:
                return b""
            raise urllib.error.HTTPError(
                url,
                403,
                "forbidden",
                hdrs=None,
                fp=io.BytesIO(b'{"error":{"errors":[{"reason":"exportSizeLimitExceeded"}]}}'),
            )

        sync._get = boom
        with self.assertRaises(SystemExit) as raised:
            sync._download("https://www.googleapis.com/drive/v3/files/x/export?mimeType=text", "token", "universe_v3.csv")
        self.assertEqual(str(raised.exception), "Upload universe_v3.csv as a real file.")


if __name__ == "__main__":
    unittest.main()
