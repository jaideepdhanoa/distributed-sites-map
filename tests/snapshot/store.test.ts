import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import type { Sql } from "../../lib/actions/db";
import {
  countSnapshots,
  publishSnapshot,
  selectLive,
  SNAPSHOTS_KEPT,
  type PublishInput,
} from "../../lib/snapshot/store";
import { memorySql } from "../helpers/sql";

function input(body: string, name = "funnel.json"): PublishInput {
  return {
    sourceRunId: "run-1",
    workbookModifiedAt: "2026-11-12T00:00:00.000Z",
    gitSha: "abc1234",
    files: [{ name, body }],
  };
}

async function ready(): Promise<Sql> {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("a publish is the one live snapshot", async () => {
  const sql = await ready();
  const first = await publishSnapshot(sql, input('{"stages":[{"id":"census","total":1}]}'));
  const live = await selectLive(sql);
  assert.equal(live?.id, first.id);
  assert.equal(live?.status, "live");
  assert.equal(live?.sourceRunId, "run-1");
  assert.equal(live?.gitSha, "abc1234");
  assert.equal(live?.rowCounts["funnel.json"], 1);
  assert.equal(live?.workbookModifiedAt?.slice(0, 10), "2026-11-12");
  const second = await publishSnapshot(sql, input('{"stages":[{"id":"census","total":2},{"id":"unique","total":3}]}'));
  const next = await selectLive(sql);
  assert.equal(next?.id, second.id);
  assert.notEqual(next?.id, first.id);
  const rows = await sql.query<{ id: string; status: string }>("SELECT id, status FROM snapshots");
  assert.equal(rows.rows.find((row) => row.id === first.id)?.status, "archived");
  assert.equal(rows.rows.find((row) => row.id === second.id)?.status, "live");
});

test("a failed flip leaves the previous live snapshot", async () => {
  const sql = await ready();
  const first = await publishSnapshot(sql, input('{"ok":true}'));
  const failing: Sql = {
    async query(text, values) {
      if (text.includes("SET status = 'live'")) throw new Error("flip failed");
      return sql.query(text, values);
    },
    exec: (text) => sql.exec(text),
  };
  await assert.rejects(() => publishSnapshot(failing, input('{"ok":false}')), /flip failed/);
  const live = await selectLive(sql);
  assert.equal(live?.id, first.id);
  const staged = await sql.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM snapshots WHERE status = 'staged'",
  );
  assert.equal(Number(staged.rows[0].n), 0);
});

test("an empty publish and a preview environment do not write", async () => {
  const sql = await ready();
  await assert.rejects(
    () => publishSnapshot(sql, { sourceRunId: "run", workbookModifiedAt: null, gitSha: "", files: [] }),
    /empty snapshot/,
  );
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    await assert.rejects(() => publishSnapshot(sql, input('{"ok":true}')), /Refusing to write a snapshot/);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
  assert.equal(await selectLive(sql), null);
});

test("a failed row is not the live snapshot", async () => {
  const sql = await ready();
  await sql.query(
    `INSERT INTO snapshots (id, source_run_id, git_sha, row_counts, status)
     VALUES ('failed-row', '', '', '{}'::jsonb, 'failed')`,
  );
  assert.equal(await selectLive(sql), null);
});

test("only one live row is allowed", async () => {
  const sql = await ready();
  await publishSnapshot(sql, input('{"ok":true}'));
  await assert.rejects(() =>
    sql.query(
      `INSERT INTO snapshots (id, source_run_id, git_sha, row_counts, status)
       VALUES ('second-live', '', '', '{}'::jsonb, 'live')`,
    ),
  );
  assert.equal(await countSnapshots(sql), 1);
});

test("older snapshots are pruned to the last 14", async () => {
  const sql = await ready();
  let last = "";
  for (let index = 0; index < SNAPSHOTS_KEPT + 2; index += 1) {
    const published = await publishSnapshot(sql, input(JSON.stringify({ n: index }), "changes.json"));
    last = published.id;
  }
  assert.equal(await countSnapshots(sql), SNAPSHOTS_KEPT);
  assert.equal((await selectLive(sql))?.id, last);
});
