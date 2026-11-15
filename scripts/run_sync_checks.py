#!/usr/bin/env python3
"""Run the data checks and write a short markdown report for the sync pull request.

The process exits 1 when a check fails. The report is still written.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PYTHON = [
    ["scripts/test_changes.py"],
    ["tests/test_sync_workbook.py"],
    ["tests/test_sync_push.py"],
    ["tests/test_key_numbers.py"],
    ["tests/test_vocabulary.py"],
    ["tests/test_invariants.py"],
    ["tests/test_cstore.py"],
    ["tests/test_business_type.py"],
    ["tests/test_financials.py"],
    ["tests/test_pricing_sources.py"],
    ["tests/test_nda.py"],
    ["tests/test_comms.py"],
    ["tests/test_open_loops.py"],
    ["scripts/check_surface.py"],
    ["scripts/test_review_fixes.py"],
    ["scripts/build_data.py", "--check"],
    ["scripts/vocabulary.py", "--check"],
]

NODE = [
    "node",
    "--import",
    "tsx",
    "--test",
    "tests/categories.test.ts",
    "tests/comms.test.ts",
    "tests/nda.test.ts",
    "tests/open-loops.test.ts",
    "tests/cstore.test.ts",
    "tests/financials.test.ts",
    "tests/actions/suggested-drop.test.ts",
]


def _clip(text: str, limit: int = 3500) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[-limit:]


def _run(args: list[str]) -> tuple[str, int, str]:
    completed = subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    output = (completed.stdout or "") + (completed.stderr or "")
    label = " ".join(args[1:] if args[0] == sys.executable else args)
    return label, completed.returncode, output


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/sync-test-results.md")
    results: list[tuple[str, int, str]] = []
    for args in PYTHON:
        results.append(_run([sys.executable, *args]))
    if (ROOT / "node_modules" / "tsx").exists():
        results.append(_run(NODE))
    else:
        results.append(("node data tests", 0, "skipped: npm ci has not installed tsx"))
    failed = [item for item in results if item[1] != 0]
    lines = ["## Data checks", ""]
    for label, code, output in results:
        if code == 0 and output.startswith("skipped:"):
            lines.append(f"- skipped {label}")
        else:
            lines.append(f"- {'pass' if code == 0 else 'fail'} {label}")
    if not failed:
        lines.extend(["", "All data checks passed."])
    else:
        lines.extend(["", "These checks failed. The pull request should not be merged.", ""])
        for label, _code, output in failed:
            lines.append(f"### {label}")
            lines.append("")
            lines.append("```")
            lines.append(_clip(output) or "(no output)")
            lines.append("```")
            lines.append("")
    target.write_text("\n".join(lines).rstrip() + "\n")
    print(target.read_text())
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
