"""Build data/pricing/sources.json from a workbook read.

The Google sheet stays read-only. This file is the input the pricing rule
compiles. It keeps figures, claims, and listing status, and it drops source
file links.
"""

from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def rows(content: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(content)))


def cell(table: list[list[str]], index: int, column: int) -> str:
    if index >= len(table) or column >= len(table[index]):
        return ""
    return table[index][column]


def main() -> None:
    land_path, pipe_path, reg_path, facts_path = map(Path, sys.argv[1:5])
    land = json.loads(land_path.read_text())["ranges"]
    pipe = json.loads(pipe_path.read_text())["ranges"]
    reg = json.loads(reg_path.read_text())["ranges"]
    lm, ls, la, lid = [rows(land[i]["content"]) for i in range(4)]
    main, _price, _source, county, _area, basis, ids, flow = [rows(pipe[i]["content"]) for i in range(8)]
    rm, rs = [rows(reg[i]["content"]) for i in range(2)]
    out = {
        "asOf": "2026-11-14",
        "workbook": "167rIKoApP3sMJ3vrp1lg3MT-h5yQGqmMhY_TbBIqByY",
        "land": [],
        "register": [],
        "sites": [],
        "facts": [],
    }
    for i, row in enumerate(lm):
        out["land"].append({
            "id": cell(lid, i, 0),
            "market": row[2] if len(row) > 2 else "",
            "segment": row[3] if len(row) > 3 else "",
            "acres": row[6] if len(row) > 6 else "",
            "price": row[7] if len(row) > 7 else "",
            "status": cell(ls, i, 0),
            "checked": cell(ls, i, 2),
            "area": cell(la, i, 0),
            "link": cell(ls, i, 1),
            "address": " ".join(part for part in (row[0] if row else "", row[1] if len(row) > 1 else "") if part),
        })
    for i, row in enumerate(rm):
        if len(row) < 2 or row[1] != "Land":
            continue
        out["register"].append({
            "id": row[0],
            "market": row[2] if len(row) > 2 else "",
            "address": " ".join(part for part in (row[4] if len(row) > 4 else "", row[3] if len(row) > 3 else "") if part),
            "acres": row[7] if len(row) > 7 else "",
            "price": row[6] if len(row) > 6 else "",
            "status": cell(rs, i, 2),
            "ko": cell(rs, i, 1),
            "link": row[8] if len(row) > 8 else "",
        })
    for i, row in enumerate(main):
        if not row or not row[0]:
            continue
        claimed = flow[i] if i < len(flow) else []
        out["sites"].append({
            "id": cell(ids, i, 0),
            "market": row[2] if len(row) > 2 else "",
            "segment": row[3] if len(row) > 3 else "",
            "stage": row[4] if len(row) > 4 else "",
            "acres": row[6] if len(row) > 6 else "",
            "asking": row[7] if len(row) > 7 else "",
            "revenue": row[8] if len(row) > 8 else "",
            "ebitda": row[9] if len(row) > 9 else "",
            "label": claimed[0] if claimed else "",
            "claimed": claimed[1] if len(claimed) > 1 else "",
            "normalized": claimed[6] if len(claimed) > 6 else "",
            "financialsStatus": cell(basis, i, 0),
            "countyValue": cell(county, i, 0),
            "countyBasis": cell(county, i, 1),
        })
    for line in facts_path.read_text().splitlines():
        if not line.strip():
            continue
        site, figure, period, value, claim = line.split("\t")
        out["facts"].append({"id": site, "figure": figure, "period": period, "value": value, "claim": claim})
    dest = ROOT / "data" / "pricing" / "sources.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2) + "\n")
    print(f"land {len(out['land'])} register {len(out['register'])} sites {len(out['sites'])} facts {len(out['facts'])}")


if __name__ == "__main__":
    main()
