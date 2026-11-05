"""Counts in the changes note come from the previous published build."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_data import summarize_changes


class ChangeCounts(unittest.TestCase):
    def test_verdicts_stages_and_new_sites(self):
        old_sites = [
            {"properties": {"site_id": "A", "verdict": "PASS", "pipeline_stage": "1 Desk screen"}},
            {"properties": {"site_id": "B", "verdict": "MAYBE", "pipeline_stage": "1 Desk screen"}},
        ]
        new_sites = [
            {"site_id": "A", "verdict": "MAYBE", "pipeline_stage": "Dropped"},
            {"site_id": "B", "verdict": "MAYBE", "pipeline_stage": "1 Desk screen"},
            {"site_id": "C", "verdict": "PASS", "pipeline_stage": None},
        ]
        old_deals = [{"properties": {"deal_id": "D1", "stage": "1 Desk screen"}}]
        new_deals = [{"properties": {"deal_id": "D1", "stage": "Dropped (not enough spare land)"}}]
        changes = summarize_changes(old_sites, new_sites, old_deals, new_deals)
        self.assertEqual(changes["new_sites"], 1)
        self.assertEqual(changes["removed_sites"], 0)
        self.assertEqual(changes["verdict_changes"], 1)
        self.assertEqual(changes["stage_moves"], 2)
        self.assertEqual(changes["sample_verdicts"][0]["site_id"], "A")

    def test_real_head_file_is_the_baseline(self):
        from build_data import published_features

        published = published_features("data/generated/sites.geojson")
        self.assertTrue(published)
        changed = []
        flipped = False
        for item in published:
            props = dict((item.get("properties") or {}))
            if not flipped and props.get("site_id"):
                props["verdict"] = "FAIL" if props.get("verdict") != "FAIL" else "PASS"
                flipped = True
            changed.append(props)
        changes = summarize_changes(published, changed, [], [])
        self.assertEqual(changes["new_sites"], 0)
        self.assertEqual(changes["verdict_changes"], 1)

    def test_repeat_build_against_the_same_published_file_is_zero(self):
        published = [{"properties": {"site_id": "A", "verdict": "PASS", "pipeline_stage": "1 Desk screen"}}]
        again = [{"site_id": "A", "verdict": "PASS", "pipeline_stage": "1 Desk screen"}]
        changes = summarize_changes(published, again, [], [])
        self.assertEqual(changes["new_sites"], 0)
        self.assertEqual(changes["verdict_changes"], 0)
        self.assertEqual(changes["stage_moves"], 0)


from test_broward_parcels import BrowardParcels  # noqa: E402,F401
from test_review_fixes import BrokerContactDates, OneMatcher, RegisterLayer, ShippedCounts, StageBuckets  # noqa: E402,F401

if __name__ == "__main__":
    unittest.main()
