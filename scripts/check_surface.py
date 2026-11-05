"""Shipped text stays free of private terms, and site capacity stays on the panel."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_data import display_language_problems  # noqa: E402

GENERATED = (
    "sites.geojson",
    "areas.geojson",
    "depots.geojson",
    "parcels.geojson",
    "parcels-PHX.geojson",
    "parcels-LAS.geojson",
    "parcels-MIA.geojson",
    "deals.geojson",
    "funnel.json",
    "build_report.json",
)
PANEL_FILES = {
    "components/KeyStrip.tsx",
    "components/Detail.tsx",
    "lib/keyNumbers.ts",
    "lib/types.ts",
}
SURFACE = ("components", "lib", "app")


def capacity_outside_panel() -> list[str]:
    problems = []
    for folder in SURFACE:
        for path in (ROOT / folder).rglob("*"):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel in PANEL_FILES:
                continue
            if "capacity" in path.read_text().lower():
                problems.append(f"capacity appears outside the panel in {rel}")
    return problems


def main() -> None:
    loaded = {}
    for name in GENERATED:
        loaded[name] = json.loads((ROOT / "data" / "generated" / name).read_text())
    problems = display_language_problems(loaded)
    problems.extend(capacity_outside_panel())
    if problems:
        raise SystemExit("Surface check failed.\n" + "\n".join(problems[:30]))
    print("Surface check passed.")


if __name__ == "__main__":
    main()
