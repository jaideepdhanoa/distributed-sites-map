"""Checks for the review fixes: listings, one matcher, stages, and the unscreened layer."""

import csv
import json
import unittest
from pathlib import Path

from build_data import (
    classify_register_row,
    match_workbook_site,
    stage_group,
    universe_gap_lines,
    universe_gap_problems,
    universe_gap_status,
    universe_link_gap,
    universe_match_index,
)


ROOT = Path(__file__).resolve().parents[1]


class StageBuckets(unittest.TestCase):
    def test_workbook_stages(self):
        self.assertEqual(stage_group("1 Desk screen"), "desk")
        self.assertEqual(stage_group("2 Financial screen"), "financial")
        self.assertEqual(stage_group("3 Site checks"), "checks")
        self.assertEqual(stage_group("4 Offer and close"), "close")
        self.assertEqual(stage_group("Dropped"), "dropped")
        self.assertNotEqual(stage_group("2 Financial screen"), "contacted")


class OneMatcher(unittest.TestCase):
    def test_street_wins_when_the_parcel_points_elsewhere(self):
        sites = [
            {"site_id": "MIA-U747", "city": "MIA", "origin": "universe", "apn": "494111180016", "address": "7520 MCNAB", "name": "Stars & Stripes"},
            {"site_id": "MIA-U1206", "city": "MIA", "origin": "universe", "apn": "494232060480", "address": "1080 NW 31st Ave", "name": "M Car Wash"},
        ]
        by_apn, by_street = universe_match_index(sites)
        found = match_workbook_site("MIA", "494232060480", "MIA 7520 W McNab Rd", by_apn, by_street)
        self.assertEqual(found, "MIA-U747")

    def test_parcel_match_when_the_street_is_missing(self):
        sites = [
            {"site_id": "PHX-U229", "city": "PHX", "origin": "universe", "apn": "12472201", "address": "1406 W University Dr", "name": "3 Minute"},
        ]
        by_apn, by_street = universe_match_index(sites)
        found = match_workbook_site("PHX", "124-72-201", "University Dr & Priest Dr, Tempe", by_apn, by_street)
        self.assertEqual(found, "PHX-U229")


class RegisterLayer(unittest.TestCase):
    def test_live_in_area_rows_are_kept_and_the_rest_are_not(self):
        self.assertEqual(classify_register_row({"flow": "Listing", "funnel_stage": "Captured", "listing_status": "", "address": "Pembroke Pines (approx 26.0,-80.2; address withheld)"}, False), "pin")
        self.assertEqual(classify_register_row({"flow": "Listing", "funnel_stage": "Captured", "listing_status": "Active", "address": "Phoenix, AZ (address withheld)"}, False), "list")
        self.assertEqual(classify_register_row({"flow": "Off-market", "funnel_stage": "Off-market target", "listing_status": "Off-market", "address": "x"}, False), "skip")
        self.assertEqual(classify_register_row({"flow": "Listing", "funnel_stage": "Knocked out", "ko_reason": "KO — tenure", "listing_status": "Listed", "address": "1 Main"}, False), "skip")
        self.assertEqual(classify_register_row({"flow": "Listing", "funnel_stage": "Routed to category register", "listing_status": "Active", "address": "1 Main"}, False), "skip")
        self.assertEqual(classify_register_row({"flow": "Listing", "funnel_stage": "Captured", "match_status": "duplicate of L-009", "listing_status": "Active", "address": "1 Main"}, False), "skip")
        self.assertEqual(classify_register_row({"flow": "Listing", "funnel_stage": "Captured", "listing_status": "Listed", "next_step": "Crexi listing GONE Nov 4 — treat as withdrawn", "address": "3930 E Baseline Rd"}, False), "skip")
        self.assertEqual(classify_register_row({"flow": "Listing", "funnel_stage": "Captured", "listing_status": "Active", "address": "7520 W McNab Rd"}, True), "skip")


