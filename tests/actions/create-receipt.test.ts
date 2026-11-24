import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createWithReceipt } from "../../lib/actions/createReceipt";
import { migrate } from "../../lib/actions/migrate";
import { memorySql } from "../helpers/sql";

test("a retried creation replays its result and a failed creation rolls back", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await sql.exec("CREATE TEMP TABLE sample_writes (id serial PRIMARY KEY)");
  const url = "http://localhost/api/actions/notes";
  const request = () => new Request(url, { headers: { "Idempotency-Key": randomUUID() } });
  const original = request();
  const insert = async () => (await sql.query<{ id: number }>("INSERT INTO sample_writes DEFAULT VALUES RETURNING id")).rows[0];
  let delivered = 0;
  const result = await createWithReceipt(sql, original, "writer", { text: "Draft" }, async tx => {
    tx.afterCommit?.(async () => {
      assert.equal((await sql.query("SELECT actor FROM change_receipts")).rows.length, 1);
      delivered++;
    });
    return insert();
  });
  assert.equal(delivered, 1);
  assert.deepEqual(await createWithReceipt(sql, original, "writer", { text: "Draft" }, insert), result);
  await assert.rejects(createWithReceipt(sql, original, "writer", { text: "Edited" }, insert), /draft changed/i);
  const retry = request();
  await assert.rejects(createWithReceipt(sql, retry, "writer", {}, async tx => {
    tx.afterCommit?.(async () => { delivered++; });
    await insert();
    throw new Error("interrupted");
  }), /interrupted/);
  assert.equal((await sql.query("SELECT id FROM sample_writes")).rows.length, 1);
  await createWithReceipt(sql, retry, "writer", {}, insert);
  await createWithReceipt(sql, original, "another-writer", { text: "Draft" }, insert);
  assert.equal((await sql.query("SELECT id FROM sample_writes")).rows.length, 3);
  assert.equal(delivered, 1);
});
