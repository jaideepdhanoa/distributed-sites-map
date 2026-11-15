import { readFile, readdir } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Sql } from "@/lib/actions/db";
import {
  asPhotoBuffer,
  isPhotoName,
  looksLikeImage,
  MAX_PHOTO_BYTES,
  photoContentType,
  photoSha256,
  referencedPhotoNames,
} from "./bytes";

const readFileAsync = promisify(readFile);
const readdirAsync = promisify(readdir);

export type PhotoStoreResult = {
  stored: number;
  unchanged: number;
  missing: number;
  unavailable: boolean;
  message: string;
};

function missingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

export async function readStoredPhoto(sql: Sql, name: string): Promise<Buffer | null> {
  if (!isPhotoName(name)) return null;
  const found = await sql.query<{ bytes: unknown }>(`SELECT bytes FROM photo_files WHERE name = $1`, [name]);
  const body = asPhotoBuffer(found.rows[0]?.bytes);
  if (!body || !looksLikeImage(body)) return null;
  return body;
}

async function tableReady(sql: Sql): Promise<boolean> {
  const found = await sql.query<{ name: string | null }>(`SELECT to_regclass('public.photo_files') AS name`);
  return Boolean(found.rows[0]?.name);
}

/**
 * Writes each referenced photo once. A later publish skips a file whose
 * sha256 is already stored. The snapshot publish has already committed;
 * a missing table does not roll that back.
 */
export async function storeReferencedPhotos(
  sql: Sql,
  files: { name: string; body: string }[],
  directory: string,
): Promise<PhotoStoreResult> {
  if (!(await tableReady(sql))) {
    return {
      stored: 0,
      unchanged: 0,
      missing: 0,
      unavailable: true,
      message: "Photo files were not stored. photo_files is missing. Run the Production migrations workflow.",
    };
  }
  const wanted = referencedPhotoNames(files);
  if (!wanted.length) {
    return { stored: 0, unchanged: 0, missing: 0, unavailable: false, message: "Photo files: none referenced." };
  }
  const onDisk = new Set(
    (await readdirAsync(directory)).filter((name) => isPhotoName(name)),
  );
  const existing = await sql.query<{ name: string; sha256: string }>(
    `SELECT name, sha256 FROM photo_files WHERE name = ANY($1::text[])`,
    [wanted],
  );
  const have = new Map(existing.rows.map((row) => [row.name, row.sha256]));
  let stored = 0;
  let unchanged = 0;
  let missing = 0;
  for (const name of wanted) {
    if (!onDisk.has(name)) {
      missing += 1;
      continue;
    }
    const body = await readFileAsync(join(directory, name));
    if (!looksLikeImage(body) || body.length > MAX_PHOTO_BYTES) {
      missing += 1;
      continue;
    }
    const sha256 = photoSha256(body);
    if (have.get(name) === sha256) {
      unchanged += 1;
      continue;
    }
    await sql.query(
      `INSERT INTO photo_files (name, content_type, sha256, byte_size, bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE
         SET content_type = EXCLUDED.content_type,
             sha256 = EXCLUDED.sha256,
             byte_size = EXCLUDED.byte_size,
             bytes = EXCLUDED.bytes,
             stored_at = now()
       WHERE photo_files.sha256 IS DISTINCT FROM EXCLUDED.sha256`,
      [name, photoContentType(name), sha256, body.length, body],
    );
    stored += 1;
  }
  const message = `Photo files: ${stored} stored, ${unchanged} unchanged, ${missing} not on disk.`;
  return { stored, unchanged, missing, unavailable: false, message };
}

export function photoStoreError(error: unknown): string {
  if (missingTable(error)) return "photo_files is missing";
  const text = error instanceof Error ? error.message : "photo store failed";
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]").slice(0, 300);
}
