"""Generated map text keeps team language. Removed proximity fields still fail."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import (  # noqa: E402
    clean_deal_note,
    display_language_problems,
    scan_obj,
    scrub,
    strip_stall,
)
from scripts.key_numbers import _fact_text  # noqa: E402
from scripts.site_photos import _safe_text  # noqa: E402

TEAM_TEXT = (
    "We asked the broker for a current rent roll, month-to-month lease documents, "
    "and electrical service details (amps, voltage, phase, utility bills). "
    "We are waiting on an NDA. The site is on hold. Under 4 stalls fit. "
    "The offer covers charging at 50 kW. Water and utility bills are on file."
)


class DisplayLanguage(unittest.TestCase):
    def test_team_language_is_kept_on_generated_text(self) -> None:
        self.assertEqual(scrub(TEAM_TEXT), TEAM_TEXT)
        self.assertIn("stalls", strip_stall("Under 4 stalls fit"))
        self.assertEqual(_fact_text(TEAM_TEXT), TEAM_TEXT)
        self.assertEqual(_safe_text("utility easement and charging stalls"), "utility easement and charging stalls")
        self.assertEqual(scan_obj({"note": TEAM_TEXT, "offer": "ready"}, "sample"), [])
        problems = [item for item in display_language_problems({"sample": {"note": TEAM_TEXT}}) if "sample" in item]
        self.assertEqual(problems, [])
        kept = clean_deal_note("Confirm the electrical service, the utility easement, the stalls, and the offer.")
        self.assertIn("electrical", kept)
        self.assertIn("utility", kept)
        self.assertIn("stalls", kept)
        self.assertIn("offer", kept)

    def test_removed_proximity_fields_still_fail(self) -> None:
        problems = display_language_problems({"sample": {"utility_proximity": "Strong"}})
        self.assertTrue(any("utility_proximity" in item for item in problems))
        self.assertTrue(scan_obj({"ebitda": 1}, "facts"))


if __name__ == "__main__":
    unittest.main()
