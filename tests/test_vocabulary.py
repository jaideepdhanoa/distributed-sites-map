"""Unknown workbook values are reported and do not raise."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.vocabulary import (
    collect_vocabulary,
    format_violation,
    known_market,
    known_stage,
    service_area_known,
    shipped_problems,
    vocabulary_lines,
)


class VocabularyTests(unittest.TestCase):
    def test_phoenix_is_unknown_and_the_map_codes_are_known(self) -> None:
        self.assertTrue(known_market("PHX"))
        self.assertTrue(known_market("LAS"))
        self.assertTrue(known_market("MIA"))
        self.assertTrue(known_market("SNA"))
        self.assertFalse(known_market("Phoenix"))
        self.assertFalse(known_market("PHOENIX"))
        self.assertFalse(known_market("Las Vegas"))

    def test_stages(self) -> None:
        self.assertTrue(known_stage("1 Desk screen"))
        self.assertTrue(known_stage("2 Financial screen"))
        self.assertTrue(known_stage("Financial screen"))
        self.assertTrue(known_stage("Dropped"))
        self.assertTrue(known_stage("3 Diligence visit"))
        self.assertFalse(known_stage("Contacted"))
        self.assertFalse(known_stage(""))

    def test_service_area_unknown_does_not_raise(self) -> None:
        self.assertTrue(service_area_known("In"))
        self.assertTrue(service_area_known("Inside"))
        self.assertTrue(service_area_known("Near 0-5"))
        self.assertTrue(service_area_known("Near 5-10"))
        self.assertTrue(service_area_known("Outside"))
        self.assertTrue(service_area_known("Edge"))
        self.assertTrue(service_area_known("Unknown"))
        self.assertTrue(service_area_known(""))
        self.assertTrue(service_area_known("#N/A"))
        self.assertFalse(service_area_known("Far band"))
        rows = collect_vocabulary(
            [
                {
                    "_excel_row": 14,
                    "Site ID": "PHX-U100",
                    "Market": "Phoenix",
                    "Counted in funnel": "Yes",
                    "Service area": "Far band",
                    "Segment group": "Restaurant",
                }
            ],
            [
                {
                    "_excel_row": 8,
                    "Site ID": "PIPE-PHX-0001",
                    "Market": "PHX",
                    "Stage": "Contacted",
                    "Service area": "Inside",
                    "Segment group": "Auto service",
                }
            ],
            [],
        )
        found = {(item["field"], item["site_id"]): item for item in rows["violations"]}
        self.assertIn(("market", "PHX-U100"), found)
        self.assertIn(("service_area", "PHX-U100"), found)
        self.assertIn(("segment_group", "PHX-U100"), found)
        self.assertIn(("stage", "PIPE-PHX-0001"), found)
        self.assertNotIn(("service_area", "PIPE-PHX-0001"), found)
        self.assertNotIn(("segment_group", "PIPE-PHX-0001"), found)
        self.assertIn("PHX-U100", format_violation(found[("market", "PHX-U100")]))
        self.assertIn("row 14", format_violation(found[("market", "PHX-U100")]))

    def test_a_known_row_is_quiet(self) -> None:
        rows = collect_vocabulary(
            [{"Market": "PHX", "Counted in funnel": "Yes", "Service area": "In", "Segment group": "Car wash"}],
            [{"Market": "LAS", "Stage": "1 Desk screen", "Segment group": ""}],
            [{"Market": "SNA", "Stage": "Off-market target"}],
        )
        self.assertEqual(rows["violations"], [])

    def test_shipped_phoenix_fails_and_a_clean_report_does_not(self) -> None:
        problems = shipped_problems(
            [{"properties": {"deal_id": "LAND-PHX-0066", "city": "PHOENIX", "stage": "1 Desk screen"}}],
            [],
            {},
        )
        self.assertEqual(len(problems), 1)
        self.assertIn("LAND-PHX-0066", problems[0])
        self.assertIn("PHOENIX", problems[0])
        clean = shipped_problems(
            [{"properties": {"deal_id": "PIPE-SNA-0002", "city": "SNA", "stage": "1 Desk screen"}}],
            [{"properties": {"site_id": "PHX-U1", "city": "PHX", "pipeline_stage": "2 Financial screen"}}],
            {"vocabulary": {"violations": []}},
        )
        self.assertEqual(clean, [])

    def test_pr_lines_name_the_row(self) -> None:
        lines = vocabulary_lines(
            {
                "vocabulary": {
                    "violations": [
                        {
                            "sheet": "Universe",
                            "row": 14,
                            "site_id": "PHX-U100",
                            "field": "market",
                            "value": "Phoenix",
                        }
                    ]
                }
            }
        )
        self.assertTrue(lines[0].startswith("Vocabulary check: 1"))
        self.assertIn("PHX-U100", "\n".join(lines))
        self.assertIn("row 14", "\n".join(lines))
        self.assertEqual(
            vocabulary_lines({"vocabulary": {"violations": []}})[0],
            "Vocabulary check: 0 unknown value(s).",
        )


if __name__ == "__main__":
    unittest.main()
