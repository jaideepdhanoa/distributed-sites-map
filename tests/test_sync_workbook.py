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
            {"id": "id-notes", "name": "note_rewrites.json", "mimeType": FILE},
            {"id": "id-kmz", "name": "service-area.kmz", "mimeType": FILE},
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

    def test_logs_do_not_name_skipped_files(self) -> None:
        listing = Listing(_files())
        sync._get = listing.get
        with tempfile.TemporaryDirectory() as tmp:
            sync.fetch_source_folder("token", Path(tmp))
        log = self.stdout.getvalue()
        self.assertNotIn(DECOY, log)
        self.assertNotIn("Seller files", log)
        self.assertIn("Fetched universe_v3.csv", log)
        self.assertIn("Fetched service-area.kmz", log)


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
