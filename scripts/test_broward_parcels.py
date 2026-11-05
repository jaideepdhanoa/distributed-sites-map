"""Broward folio 494111180016 is fetched from the BCPA layer and attached."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_data import build_parcels, fetch_parcel


STARS_FOLIO = "494111180016"
BROWARD_SERVICE = "PARCEL_POLY_BCPA_TAXROLL"
RING = [[-80.2273, 26.2077], [-80.2265, 26.2077], [-80.2265, 26.2082], [-80.2273, 26.2077]]


def _polygon(folio: str = STARS_FOLIO, sqft: int = 46966):
    return {
        "geometry": {"type": "Polygon", "coordinates": [RING]},
        "properties": {"FOLIO": folio, "GIS_SQUARE_FOOT": sqft, "NAME_LINE_1": "BIER & WEIN KELLER INC"},
    }


def _stars_site():
    return {
        "site_id": "MIA-U747",
        "city": "MIA",
        "origin": "universe",
        "apn": STARS_FOLIO,
        "address": "7520 MCNAB",
        "name": "Stars & Stripes",
        "lon": -80.226933,
        "lat": 26.207919,
        "counts_as_site": True,
        "in_area": True,
        "land_only": False,
        "duplicate_of": None,
    }


def _stars_deal():
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-80.227054, 26.208016]},
        "properties": {
            "deal_id": "PIPE-MIA-0080",
            "city": "MIA",
            "address": "7520 W McNab Rd",
            "apn": "",
            "name": "Stars & Stripes",
        },
    }


class BrowardParcels(unittest.TestCase):
    def test_stars_folio_is_fetched_from_broward_and_attached(self):
        calls = []

        def fake(url):
            calls.append(url)
            self.assertIn(BROWARD_SERVICE, url)
            self.assertIn("494111180016", url)
            self.assertNotIn("miamidade", url)
            return _polygon()

        with patch("build_data.http_geojson", side_effect=fake):
            feat = fetch_parcel("MIA", STARS_FOLIO, "7520 MCNAB", -80.226933, 26.207919)
        self.assertEqual(len(calls), 1)
        self.assertIn("FOLIO", calls[0])
        self.assertEqual(feat["county"], "Broward")
        self.assertEqual(feat["apn"], STARS_FOLIO)
        self.assertEqual(feat["match"], "parcel number")
        self.assertEqual(feat["acres"], 1.078)
        self.assertEqual(feat["geometry"]["type"], "Polygon")

    def test_deal_without_a_folio_matches_the_broward_pin(self):
        calls = []

        def fake(url):
            calls.append(url)
            self.assertIn(BROWARD_SERVICE, url)
            self.assertNotIn("miamidade", url)
            return _polygon()

        with patch("build_data.http_geojson", side_effect=fake):
            feat = fetch_parcel("MIA", "", "7520 W McNab Rd", -80.227054, 26.208016)
        self.assertTrue(calls)
        self.assertIn("geometry=", calls[0])
        self.assertNotIn("where=", calls[0])
        self.assertEqual(feat["match"], "pin location")
        self.assertEqual(feat["county"], "Broward")
        self.assertEqual(feat["apn"], STARS_FOLIO)

    def test_build_attaches_stars_and_does_not_skip_broward(self):
        site = _stars_site()
        deal = _stars_deal()

        def fake(url):
            self.assertIn(BROWARD_SERVICE, url)
            self.assertNotIn("miamidade", url)
            return _polygon()

        with patch("build_data.http_geojson", side_effect=fake):
            features, meta = build_parcels([site], True, [deal])
        self.assertNotIn("broward_unavailable", meta["counts"])
        self.assertEqual(meta["none_rows"], [])
        self.assertEqual(site["parcel_match"], "parcel number")
        self.assertEqual(site["parcel_acres"], 1.078)
        self.assertEqual(deal["properties"]["parcel_match"], "pin location")
        self.assertEqual(deal["properties"]["parcel_acres"], 1.078)
        by_id = {item["properties"]["site_id"]: item for item in features}
        self.assertEqual(by_id["MIA-U747"]["properties"]["county"], "Broward")
        self.assertEqual(by_id["MIA-U747"]["properties"]["match"], "parcel number")
        self.assertEqual(by_id["MIA-U747"]["properties"]["apn"], STARS_FOLIO)
        self.assertEqual(by_id["PIPE-MIA-0080"]["properties"]["match"], "pin location")
        self.assertEqual(by_id["PIPE-MIA-0080"]["geometry"]["type"], "Polygon")
        note = meta["note"]
        self.assertIn("Broward", note)
        self.assertNotIn("broward_unavailable", note)

    def test_a_broward_miss_is_not_marked_unavailable(self):
        site = _stars_site()
        site["site_id"] = "MIA-U1115"
        site["address"] = "8881 Pembroke Rd"
        site["apn"] = "514121240030"
        site["lat"] = 25.994736
        calls = []

        def fake(url):
            calls.append(url)
            return None

        with patch("build_data.http_geojson", side_effect=fake):
            features, meta = build_parcels([site], True, [])
        self.assertNotIn("broward_unavailable", meta["counts"])
        self.assertEqual(meta["counts"].get("not_found"), 1)
        self.assertEqual(features, [])
        self.assertEqual(site["parcel_match"], "none")
        self.assertTrue(any(BROWARD_SERVICE in url for url in calls))
        self.assertEqual(meta["none_rows"][0]["reason"], "no parcel at this pin")

    def test_clark_and_miami_dade_parcel_numbers_stay_on_their_layers(self):
        def clark(url):
            self.assertIn("CC_PARCELS_SHP", url)
            self.assertNotIn(BROWARD_SERVICE, url)
            return {
                "geometry": {"type": "Polygon", "coordinates": [RING]},
                "properties": {"PARCEL": "13813601019", "ASSR_ACRES": 2, "OWNER": "Example"},
            }

        with patch("build_data.http_geojson", side_effect=clark):
            feat = fetch_parcel("LAS", "13813601019", "2901 N Rancho Dr", -115.2, 36.2)
        self.assertEqual(feat["county"], "Clark")
        self.assertEqual(feat["match"], "parcel number")

        def dade(url):
            self.assertIn("miamidade.gov", url)
            self.assertNotIn(BROWARD_SERVICE, url)
            return {
                "geometry": {"type": "Polygon", "coordinates": [RING]},
                "properties": {"FOLIO": "0132180330070", "TRUE_OWNER1": "Example", "LOT_SIZE": 43560, "DOR_DESC": "Store"},
            }

        with patch("build_data.http_geojson", side_effect=dade):
            feat = fetch_parcel("MIA", "0132180330070", "1650 NW 87 Ave, Miami, FL", -80.33, 25.78)
        self.assertEqual(feat["county"], "Miami-Dade")
        self.assertEqual(feat["match"], "parcel number")
        self.assertEqual(feat["acres"], 1.0)


if __name__ == "__main__":
    unittest.main()
