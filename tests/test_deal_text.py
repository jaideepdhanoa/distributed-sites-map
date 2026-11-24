"""Hyphenated live-work is a property term. A bare live note is still internal."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import _NOTE_INTERNAL, deal_text_problems, guard_deal_text  # noqa: E402

# These stay internal. A hyphen on either side is the live-work property term.
_STILL_INTERNAL = (
    "checked live on site",
    "live listing",
    "Live/Work",
)
_PROPERTY_TERM = (
    "Live-Work Property with Service Bays",
    "work-live unit",
)


def _props(name: str) -> dict:
    return {
        "broker": "",
        "firm": "",
        "asking_price_source": "Listing",
        "next_step": "",
        "name": name,
        "address": "1 Example St",
        "source_line": "Listing",
        "figures_source": "",
    }


class LiveWorkDealTextTest(unittest.TestCase):
    def test_live_matches_unless_the_word_is_hyphenated(self) -> None:
        for text in _STILL_INTERNAL:
            self.assertIsNotNone(_NOTE_INTERNAL.search(text), text)
        for text in _PROPERTY_TERM:
            self.assertIsNone(_NOTE_INTERNAL.search(text), text)

    def test_guard_accepts_a_live_work_deal_name(self) -> None:
        name = "Live-Work Property with Service Bays"
        props = _props(name)
        self.assertEqual(deal_text_problems("PIPE-PHX-0104", props), [])
        self.assertIsNone(guard_deal_text("PIPE-PHX-0104", props))
        self.assertEqual(props["name"], name)

        props = _props("work-live unit")
        self.assertEqual(deal_text_problems("PIPE-TEST", props), [])
        self.assertIsNone(guard_deal_text("PIPE-TEST", props))

    def test_guard_still_rejects_an_unhyphenated_live_name(self) -> None:
        for name in _STILL_INTERNAL:
            props = _props(name)
            problems = deal_text_problems("PIPE-TEST", props)
            self.assertTrue(any("name" in item for item in problems), (name, problems))
            with self.assertRaises(SystemExit) as raised:
                guard_deal_text("PIPE-TEST", props)
            self.assertIn("name", str(raised.exception))
            self.assertIn("internal wording", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
