import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/actions/db";
import { hashFileDigests } from "./hash";
import { assertFileName, packFile, rowCounts, unpackFile, type PackedFile } from "./pack";

/** Floor. Rows older than SNAPSHOT_HISTORY_HOURS are deleted once this many remain. */
export const SNAPSHOTS_KEPT = 14;

/**
 * Also keep every snapshot newer than this, even when that is more than
 * SNAPSHOTS_KEPT. A published snapshot is about 1 MiB, so a change on every
 * 15-minute run for a day is about 100 MiB. Neon Free allows 1 GB per project.
 */
export const SNAPSHOT_HISTORY_HOURS = 24;

export type SnapshotFileInput = { name: string; body: string };

export type PublishInput = {
  sourceRunId: string;
  workbookModifiedAt: string | null;
  gitSha: string;
  files: SnapshotFileInput[];
};

export type PublishedSnapshot = {
  id: string;
  createdAt: string;
  rowCounts: Record<string, number>;
};

export type LiveSnapshot = {
  id: string;
  createdAt: string;
  sourceRunId: string;
  workbookModifiedAt: string | null;
  gitSha: string;
  rowCounts: Record<string, number>;
  status: string;
};

export type SnapshotBundle = {
  id: string;
  createdAt: string;
  files: Record<string, PackedFile>;
};

type SnapshotRow = {
  id: string;
  created_at: Date | string;
  source_run_id: string;
  workbook_modified_at: Date | string | null;
  git_sha: string;
  row_counts: Record<string, number> | string;
  status: string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

function counts(value: SnapshotRow["row_counts"]): Record<string, number> {
  const parsed = typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(parsed || {})) {
    const number = Number(item);
    if (Number.isFinite(number)) out[key] = number;
  }
  return out;
}

function mapLive(row: SnapshotRow): LiveSnapshot {
  return {
    id: row.id,
    createdAt: iso(row.created_at) || "",
    sourceRunId: row.source_run_id || "",
    workbookModifiedAt: iso(row.workbook_modified_at),
    gitSha: row.git_sha || "",
    rowCounts: counts(row.row_counts),
    status: row.status,
  };
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function snapshotWriteBlocked(): string | null {
  if (process.env.VERCEL_ENV) {
    return "Refusing to write a snapshot from Vercel. The sync job writes with NEON_DATABASE_URL.";
  }
  return null;
}

function prepared(input: PublishInput): { files: SnapshotFileInput[]; counts: Record<string, number> } {
  const blocked = snapshotWriteBlocked();
  if (blocked) throw new Error(blocked);
  const seen = new Set<string>();
  const files: SnapshotFileInput[] = [];
  for (const file of input.files) {
    assertFileName(file.name);
    if (seen.has(file.name)) throw new Error("A snapshot file is repeated.");
    seen.add(file.name);
    files.push({ name: file.name, body: file.body });
  }
  if (!files.length) throw new Error("Refusing to publish an empty snapshot.");
  if (files.length > 64) throw new Error("Refusing to publish this many snapshot files.");
  return { files, counts: rowCounts(files) };
}

export async function publishSnapshot(sql: Sql, input: PublishInput): Promise<PublishedSnapshot> {
  const { files, counts: storedCounts } = prepared(input);
  const id = randomUUID();
  await sql.exec("BEGIN");
  try {
    await sql.query(
      `INSERT INTO snapshots (id, source_run_id, workbook_modified_at, git_sha, row_counts, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'staged')`,
      [
        id,
        clip(input.sourceRunId || "", 128),
        input.workbookModifiedAt,
        clip(input.gitSha || "", 64),
        JSON.stringify(storedCounts),
      ],
    );
    for (const file of files) {
      const packed = packFile(file.body);
      await sql.query(
        `INSERT INTO snapshot_files (snapshot_id, name, content, bytes, sha256)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, file.name, packed.content, packed.bytes, packed.sha256],
      );
    }
    await sql.query(`SELECT id FROM snapshots WHERE status = 'live' FOR UPDATE`);
    await sql.query(`UPDATE snapshots SET status = 'archived' WHERE status = 'live'`);
    const flipped = await sql.query<{ id: string; created_at: Date | string }>(
      `UPDATE snapshots SET status = 'live' WHERE id = $1 AND status = 'staged' RETURNING id, created_at`,
      [id],
    );
    if (flipped.rows.length !== 1) throw new Error("The snapshot did not become live.");
    await sql.query(
      `DELETE FROM snapshots
       WHERE status <> 'live'
         AND created_at < clock_timestamp() - ($2::int * interval '1 hour')
         AND id NOT IN (
           SELECT id FROM snapshots
           WHERE status <> 'live'
           ORDER BY created_at DESC, id DESC
           LIMIT $1
         )`,
      [SNAPSHOTS_KEPT - 1, SNAPSHOT_HISTORY_HOURS],
    );
    await sql.exec("COMMIT");
    return { id, createdAt: iso(flipped.rows[0].created_at) || "", rowCounts: storedCounts };
  } catch (error) {
    try {
      await sql.exec("ROLLBACK");
    } catch {
      // The connection already closed the transaction.
    }
    throw error;
  }
}

/** Hash of the live snapshot's file digests, or null when nothing is live. */
export async function liveContentHash(sql: Sql): Promise<string | null> {
  const found = await sql.query<{ id: string }>(
    `SELECT id FROM snapshots WHERE status = 'live' ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const id = found.rows[0]?.id;
  if (!id) return null;
  const files = await sql.query<{ name: string; sha256: string }>(
    `SELECT name, sha256 FROM snapshot_files WHERE snapshot_id = $1`,
    [id],
  );
  if (!files.rows.length) return null;
  return hashFileDigests(files.rows);
}

export async function selectLive(sql: Sql): Promise<LiveSnapshot | null> {
  const result = await sql.query<SnapshotRow>(
    `SELECT id, created_at, source_run_id, workbook_modified_at, git_sha, row_counts, status
     FROM snapshots WHERE status = 'live' ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? mapLive(row) : null;
}

export async function selectLiveBundle(sql: Sql): Promise<SnapshotBundle | null> {
  const live = await selectLive(sql);
  if (!live) return null;
  const result = await sql.query<{ name: string; content: string; bytes: number; sha256: string }>(
    `SELECT name, content, bytes, sha256 FROM snapshot_files WHERE snapshot_id = $1`,
    [live.id],
  );
  const files: Record<string, PackedFile> = {};
  for (const row of result.rows) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(row.name)) continue;
    const packed = { content: row.content, bytes: Number(row.bytes), sha256: row.sha256 };
    unpackFile(packed);
    files[row.name] = packed;
  }
  return { id: live.id, createdAt: live.createdAt, files };
}

export async function countSnapshots(sql: Sql): Promise<number> {
  const result = await sql.query<{ n: number | string }>(`SELECT count(*)::int AS n FROM snapshots`);
  return Number(result.rows[0]?.n || 0);
}
