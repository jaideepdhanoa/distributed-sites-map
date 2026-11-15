import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const MAX_FILE_BYTES = 20_000_000;

export type PackedFile = { content: string; bytes: number; sha256: string };

export function packFile(body: string): PackedFile {
  const raw = Buffer.from(body, "utf8");
  if (raw.length > MAX_FILE_BYTES) throw new Error("A snapshot file is too large.");
  return {
    content: gzipSync(raw).toString("base64"),
    bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}

export function unpackFile(packed: PackedFile): string {
  const raw = gunzipSync(Buffer.from(packed.content, "base64"));
  if (raw.length !== packed.bytes) throw new Error("snapshot file size mismatch");
  const sha256 = createHash("sha256").update(raw).digest("hex");
  if (sha256 !== packed.sha256) throw new Error("snapshot file hash mismatch");
  return raw.toString("utf8");
}

export function assertFileName(name: string): void {
  if (!SAFE_FILE_NAME.test(name) || name.includes("..") || name.length > 180) {
    throw new Error("A snapshot file name is not allowed.");
  }
}

type Counted = {
  features?: unknown[];
  rows?: unknown[];
  sites?: Record<string, unknown>;
  stages?: unknown[];
};

export function rowCounts(files: { name: string; body: string }[]): Record<string, number> {
  const counts: Record<string, number> = { files: files.length };
  for (const file of files) {
    if (!file.name.endsWith(".json") && !file.name.endsWith(".geojson")) continue;
    try {
      const parsed = JSON.parse(file.body) as Counted;
      if (Array.isArray(parsed.features)) counts[file.name] = parsed.features.length;
      else if (Array.isArray(parsed.rows)) counts[file.name] = parsed.rows.length;
      else if (parsed.sites && typeof parsed.sites === "object" && !Array.isArray(parsed.sites)) {
        counts[file.name] = Object.keys(parsed.sites).length;
      } else if (Array.isArray(parsed.stages)) counts[file.name] = parsed.stages.length;
    } catch {
      // The file is still stored. The count is omitted when it is not JSON.
    }
  }
  return counts;
}

export function workbookModifiedAt(funnelBody: string | undefined): string | null {
  if (!funnelBody) return null;
  try {
    const parsed = JSON.parse(funnelBody) as { workbook_as_of?: unknown };
    const day = String(parsed.workbook_as_of || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    return `${day}T00:00:00.000Z`;
  } catch {
    return null;
  }
}
