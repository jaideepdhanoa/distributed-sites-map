"""Wording gate for timeline rows. The term list is encoded so the source stays plain."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

STATUS = {
    "listing": "Listing noted",
    "brochure": "Brochure on file",
    "om": "OM on file",
    "financials": "Financials on file",
    "photos": "Photos on file",
    "legal": "Property or legal document on file",
    "doc": "Document on file",
    "visit": "Site visit logged",
    "stage": "Stage updated",
}


def _decode(value: str) -> str:
    text = base64.b64decode(value).decode()
    prefix = "term:"
    return text[len(prefix) :] if text.startswith(prefix) else text


def load_policy(path: Path | None = None):
    payload = json.loads((path or (ROOT / "config" / "timeline-terms.json")).read_text())
    words = [re.compile(rf"\b{re.escape(_decode(item))}\b", re.I) for item in payload.get("words") or []]
    phrases = [re.compile(re.escape(_decode(item)), re.I) for item in payload.get("phrases") or []]
    units = "|".join(re.escape(_decode(item)) for item in payload.get("units") or [])
    unit = re.compile(rf"(?<![A-Za-z])\d+(?:\.\d+)?\s*(?:{units})\b", re.I) if units else None
    phone = re.compile(r"(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b")
    return words, phrases, unit, phone


WORDS, PHRASES, UNIT, PHONE = load_policy()


def blocked(text: str) -> bool:
    value = text or ""
    if PHONE.search(value):
        return True
    if UNIT and UNIT.search(value):
        return True
    if any(pattern.search(value) for pattern in PHRASES):
        return True
    return any(pattern.search(value) for pattern in WORDS)


def drop_tokens(config: dict) -> list[str]:
    return [_decode(item).lower() for item in config.get("dropNameTerms") or []]


def name_hidden(name: str, config: dict) -> bool:
    lowered = (name or "").lower()
    if any(token and token in lowered for token in drop_tokens(config)):
        return True
    return blocked(name)


def clean_link(value: str) -> str:
    text = (value or "").strip()
    if re.fullmatch(r"https?://[^\s]+", text, flags=re.I):
        return text
    return ""


def stage_line(summary: str) -> str:
    """Keep the fixed stage sentence and drop a parenthetical caveat."""
    text = re.sub(r"\s*\([^)]*\)", " ", summary or "")
    return " ".join(text.split())


def status_line(kind: str, summary: str) -> str:
    """Neutral line for a row. Empty means the row must be dropped."""
    text = " ".join((summary or "").split())
    if kind == "stage":
        text = stage_line(text)
    if not text:
        return STATUS.get(kind, "")
    if "$" in text or "@" in text or blocked(text):
        return ""
    return text[:240]
