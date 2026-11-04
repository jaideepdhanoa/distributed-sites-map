"""Extension point for a later Gmail-label index. This build does not read Gmail."""

from __future__ import annotations


def load_gmail_items(config: dict, record_ids: list[str]) -> list[dict]:
    """Return no rows.

    A future indexer owns the label template in config["gmail"]["labelTemplate"]
    (default Sites/{recordId}). Each item it adds must use the same shape as the
    activity log: record_id, date, type email, a short neutral summary, and a link.
    It must not include a subject or a body.
    """
    del config, record_ids
    return []
