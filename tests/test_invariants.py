"""Generated files stay consistent when the workbook changes.

Counts are read from the files. Nothing here pins a desk total, a comms total,
or one site's stage.
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import stage_group
from scripts.vocabulary import known_market, known_stage

GENERATED = ROOT / "data" / "generated"
SITEISH = re.compile(r"^(?:PIPE|LAND|WB)-[A-Z]{2,4}-\d{4}$|[A-Z]{2,4}-U\d+\b")


def _load(name: str):
    return json.loads((GENERATED / name).read_text())


class GeneratedInvariants(unittest.TestCase):
    def test_ids_stages_markets_and_links(self) -> None:
        sites = _load("sites.geojson")["features"]
        deals = _load("deals.geojson")["features"]
        site_ids = [item["properties"].get("site_id") for item in sites]
        deal_ids = [item["properties"].get("deal_id") for item in deals]
        self.assertTrue(all(site_ids))
        self.assertEqual(len(site_ids), len(set(site_ids)))
        self.assertTrue(all(deal_ids))
        self.assertEqual(len(deal_ids), len(set(deal_ids)))
        site_set = set(site_ids)
        for feature in deals:
            props = feature["properties"]
            city = props.get("city")
            stage = props.get("stage")
            self.assertTrue(known_market(city), props.get("deal_id"))
            self.assertTrue(known_stage(stage), props.get("deal_id"))
            self.assertEqual(props.get("stage_group"), stage_group(stage), props.get("deal_id"))
            universe_id = str(props.get("universe_id") or "").strip()
            if universe_id:
                self.assertIn(universe_id, site_set, props.get("deal_id"))
        for feature in sites:
            props = feature["properties"]
            self.assertTrue(known_market(props.get("city")), props.get("site_id"))
            pipeline_stage = str(props.get("pipeline_stage") or "").strip()
            if pipeline_stage:
                self.assertTrue(known_stage(pipeline_stage), props.get("site_id"))

    def test_comms_ids_are_unique_and_site_links_resolve(self) -> None:
        comms = _load("comms.json")
        rows = comms["rows"]
        ids = [row.get("comms_id") for row in rows]
        self.assertTrue(all(ids))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(re.fullmatch(r"CM-\d+", item) for item in ids))
        self.assertEqual(comms.get("unexpected_directions"), [])
        self.assertFalse(any(len(row.get("summary") or "") > 300 for row in rows))
        by_id = {row["comms_id"]: row for row in rows}
        sites = {item["properties"]["site_id"] for item in _load("sites.geojson")["features"]}
        deals = {item["properties"]["deal_id"] for item in _load("deals.geojson")["features"]}
        known = sites | deals
        orphans = []
        for site, linked in (comms.get("sites") or {}).items():
            for comms_id in linked:
                self.assertIn(comms_id, by_id, site)
            for token in re.split(r"[;,\s]+", site):
                if SITEISH.search(token) and token not in known:
                    orphans.append(token)
        self.assertEqual(Counter(orphans), Counter())


if __name__ == "__main__":
    unittest.main()
