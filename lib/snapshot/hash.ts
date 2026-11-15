import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SAFE_FILE_NAME, contentSha256 } from "./pack";

/**
 * Digest of the files a snapshot publish would write.
 *
 * Files are ordered by name. Each one contributes its name, a NUL, the
 * sha256 of its UTF-8 bytes (the same digest stored on snapshot_files),
 * and a NUL. scripts/snapshot_hash.py computes this same digest with no
 * database connection. The workflow stores the result in the Actions cache.
 */
export function hashFileDigests(entries: { name: string; sha256: string }[]): string {
  const hash = createHash("sha256");
  const ordered = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of ordered) {
    hash.update(entry.name);
    hash.update("\0");
    hash.update(entry.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function generatedContentHash(files: { name: string; body: string }[]): string {
  return hashFileDigests(files.map((file) => ({ name: file.name, sha256: contentSha256(file.body) })));
}

const PRIVATE_FILES = new Set(["site_sheet.json", "comms_full.json"]);

export function isSnapshotFile(name: string): boolean {
  if (PRIVATE_FILES.has(name)) return false;
  return SAFE_FILE_NAME.test(name) && /\.(json|geojson|csv)$/.test(name);
}

/** The files publish-snapshot.ts writes. Names are sorted. */
export function collectGenerated(dir: string): { name: string; body: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => isSnapshotFile(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
}