class BrokerContactDates(unittest.TestCase):
    def test_internal_rows_count_as_a_date_and_their_text_does_not_ship(self):
        import tempfile

        import openpyxl

        from timeline_activity import broker_contact_dates

        book = openpyxl.Workbook()
        sheet = book.active
        sheet.title = "Activity"
        sheet.append(["Event ID", "Date", "Site ID", "Site label", "Type", "Direction", "Counterparty role", "Outcome", "Summary", "Visibility"])
        sheet.append(["A-1", "2026-11-01", "PIPE-PHX-0001", "label", "email", "internal", "broker", "sent", "secret message 555-0100", "internal"])
        sheet.append(["A-2", "2026-11-04", "PIPE-PHX-0001", "label", "email", "out", "broker", "sent", "later secret", "Map"])
        sheet.append(["A-3", "2026-11-05", "PIPE-PHX-0009", "label", "email", "in", "broker", "received", "inbound stays out", "Map"])
        folder = Path(tempfile.mkdtemp())
        path = folder / "book.xlsx"
        book.save(path)
        dates = broker_contact_dates(path, {"activity": {"sheet": "Activity", "headerRow": 1}})
        self.assertEqual(dates, {"PIPE-PHX-0001": "2026-11-04"})
        blob = json.dumps(dates)
        self.assertNotIn("secret", blob)
        self.assertNotIn("555", blob)


