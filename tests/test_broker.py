"""Broker cells and the asking-price source that is allowed to name a firm."""

from __future__ import annotations

import contextlib
import io
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import (  # noqa: E402
    _broker_channel,
    asking_price_source_for,
    deal_text_problems,
    guard_deal_text,
    scrub,
    split_broker,
)

# raw cell, broker, firm
CASES = (
    ("Ignite Commercial Real Estate (Jesse Rozio)", "Jesse Rozio", "Ignite Commercial Real Estate"),
    ("Jesse Rozio, Ignite Commercial Real Estate", "Jesse Rozio", "Ignite Commercial Real Estate"),
    (
        "Jesse Rozio, Ignite Commercial Real Estate (jesse@ignite-cre.com)",
        "Jesse Rozio",
        "Ignite Commercial Real Estate",
    ),
    ("Jesse Rozio (Ignite Commercial Real Estate)", "Jesse Rozio", "Ignite Commercial Real Estate"),
    ("Roger Pardo", "Roger Pardo", ""),
    ("Alan Grobman", "Alan Grobman", ""),
    ("Ivy Seto & Xavier Seto", "Ivy Seto & Xavier Seto", ""),
    ("Ivy Seto and Xavier Seto", "Ivy Seto and Xavier Seto", ""),
    ("Marcus & Millichap (John Smith)", "John Smith", "Marcus & Millichap"),
    ("Car Wash Brokers Inc (Pencek)", "Pencek", "Car Wash Brokers Inc"),
    ("Ignite Commercial Real Estate (Jesse Rozio) 602-555-0199", "Jesse Rozio", "Ignite Commercial Real Estate"),
    ("None yet", "", ""),
    ("", "", ""),
    (None, "", ""),
)


def _props(broker: str, firm: str, source: str, url: str = "") -> dict:
    return {
        "broker": broker,
        "firm": firm,
        "asking_price_source": source,
        "next_step": "",
        "name": "Sample Wash",
        "address": "1 Main St",
        "source_line": firm or "Broker",
        "listing_url": url,
    }


class SplitBrokerTest(unittest.TestCase):
    def test_cells_and_the_asking_source_never_name_the_person(self) -> None:
        for raw, broker, firm in CASES:
            for url in ("", "https://www.crexi.com/properties/1888857"):
                got_broker, got_firm = split_broker(raw)
                self.assertEqual(got_broker, broker, raw)
                self.assertEqual(got_firm, firm, raw)
                source = scrub(asking_price_source_for(got_firm, url))[:160]
                if broker:
                    self.assertNotIn(broker, source, (raw, url))
                if firm:
                    self.assertEqual(source, firm, (raw, url))
                else:
                    self.assertEqual(source, "Listing" if url else "Broker", (raw, url))
                self.assertNotIn("@", source, raw)
                self.assertNotRegex(source, r"\d{3}[\s.-]\d{3}[\s.-]\d{4}", raw)
                problems = deal_text_problems("PIPE-TEST", _props(got_broker, got_firm, source, url))
                self.assertEqual(problems, [], (raw, url, source))

    def test_a_firm_that_uses_an_internal_name_does_not_trip_the_source(self) -> None:
        props = _props("Jesse Rozio", "Jesse Rozio Partners", "Jesse Rozio Partners")
        props["source_line"] = "Broker"
        self.assertEqual(deal_text_problems("LAND-PHX-0047", props), [])

    def test_notes_and_the_source_line_still_catch_an_internal_name(self) -> None:
        props = _props("Ada Lovelace", "Matthews", "Matthews")
        props["next_step"] = "Jesse replied."
        problems = deal_text_problems("PIPE-TEST", props)
        self.assertTrue(any("next_step" in item for item in problems), problems)
        self.assertFalse(any("asking_price_source" in item for item in problems), problems)

        props["next_step"] = ""
        props["source_line"] = "Waiting for Jesse"
        problems = deal_text_problems("PIPE-TEST", props)
        self.assertTrue(any("source_line" in item for item in problems), problems)

    def test_other_private_wording_on_the_source_still_counts(self) -> None:
        props = _props("Jesse Rozio", "Ignite Commercial Real Estate", "Ignite outreach")
        problems = deal_text_problems("PIPE-TEST", props)
        self.assertTrue(any("asking_price_source" in item for item in problems), problems)
        props["asking_price_source"] = "Ignite EBITDA"
        problems = deal_text_problems("PIPE-TEST", props)
        self.assertTrue(any("asking_price_source" in item for item in problems), problems)

    def test_a_source_that_still_trips_warns_and_a_note_still_fails(self) -> None:
        props = _props("Ada Lovelace", "Email Realty", "Email Realty")
        props["source_line"] = "Broker"
        props["next_step"] = "Confirm the lot size."
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            guard_deal_text("PIPE-TEST", props)
        self.assertIn("Warning:", err.getvalue())
        self.assertIn("asking_price_source", err.getvalue())
        self.assertEqual(props["asking_price_source"], "Email Realty")

        props = _props("Ada Lovelace", "Matthews", "Matthews")
        props["source_line"] = "Jesse followed up"
        with self.assertRaises(SystemExit) as raised:
            guard_deal_text("PIPE-TEST", props)
        self.assertIn("source_line", str(raised.exception))
        self.assertIn("internal wording", str(raised.exception))
        self.assertNotIn("asking_price_source", str(raised.exception))

    def test_an_email_between_a_dash_and_a_semicolon_is_removed(self) -> None:
        broker, firm = split_broker(
            "Emily Brun, Cushman & Wakefield — emily.brun@cushwake.com; Marlene Fujita Winkel (LoopNet listing)"
        )
        self.assertEqual(broker, "LoopNet listing")
        self.assertEqual(firm, "Emily Brun, Cushman & Wakefield; Marlene Fujita Winkel")
        self.assertNotIn("@", firm)
        source = asking_price_source_for(firm, "")
        self.assertEqual(source, firm)
        self.assertEqual(deal_text_problems("LAND-LAS-0004", _props(broker, firm, source)), [])

    def test_the_source_line_uses_the_firm(self) -> None:
        self.assertEqual(_broker_channel("Car Wash Brokers Inc (Pencek)"), "Car Wash Brokers Inc")
        self.assertEqual(_broker_channel("Not shown (BizBuySell)"), "BizBuySell")
        self.assertEqual(
            _broker_channel("Jesse Rozio, Ignite Commercial Real Estate"),
            "Ignite Commercial Real Estate",
        )
        self.assertEqual(_broker_channel("Roger Pardo"), "")
        self.assertEqual(_broker_channel("None yet"), "")
        self.assertEqual(_broker_channel("Matthews, exclusive (John Smith)"), "Matthews")


if __name__ == "__main__":
    unittest.main()
