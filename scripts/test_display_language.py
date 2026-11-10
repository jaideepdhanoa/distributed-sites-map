"""Generated map text uses the same diligence allowlist as a posted draft."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import blocked_display_term, display_language_problems  # noqa: E402
from scripts.key_numbers import _fact_text  # noqa: E402
from scripts.site_photos import _safe_text  # noqa: E402


def sample_problems(loaded: dict) -> list[str]:
    return [item for item in display_language_problems(loaded) if "sample" in item]


class DisplayAllowances(unittest.TestCase):
    def test_deed_and_bill_lines_pass_the_surface_check(self) -> None:
        allowed = {
            "sample-easement": "1982 utility easement (Book 1617, Inst. Unplottable",
            "sample-easements": "utility easements along the rear line",
            "sample-bills": "Water and utility bills",
            "sample-service": "electrical service details (amps, voltage, phase, utility bills)",
        }
        self.assertEqual(sample_problems(allowed), [])
        for text in allowed.values():
            self.assertFalse(blocked_display_term(text), text)
            self.assertEqual(_fact_text(text), text)
            self.assertEqual(_safe_text(text), text)

    def test_proximity_charging_and_stalls_stay_off_the_map(self) -> None:
        blocked = [
            "utility proximity",
            "utility hosting map",
            "serving utility",
            "utility proximity beside a utility easement",
            "Under 4 stalls fit",
            "charging interest",
            "utility bills and charging",
            "utility easement for the stalls",
        ]
        problems = sample_problems({"sample-blocked": blocked[0]})
        self.assertTrue(problems)
        self.assertIn("utility", problems[0])
        for text in blocked:
            self.assertTrue(blocked_display_term(text), text)
            self.assertEqual(_fact_text(text), "")
            self.assertEqual(_safe_text(text), "")


if __name__ == "__main__":
    unittest.main()
