"""R-099 service-area classes, legacy values, and the funnel split."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.key_numbers import key_figures
from scripts.sync_workbook import service_area_comment_lines
from scripts.service_area import (
    EDGE_LABEL,
    classify_service_area,
    passes_service_area,
    service_area_breakdown,
    service_area_fields,
)


def _site(city: str, **row):
    fields, warning = service_area_fields(row, where=f"{city} row")
    return {
        "city": city,
        "origin": "universe",
        "counts_as_site": True,
        **fields,
        "_warning": warning,
    }


class ClassifyTest(unittest.TestCase):
    def test_each_current_class(self) -> None:
        expected = {
            "Inside": ("inside", True),
            "Near 0-5": ("near_0_5", True),
            "Near 5-10": ("near_5_10", True),
            "Outside": ("outside", False),
        }
        for raw, (class_id, passes) in expected.items():
            found, recognized = classify_service_area(raw)
            self.assertEqual(found, class_id, raw)
            self.assertTrue(recognized, raw)
            self.assertEqual(passes_service_area(found), passes, raw)

    def test_legacy_values(self) -> None:
        legacy = {
            "In": ("inside", True),
            "Yes": ("inside", True),
            "Edge": ("edge_legacy", True),
            "No": ("outside", False),
            "Out": ("outside", False),
            "Unknown": ("unknown", False),
        }
        for raw, (class_id, passes) in legacy.items():
            found, recognized = classify_service_area(raw)
            self.assertEqual(found, class_id, raw)
            self.assertTrue(recognized, raw)
            self.assertEqual(passes_service_area(found), passes, raw)
        edge, warning = service_area_fields({"Service area": "Edge"})
        self.assertEqual(edge["service_area_class"], "edge_legacy")
        self.assertTrue(edge["in_area"])
        self.assertIsNone(warning)
        self.assertEqual(EDGE_LABEL, "edge (not re-measured)")

    def test_blank_is_quiet_and_unrecognized_is_flagged_without_raising(self) -> None:
        blank, warning = service_area_fields({"Service area": "  "})
        self.assertEqual(blank["service_area_class"], "unknown")
        self.assertFalse(blank["in_area"])
        self.assertIsNone(warning)
        missing, missing_warning = service_area_fields({"Service area": "#N/A"})
        self.assertEqual(missing["service_area_class"], "unknown")
        self.assertIsNone(missing_warning)
        flagged, flag = service_area_fields({"Inside the service area": "Beside"}, where="PIPE-PHX-0001")
        self.assertEqual(flagged["service_area_class"], "unknown")
        self.assertFalse(flagged["in_area"])
        self.assertEqual(flag, "PIPE-PHX-0001 service area 'Beside' is not a known class")

    def test_spacing_and_dashes(self) -> None:
        found, recognized = classify_service_area("NEAR  0–5")
        self.assertEqual(found, "near_0_5")
        self.assertTrue(recognized)
        found, recognized = classify_service_area("Near 5 to 10")
        self.assertEqual(found, "near_5_10")
        self.assertTrue(recognized)


class DistanceTest(unittest.TestCase):
    def test_column_wins_over_notes(self) -> None:
        row = {
            "Inside the service area": "Near 0-5",
            "Distance to service area (mi)": 2.5,
            "Service area polygon": "vegas_100",
            "Deal notes": "distance 9.0 mi to phx_2026_v5",
        }
        fields, warning = service_area_fields(row)
        self.assertIsNone(warning)
        self.assertEqual(fields["service_area_class"], "near_0_5")
        self.assertEqual(fields["service_area_distance_mi"], 2.5)
        self.assertEqual(fields["service_area_polygon"], "vegas_100")
        self.assertTrue(fields["in_area"])

    def test_missing_columns_parse_notes_and_blank_stays_blank(self) -> None:
        noted, warning = service_area_fields(
            {
                "Service area": "Near 5-10",
                "Notes and next step": "Maricopa County parcel point measured Nov 13, 2026: 8.0 mi to phx_2026_v5 (R-099).",
                "What we know": "Dist to depot 13.7 mi straight-line from the county parcel point.",
            }
        )
        self.assertIsNone(warning)
        self.assertEqual(noted["service_area_distance_mi"], 8.0)
        self.assertEqual(noted["service_area_polygon"], "phx_2026_v5")
        self.assertTrue(noted["in_area"])
        mia, _warning = service_area_fields(
            {"Service area": "Inside", "Basis": "distance 1.0 mi to MIA Extended ODD"}
        )
        self.assertEqual(mia["service_area_distance_mi"], 1.0)
        self.assertEqual(mia["service_area_polygon"], "MIA Extended ODD")
        self.assertTrue(mia["in_area"])
        last, _warning = service_area_fields(
            {"Service area": "Near 0-5", "Land notes": "distance 0.5 mi to vegas_100; later distance 1.7 mi to phx_2026_v5"}
        )
        self.assertEqual(last["service_area_distance_mi"], 1.7)
        self.assertEqual(last["service_area_polygon"], "phx_2026_v5")
        blank, _warning = service_area_fields({"Service area": "Inside", "Notes and next step": "No measurement yet."})
        self.assertIsNone(blank["service_area_distance_mi"])
        self.assertEqual(blank["service_area_polygon"], "")
        other_ring, _warning = service_area_fields(
            {"Service area": "Outside", "Deal notes": "distance 3.0 mi to vegas_200"}
        )
        self.assertIsNone(other_ring["service_area_distance_mi"])
        self.assertEqual(other_ring["service_area_polygon"], "")
        self.assertFalse(other_ring["in_area"])

    def test_sheet_error_in_the_column_falls_back_to_notes(self) -> None:
        fields, warning = service_area_fields(
            {
                "Service area": "Near 0-5",
                "Distance to service area (mi)": "#N/A",
                "Service area polygon": "",
                "Notes and next step": "distance 0.0 mi to phx_2026_v5",
            }
        )
        self.assertIsNone(warning)
        self.assertEqual(fields["service_area_distance_mi"], 0.0)
        self.assertEqual(fields["service_area_polygon"], "phx_2026_v5")

    def test_zero_in_the_column_is_kept(self) -> None:
        fields, _warning = service_area_fields(
            {
                "Inside the service area": "Inside",
                "Distance to service area (mi)": 0,
                "Land notes": "distance 4.0 mi to vegas_100",
            }
        )
        self.assertEqual(fields["service_area_distance_mi"], 0.0)
        self.assertEqual(fields["service_area_polygon"], "vegas_100")


class ScoreTest(unittest.TestCase):
    def test_score_and_location_points_are_copied(self) -> None:
        copied = key_figures(
            {"Score (of 100)": 72, "Location points": 7.5, "Inside the service area": "Inside"},
            "pipeline",
        )
        self.assertEqual(copied["score"], 72)
        self.assertEqual(copied["location_points"], 7.5)
        missing = key_figures({"Score (of 100)": "#N/A", "Location points": "#N/A"}, "land")
        self.assertIsNone(missing["score"])
        self.assertIsNone(missing["location_points"])


class FunnelTest(unittest.TestCase):
    def test_counts_and_split(self) -> None:
        sites = [
            _site("PHX", **{"Service area": "Inside"}),
            _site("PHX", **{"Service area": "In"}),
            _site("PHX", **{"Service area": "Near 0-5"}),
            _site("LAS", **{"Service area": "Near 0-5"}),
            _site("PHX", **{"Service area": "Near 5-10"}),
            _site("MIA", **{"Service area": "Edge"}),
            _site("MIA", **{"Service area": "Outside"}),
            _site("LAS", **{"Service area": "Out"}),
            _site("LAS", **{"Service area": "Unknown"}),
            _site("PHX", **{"Service area": "Beside"}),
        ]
        sites.append({"city": "PHX", "origin": "universe", "counts_as_site": False, "in_area": True, "service_area_class": "inside"})
        sites.append({"city": "PHX", "origin": "land", "counts_as_site": True, "in_area": True, "service_area_class": "inside"})
        stage = service_area_breakdown(sites)
        self.assertEqual(stage["name"], "Service area")
        self.assertEqual(stage["total"], 6)
        self.assertEqual(stage["by_city"], {"LAS": 1, "PHX": 4, "MIA": 1})
        self.assertEqual(stage["by_service_area"]["inside"]["total"], 2)
        self.assertEqual(stage["by_service_area"]["inside"]["by_city"]["PHX"], 2)
        self.assertEqual(stage["by_service_area"]["near_0_5"]["total"], 2)
        self.assertEqual(stage["by_service_area"]["near_0_5"]["by_city"], {"LAS": 1, "PHX": 1, "MIA": 0})
        self.assertEqual(stage["by_service_area"]["near_5_10"]["total"], 1)
        self.assertEqual(stage["by_service_area"]["edge_legacy"]["total"], 1)
        self.assertEqual(stage["by_service_area"]["edge_legacy"]["by_city"]["MIA"], 1)
        self.assertEqual(sum(item["total"] for item in stage["by_service_area"].values()), 6)
        self.assertEqual(stage["service_area_excluded"]["outside"]["total"], 2)
        self.assertEqual(stage["service_area_excluded"]["unknown"]["total"], 2)
        self.assertEqual(sites[-3]["_warning"], "PHX row service area 'Beside' is not a known class")

    def test_sync_comment_flags_unrecognized_values_and_does_not_require_them(self) -> None:
        lines = service_area_comment_lines({"service_area_unrecognized": ["Universe WB-PHX-0001 service area 'Beside' is not a known class"]})
        self.assertEqual(lines[0], "Unrecognized service-area classes: 1.")
        self.assertIn("Beside", lines[1])
        self.assertEqual(service_area_comment_lines({})[0], "Unrecognized service-area classes: 0.")
        self.assertEqual(service_area_comment_lines(None)[0], "Unrecognized service-area classes: 0.")


if __name__ == "__main__":
    unittest.main()
