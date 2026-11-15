"""Hash the generated snapshot files. Does not connect to a database.

The digest matches lib/snapshot/hash.ts. Files are the json, geojson, and csv
files publish-snapshot.ts would write, in name order. Each file contributes
its name, a NUL, the sha256 of its bytes, and a NUL. The workflow compares
this line with the Actions cache and skips Neon when they match.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "data" / "generated"
SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


PRIVATE_FILES = {"site_sheet.json"}


def is_snapshot_file(name: str) -> bool:
    if name in PRIVATE_FILES:
        return False
    return bool(SAFE.match(name)) and name.endswith((".json", ".geojson", ".csv"))


def content_hash(files: list[tuple[str, bytes]]) -> str:
    digest = hashlib.sha256()
    for name, body in sorted(files, key=lambda item: item[0]):
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(body).hexdigest().encode())
        digest.update(b"\0")
    return digest.hexdigest()


def hash_directory(directory: Path) -> str:
    files: list[tuple[str, bytes]] = []
    for path in directory.iterdir():
        if not path.is_file() or not is_snapshot_file(path.name):
            continue
        files.append((path.name, path.read_bytes()))
    if not files:
        raise SystemExit("No generated snapshot files to hash.")
    return content_hash(files)


def main() -> None:
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else GENERATED
    print(hash_directory(directory))


if __name__ == "__main__":
    main()