class ShippedCounts(unittest.TestCase):
    def test_listed_flags_links_and_unscreened_layer(self):
        sites = json.loads((ROOT / "data/generated/sites.geojson").read_text())["features"]
        deals = json.loads((ROOT / "data/generated/deals.geojson").read_text())["features"]
        layer = json.loads((ROOT / "data/generated/unscreened.geojson").read_text())["features"]
        false_listed = {"PHX-U189", "PHX-U234", "PHX-U359", "PHX-U371", "PHX-U372", "PHX-U462", "LAS-U813", "LAS-U852"}
        by_id = {item["properties"]["site_id"]: item["properties"] for item in sites}
        for sid in false_listed:
            self.assertFalse(by_id[sid]["listed"], sid)
        def in_area_listed(props: dict) -> bool:
            return bool(
                props.get("origin") == "universe"
                and props.get("counts_as_site")
                and not props.get("duplicate_of")
                and props.get("in_area")
                and not props.get("land_only")
                and props.get("listed")
            )

        listed = [item["properties"] for item in sites if in_area_listed(item["properties"])]
        self.assertTrue(listed)
        self.assertTrue(all(props.get("city") in {"LAS", "PHX", "MIA"} for props in listed))
        listed_ids = {props["site_id"] for props in listed}
        self.assertTrue(false_listed.isdisjoint(listed_ids))
        stars = next(item["properties"] for item in deals if item["properties"]["deal_id"] == "PIPE-MIA-0080")
        self.assertEqual(stars["folder_url"], "https://drive.google.com/drive/folders/1xv4HiB8wZ7MVatRBfquRLScog4nByhqQ")
        self.assertEqual(by_id["MIA-U747"]["folder_url"], stars["folder_url"])
        self.assertEqual(stars["universe_id"], "MIA-U747")
        self.assertEqual(stars["stage_group"], "financial")
        self.assertTrue(stars["broker_contacted"])
        self.assertEqual(by_id["MIA-U747"]["linked_deal_id"], "PIPE-MIA-0080")
        self.assertEqual(by_id["LAS-U943"]["linked_deal_id"], "LAND-LAS-0001")
        pinned = sorted(item["properties"]["listing_id"] for item in layer if item.get("geometry"))
        withheld = sorted(item["properties"]["listing_id"] for item in layer if not item.get("geometry"))
        self.assertEqual(pinned, ["L-013", "L-236", "L-239"])
        self.assertEqual(withheld, ["L-214", "L-215", "L-216", "L-221", "L-233"])
        with (ROOT / "data/drift_report.csv").open(newline="", encoding="utf-8") as handle:
            drift_rows = list(csv.DictReader(handle))
        leads = [row["lead id"] for row in drift_rows]
        known_ids = {item["properties"]["deal_id"] for item in deals} | set(by_id)
        self.assertEqual(len(leads), len(set(leads)))
        self.assertTrue(leads)
        self.assertTrue(all(lead in known_ids for lead in leads))
        by_lead = {row["lead id"]: row for row in drift_rows}
        self.assertEqual(by_lead["LAND-PHX-0003"]["workbook Stage"], "Financial screen")
        self.assertEqual(by_lead["LAND-PHX-0003"]["KO reason"], "Outside the service area")
        self.assertEqual(by_lead["LAND-PHX-0003"]["rule applied"], "R-042")
        self.assertEqual(by_lead["LAS-U119"]["map stage"], "not listed")
        self.assertIn("off-market", by_lead["LAS-U119"]["KO reason"])
        gap = universe_link_gap(deals)
        linked = 0
        unlocated = 0
        for feature in deals:
            props = feature["properties"]
            if props.get("kind") not in {"pipeline", "land"}:
                continue
            if str(props.get("universe_id") or "").strip():
                linked += 1
            elif not (feature.get("geometry") or {}).get("coordinates"):
                unlocated += 1
        self.assertEqual(gap["linked"], linked)
        self.assertGreater(linked, 0)
        self.assertEqual(gap["unlocated_without_universe"], unlocated)
        if universe_gap_status(deals)["located_ids"]:
            self.assertTrue(universe_gap_problems(deals))
        else:
            self.assertEqual(universe_gap_problems(deals), [])
        deal_by_id = {item["properties"]["deal_id"]: item["properties"] for item in deals}
        phoenix_land = deal_by_id["LAND-PHX-0033"]
        if str(phoenix_land.get("universe_id") or "").strip():
            self.assertIn(phoenix_land["city"], {"LAS", "PHX", "MIA"})
        else:
            self.assertNotIn(phoenix_land["city"], {"LAS", "PHX", "MIA"})
        self.assertEqual(
            deal_by_id["LAND-PHX-0033"]["listing_url"],
            "https://www.loopnet.com/Listing/5020-S-16th-St-Phoenix-AZ/39334803/",
        )
        self.assertEqual(deal_by_id["LAND-PHX-0033"]["open_land_sqft"], 25700)
        self.assertEqual(deal_by_id["LAND-PHX-0033"]["bays_that_fit"], 55)
        portland = next(item for item in deals if item["properties"]["deal_id"] == "LAND-PHX-0050")
        self.assertEqual(portland["geometry"], {"type": "Point", "coordinates": [-112.04595, 33.4611]})
        self.assertEqual(portland["properties"]["coord_status"], "listing")
        self.assertEqual(portland["properties"]["listing_url"], "")
        self.assertEqual(portland["properties"]["universe_id"], "WB-PHX-0030")
        self.assertEqual(deal_by_id["LAND-PHX-0050"]["bays_that_fit"], 118)
        self.assertEqual(deal_by_id["LAND-PHX-0050"]["open_land_sqft"], 55000)
        self.assertEqual(deal_by_id["LAND-PHX-0050"]["asking_price"], 1250000)
        by_apn, by_street = universe_match_index([item["properties"] for item in sites])
        for entry in gap["located_missing"]:
            row = deal_by_id[entry["deal_id"]]
            self.assertIsNone(
                match_workbook_site(row["city"], "", row.get("address") or "", by_apn, by_street),
                entry["deal_id"],
            )
            self.assertTrue(row.get("address") or row.get("name"))


