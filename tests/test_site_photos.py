"""Site Photos tab join, summary columns, and the public photo payload."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.key_numbers import key_figures
from scripts.site_photos import (
    cache_map_images,
    cached_view_url,
    index_photos,
    is_direct_image_url,
    is_pano_url,
    load_site_photos,
    photo_asset_key,
    photo_fields,
    photo_summary,
)


FILE_ID = "1Ut6cymlK5at0_Cte8awd109tRnBBzcOM"
PANO = "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=33.306,-111.841"
THUMB = f"https://drive.google.com/thumbnail?id={FILE_ID}&sz=w1600"
STILL = "https://maps.googleapis.com/maps/api/streetview?size=600x400&location=33.3,-111.8"


def _book(path: Path, sheets: dict[str, list[list]]) -> None:
    wb = openpyxl.Workbook()
    first = True
    for name, rows in sheets.items():
        ws = wb.active if first else wb.create_sheet(name)
        first = False
        ws.title = name
        for row in rows:
            ws.append(row)
    wb.save(path)


class PhotoContract(unittest.TestCase):
    def test_missing_or_empty_tab_is_an_empty_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            _book(path, {"Pipeline": [["Site ID"], ["PIPE-PHX-0001"]]})
            self.assertEqual(load_site_photos(path), [])
            _book(path, {"Site Photos": [["Site ID", "Sheet", "Role", "Visibility"]]})
            self.assertEqual(load_site_photos(path), [])
            self.assertEqual(load_site_photos(Path(tmp) / "absent.xlsx"), [])

    def test_headers_bind_by_name_and_drive_only_rows_drop(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            _book(
                path,
                {
                    "Site Photos": [[
                        "Visibility",
                        "Caption",
                        "View URL",
                        "Drive file ID",
                        "Role",
                        "Sheet",
                        "Site ID",
                        "Source",
                        "Attribution",
                        "As-of",
                    ], [
                        "map",
                        "North lot",
                        THUMB,
                        FILE_ID,
                        "lot_aerial",
                        "Pipeline",
                        "pipe-phx-0001",
                        "esri_world_imagery",
                        "Esri, Maxar",
                        "2026-11-06",
                    ], [
                        "drive_only",
                        "Hidden",
                        THUMB,
                        "1HiddenFileIdxxxxxxxxxx",
                        "listing",
                        "Pipeline",
                        "PIPE-PHX-0001",
                        "broker_listing",
                        "",
                        "",
                    ]],
                },
            )
            rows = load_site_photos(path)
            self.assertEqual(len(rows), 2)
            photos = index_photos(rows)["PIPE-PHX-0001"]
            self.assertEqual(len(photos), 1)
            self.assertEqual(photos[0]["role"], "lot_aerial")
            self.assertEqual(photos[0]["attribution"], "Esri, Maxar")
            self.assertEqual(photos[0]["as_of"], "2026-11-06")
            self.assertTrue(is_direct_image_url(THUMB))
            self.assertFalse(is_direct_image_url(STILL))
            self.assertTrue(is_pano_url(PANO))
            self.assertFalse(is_pano_url(STILL))

    def test_order_frontage_and_rejected_stills(self) -> None:
        rows = [
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "listing", "Source": "broker_listing", "View URL": THUMB, "Drive file ID": FILE_ID, "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "electrical", "Source": "site_visit", "View URL": THUMB, "Drive file ID": "1electricalfileidXXXX", "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "street_level", "Source": "other", "View URL": "https://images.example/front.jpg", "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "street_level", "Source": "google_street_view", "View URL": STILL, "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "building", "Source": "other", "View URL": "https://images.example/building.jpg", "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "street_frontage", "Source": "google_street_view", "View URL": STILL, "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "street_frontage", "Source": "google_street_view", "View URL": PANO, "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "lot_aerial", "Source": "google_street_view", "View URL": STILL, "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "access_spare", "Source": "site_visit", "Drive file ID": "1accesssparefileidXX", "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Pipeline", "Role": "spare_land_annotated", "Source": "esri_world_imagery", "View URL": THUMB, "Drive file ID": "1sparelandfileidXXXX", "Visibility": "map", "Caption": "Open ground beside the power room"},
            {"Site ID": "PIPE-PHX-0001", "Sheet": "Land Sites", "Role": "listing", "Source": "broker_listing", "View URL": THUMB, "Drive file ID": "1wrongsheetfileidXXX", "Visibility": "map"},
            {"Site ID": "LAND-PHX-0002", "Sheet": "Land Sites", "Role": "lot_aerial", "Source": "esri_world_imagery", "View URL": "https://drive.google.com/file/d/1fromfolderlinkXXXX/view", "Visibility": "map"},
        ]
        grouped = index_photos(rows)
        fields = photo_fields({"Photo status": "Partial", "Diligence photo count": 2, "Listing photo count": 4}, "pipeline", "PIPE-PHX-0001", grouped)
        roles = [photo["role"] for photo in fields["photos"]]
        self.assertEqual(
            roles,
            ["spare_land_annotated", "access_spare", "building", "street_level", "electrical", "listing", "street_frontage"],
        )
        self.assertEqual(fields["photos"][0]["caption"], "Open ground beside the power room")
        self.assertNotIn("file_id", fields["photos"][0])
        self.assertNotIn("drive.google.com", json.dumps(fields))
        self.assertEqual(fields["street_view_url"], PANO)
        self.assertEqual(fields["photo_status"], "Partial")
        self.assertEqual(fields["photo_diligence_count"], 2)
        self.assertEqual(fields["photo_listing_count"], 4)
        land = photo_fields({}, "land", "LAND-PHX-0002", grouped)
        self.assertNotIn("file_id", land["photos"][0])
        self.assertNotIn("view_url", land["photos"][0])
        self.assertEqual(photo_summary({"Photo status": "", "Diligence photo count": None}), {
            "photo_status": "",
            "photo_diligence_count": None,
            "photo_listing_count": None,
            "photos_checked": "",
            "photo_notes": "",
        })

    def test_deferred_ships_no_gallery(self) -> None:
        grouped = index_photos([
            {"Site ID": "PIPE-PHX-0009", "Sheet": "Pipeline", "Role": "lot_aerial", "Source": "esri_world_imagery", "View URL": THUMB, "Drive file ID": FILE_ID, "Visibility": "map"},
            {"Site ID": "PIPE-PHX-0009", "Sheet": "Pipeline", "Role": "street_frontage", "Source": "google_street_view", "View URL": PANO, "Visibility": "map"},
        ])
        fields = photo_fields({"Photo status": "Deferred"}, "pipeline", "PIPE-PHX-0009", grouped)
        self.assertEqual(fields["photos"], [])
        self.assertEqual(fields["photo_status"], "Deferred")
        self.assertNotIn("street_view_url", fields)

    def test_spare_area_is_unchanged_by_photo_columns(self) -> None:
        row = {"Spare area (sq ft)": 104100, "Photo status": "Complete", "Diligence photo count": 3, "Listing photo count": 8}
        self.assertEqual(key_figures(row, "land")["open_land_sqft"], 104100)

    def test_deal_layer_joins_photos_and_keeps_the_folder(self) -> None:
        from scripts import build_data

        stars = "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ"
        pipeline = {
            "Site": "MIA folder check",
            "Market": "MIA",
            "Name": "Stars",
            "Stage": "2 Financial screen",
            "Site ID": "PIPE-MIA-0080",
            "Folder": stars,
            "APN or folio": "514201001",
            "Segment": "Car wash",
            "Spare area (sq ft)": 18000,
            "Photo status": "Partial",
            "Diligence photo count": 2,
            "Listing photo count": 1,
            "_excel_row": 5,
        }
        sites = [
            {"site_id": "MIA-U747", "origin": "universe", "city": "MIA", "apn": "514201001", "address": "", "name": "", "listed": False, "street_view_url": "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=26.2,-80.2"},
        ]
        photo_rows = [
            {"Site ID": "PIPE-MIA-0080", "Sheet": "Pipeline", "Role": "lot_aerial", "Source": "esri_world_imagery", "View URL": THUMB, "Drive file ID": FILE_ID, "Visibility": "map", "Attribution": "Esri", "Caption": "Lot"},
            {"Site ID": "PIPE-MIA-0080", "Sheet": "Pipeline", "Role": "street_frontage", "Source": "google_street_view", "View URL": PANO, "Visibility": "map"},
            {"Site ID": "PIPE-MIA-0080", "Sheet": "Pipeline", "Role": "listing", "Source": "broker_listing", "View URL": THUMB, "Drive file ID": "1listingfileidXXXXXX", "Visibility": "drive_only"},
        ]
        old_cache = build_data.GEOCODE_CACHE
        with tempfile.TemporaryDirectory() as tmp:
            build_data.GEOCODE_CACHE = Path(tmp) / "geocode.json"
            try:
                deals, _report = build_data.build_deal_layer([pipeline], [], sites, [], photo_rows=photo_rows)
            finally:
                build_data.GEOCODE_CACHE = old_cache
        props = deals["features"][0]["properties"]
        self.assertEqual(props["folder_url"], stars)
        self.assertEqual(props["open_land_sqft"], 18000)
        self.assertEqual([photo["role"] for photo in props["photos"]], ["lot_aerial", "street_frontage"])
        self.assertEqual(props["street_view_url"], PANO)
        self.assertEqual(props["photo_status"], "Partial")
        self.assertEqual(sites[0]["photos"], props["photos"])
        self.assertEqual(sites[0]["street_view_url"], PANO)
        self.assertEqual(sites[0]["photo_diligence_count"], 2)

        with tempfile.TemporaryDirectory() as tmp:
            build_data.GEOCODE_CACHE = Path(tmp) / "geocode.json"
            bare = [dict(sites[0])]
            bare[0].pop("photos", None)
            bare[0]["street_view_url"] = "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=26.2,-80.2"
            try:
                empty, _report = build_data.build_deal_layer([pipeline], [], bare, [], photo_rows=[])
            finally:
                build_data.GEOCODE_CACHE = old_cache
        self.assertEqual(empty["features"][0]["properties"]["photos"], [])
        self.assertEqual(empty["features"][0]["properties"]["photo_status"], "Partial")
        self.assertNotIn("street_view_url", empty["features"][0]["properties"])
        self.assertEqual(bare[0]["photos"], [])
        self.assertTrue(bare[0]["street_view_url"].startswith("https://www.google.com/maps/"))

    def test_cached_image_is_same_origin_and_hides_the_drive_id(self) -> None:
        grouped = index_photos([
            {
                "Site ID": "PIPE-PHX-0001",
                "Sheet": "Pipeline",
                "Role": "lot_aerial",
                "Source": "esri_world_imagery",
                "View URL": THUMB,
                "Drive file ID": FILE_ID,
                "Visibility": "map",
                "Attribution": "Esri",
            }
        ])
        key = photo_asset_key(FILE_ID)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / f"{key}.jpg").write_bytes(b"\xff\xd8\xff\xd9")
            fields = photo_fields({}, "pipeline", "PIPE-PHX-0001", grouped, photo_dir=folder)
            self.assertEqual(fields["photos"][0]["view_url"], f"/api/data/photos/{key}.jpg")
            self.assertEqual(cached_view_url(FILE_ID, folder), f"/api/data/photos/{key}.jpg")
            blob = json.dumps(fields)
            self.assertNotIn(FILE_ID, blob)
            self.assertNotIn("drive.google.com", blob)
            self.assertNotIn("googleusercontent.com", blob)

    def test_cache_skips_frontage_and_keeps_an_existing_file(self) -> None:
        def boom(_token, _file_id):
            return b"\xff\xd8\xff\xd9", "image/jpeg"

        book_rows = [
            ["Site ID", "Sheet", "Role", "Source", "Drive file ID", "View URL", "Visibility"],
            ["PIPE-PHX-0001", "Pipeline", "lot_aerial", "esri_world_imagery", FILE_ID, THUMB, "map"],
            ["PIPE-PHX-0001", "Pipeline", "street_frontage", "google_street_view", "", PANO, "map"],
            ["PIPE-PHX-0001", "Pipeline", "listing", "broker_listing", FILE_ID, THUMB, "drive_only"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.xlsx"
            dest = Path(tmp) / "photos"
            _book(path, {"Site Photos": book_rows})
            import scripts.site_photos as photos

            original = photos._drive_media
            photos._drive_media = boom
            try:
                report = cache_map_images("token", path, dest)
            finally:
                photos._drive_media = original
            self.assertEqual(report["saved"], 1)
            self.assertEqual(report["failed"], 0)
            self.assertTrue((dest / f"{photo_asset_key(FILE_ID)}.jpg").is_file())
            again = cache_map_images("token", path, dest)
            self.assertEqual(again["skipped"], 1)
            self.assertEqual(again["saved"], 0)
            self.assertNotIn("token", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
