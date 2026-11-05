"""Checks for the review fixes: listings, one matcher, stages, and the unscreened layer."""

import json
import unittest
from pathlib import Path

from build_data import (
    classify_register_row,
    match_workbook_site,
    stage_group,
    load_universe_gap_baseline,
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
        listed = []
        for item in sites:
            props = item["properties"]
            if props.get("origin") == "universe" and props.get("counts_as_site") and not props.get("duplicate_of") and props.get("in_area") and not props.get("land_only") and props.get("listed"):
                listed.append(props["city"])
        from collections import Counter
        self.assertEqual(dict(Counter(listed)), {"PHX": 4, "LAS": 6, "MIA": 9})
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
        drift = (ROOT / "data/drift_report.csv").read_text().splitlines()
        leads = [line.split(",", 1)[0] for line in drift[1:] if line.strip()]
        self.assertEqual(leads, ["PIPE-LAS-0073", "PIPE-PHX-0081", "LAS-U119"])
        gap = universe_link_gap(deals)
        self.assertGreaterEqual(gap["linked"], 21)
        self.assertEqual(universe_gap_problems(deals), [])
        self.assertEqual(gap["unlocated_without_universe"], 13)
        by_apn, by_street = universe_match_index([item["properties"] for item in sites])
        deal_by_id = {item["properties"]["deal_id"]: item["properties"] for item in deals}
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

    def test_committed_located_deals_stay_on_the_allowlist(self):
        deals = self._deals()
        status = universe_gap_status(deals)
        self.assertEqual(universe_gap_problems(deals), [])
        self.assertEqual(status["new_ids"], [])
        self.assertEqual(status["baseline_count"], 36)
        self.assertLessEqual(set(status["located_ids"]), set(status["baseline_ids"]))
        text = "\n".join(universe_gap_lines(deals))
        for deal_id in status["located_ids"]:
            self.assertIn(f"- {deal_id}", text)
        self.assertIn("No new located deal is missing a Universe row.", text)
        self.assertNotIn("NEW located deals", text)

    def test_a_new_located_deal_is_named(self):
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-112.0, 33.4]},
                "properties": {"kind": "pipeline", "deal_id": "PIPE-PHX-9999", "universe_id": ""},
            }
        ]
        problems = universe_gap_problems(features)
        self.assertEqual(len(problems), 1)
        self.assertIn("PIPE-PHX-9999", problems[0])
        self.assertIn("universe_gap_baseline.json", problems[0])
        text = "\n".join(universe_gap_lines(features))
        self.assertTrue(text.startswith("NEW located deals without a Universe row: 1."))
        self.assertLess(text.index("PIPE-PHX-9999"), text.index("Deal ids still located"))

    def test_a_swap_fails_when_the_count_stays_the_same(self):
        baseline, problems = load_universe_gap_baseline()
        self.assertEqual(problems, [])
        self.assertGreaterEqual(len(baseline), 1)
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-112.0, 33.4]},
                "properties": {"kind": "pipeline", "deal_id": deal_id, "universe_id": ""},
            }
            for deal_id in baseline[1:]
        ]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-112.1, 33.5]},
                "properties": {"kind": "pipeline", "deal_id": "PIPE-NEW-0001", "universe_id": ""},
            }
        )
        status = universe_gap_status(features)
        self.assertEqual(len(status["located_ids"]), len(baseline))
        self.assertEqual(status["new_ids"], ["PIPE-NEW-0001"])
        self.assertTrue(any("PIPE-NEW-0001" in item for item in universe_gap_problems(features)))

    def test_clearing_a_listed_id_passes(self):
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-112.0, 33.4]},
                "properties": {"kind": "land", "deal_id": "LAND-PHX-0002", "universe_id": "PHX-U1"},
            }
        ]
        self.assertEqual(universe_gap_problems(features), [])

    def test_one_remaining_backlog_id_passes(self):
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-112.0, 33.4]},
                "properties": {"kind": "land", "deal_id": "LAND-PHX-0002", "universe_id": ""},
            }
        ]
        self.assertEqual(universe_gap_problems(features), [])
        self.assertIn("LAND-PHX-0002", "\n".join(universe_gap_lines(features)))

    def test_an_unlocated_deal_stays_out_of_the_gate(self):
        features = [
            {
                "type": "Feature",
                "geometry": None,
                "properties": {"kind": "pipeline", "deal_id": "PIPE-PHX-9998", "universe_id": ""},
            }
        ]
        self.assertEqual(universe_gap_problems(features), [])
        text = "\n".join(universe_gap_lines(features))
        self.assertNotIn("PIPE-PHX-9998", text)
        self.assertIn("- none", text)

    def test_a_blank_deal_id_fails(self):
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-80.2, 26.0]},
                "properties": {"kind": "land", "deal_id": "  ", "universe_id": ""},
            }
        ]
        problems = universe_gap_problems(features)
        self.assertTrue(any("no deal id" in item for item in problems))


if __name__ == "__main__":
    unittest.main()