class UniverseGapGate(unittest.TestCase):
    def _deals(self):
        return json.loads((ROOT / "data/generated/deals.geojson").read_text())["features"]

    def _point(self, deal_id, city, universe_id="", coordinates=None):
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": coordinates or [-112.0, 33.4]},
            "properties": {"kind": "pipeline", "deal_id": deal_id, "city": city, "universe_id": universe_id},
        }

    def test_committed_gap_fails_only_for_covered_markets(self):
        deals = self._deals()
        status = universe_gap_status(deals)
        problems = universe_gap_problems(deals)
        text = "\n".join(universe_gap_lines(deals))
        blob = "\n".join(problems)
        for deal_id in status["located_ids"]:
            self.assertIn(deal_id, blob)
            self.assertIn(f"- {deal_id}", text)
        for item in status["outside"]:
            if item["deal_id"]:
                self.assertNotIn(item["deal_id"], blob)
                self.assertIn(item["deal_id"], text)
        if status["located_ids"]:
            self.assertIn("The check fails.", text)
        else:
            self.assertEqual(problems, [])
            self.assertIn("Located LAS, PHX, and MIA deals without a Universe row: 0.", text)

    def test_sna_alone_does_not_fail(self):
        features = [self._point("PIPE-SNA-0002", "SNA", coordinates=[-117.9, 33.65])]
        self.assertEqual(universe_gap_problems(features), [])
        text = "\n".join(universe_gap_lines(features))
        self.assertIn("Located LAS, PHX, and MIA deals without a Universe row: 0.", text)
        self.assertIn("- PIPE-SNA-0002 (SNA)", text)
        self.assertNotIn("The check fails.", text)

    def test_any_covered_market_deal_without_a_row_is_named(self):
        features = [self._point("PIPE-PHX-9999", "PHX"), self._point("PIPE-SNA-0002", "SNA", coordinates=[-117.9, 33.65])]
        problems = universe_gap_problems(features)
        self.assertEqual(len(problems), 1)
        self.assertIn("PIPE-PHX-9999", problems[0])
        self.assertNotIn("PIPE-SNA-0002", problems[0])
        text = "\n".join(universe_gap_lines(features))
        self.assertTrue(text.startswith("Located LAS, PHX, and MIA deals without a Universe row: 1. The check fails."))
        self.assertIn("- PIPE-PHX-9999", text)
        self.assertIn("- PIPE-SNA-0002 (SNA)", text)

    def test_a_linked_deal_passes(self):
        features = [self._point("LAND-PHX-0002", "PHX", universe_id="PHX-U1")]
        self.assertEqual(universe_gap_problems(features), [])
        self.assertIn(
            "Located LAS, PHX, and MIA deals without a Universe row: 0.",
            "\n".join(universe_gap_lines(features)),
        )

    def test_one_open_covered_market_id_fails_with_no_exception(self):
        features = [self._point("LAND-PHX-0002", "PHX")]
        problems = universe_gap_problems(features)
        self.assertEqual(len(problems), 1)
        self.assertIn("LAND-PHX-0002", problems[0])
        self.assertIn("- LAND-PHX-0002", "\n".join(universe_gap_lines(features)))

    def test_a_deal_id_does_not_invent_a_covered_market(self):
        features = [self._point("LAND-PHX-0043", "UNK", coordinates=[-112.1, 33.49])]
        self.assertEqual(universe_gap_problems(features), [])
        text = "\n".join(universe_gap_lines(features))
        self.assertIn("- LAND-PHX-0043 (UNK)", text)
        self.assertIn("Located LAS, PHX, and MIA deals without a Universe row: 0.", text)

    def test_an_unlocated_deal_stays_out_of_the_gate(self):
        features = [
            {
                "type": "Feature",
                "geometry": None,
                "properties": {"kind": "pipeline", "deal_id": "PIPE-PHX-9998", "city": "PHX", "universe_id": ""},
            }
        ]
        self.assertEqual(universe_gap_problems(features), [])
        text = "\n".join(universe_gap_lines(features))
        self.assertNotIn("PIPE-PHX-9998", text)
        self.assertIn("Located LAS, PHX, and MIA deals without a Universe row: 0.", text)

    def test_a_blank_deal_id_in_a_covered_market_fails(self):
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-80.2, 26.0]},
                "properties": {"kind": "land", "deal_id": "  ", "city": "MIA", "universe_id": ""},
            }
        ]
        problems = universe_gap_problems(features)
        self.assertTrue(any("no deal id" in item for item in problems))

    def test_a_blank_deal_id_outside_the_covered_markets_does_not_fail(self):
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-117.9, 33.65]},
                "properties": {"kind": "pipeline", "deal_id": "  ", "city": "SNA", "universe_id": ""},
            }
        ]
        self.assertEqual(universe_gap_problems(features), [])


if __name__ == "__main__":
    unittest.main()
