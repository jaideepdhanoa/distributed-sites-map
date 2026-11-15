import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { contentSha256 } from "../../lib/snapshot/pack";
import { generatedContentHash, hashFileDigests } from "../../lib/snapshot/hash";
import { liveContentHash, publishSnapshot } from "../../lib/snapshot/store";
import { memorySql } from "../helpers/sql";

const files = [
  { name: "b.json", body: "{}\n" },
  { name: "a.json", body: "[]" },
];

test("the content hash is the ordered file digests", () => {
  const forward = generatedContentHash(files);
  const backward = generatedContentHash([...files].reverse());
  assert.equal(forward, backward);
  assert.equal(
    forward,
    hashFileDigests(files.map((file) => ({ name: file.name, sha256: contentSha256(file.body) }))),
  );
  assert.notEqual(forward, generatedContentHash([{ name: "a.json", body: "[]" }]));
  assert.equal(forward.length, 64);
});

test("the python hash matches the snapshot hash and skips other files", () => {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-hash-"));
  try {
    writeFileSync(join(dir, "b.json"), "{}\n");
    writeFileSync(join(dir, "a.json"), "[]");
    writeFileSync(join(dir, "notes.txt"), "skip");
    writeFileSync(join(dir, ".hidden.json"), "{}");
    const ran = spawnSync("python3", ["scripts/snapshot_hash.py", dir], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout.trim(), generatedContentHash(files));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the live snapshot hash matches the files that were published", async () => {
  const sql = await memorySql();
  await migrate(sql);
  assert.equal(await liveContentHash(sql), null);
  await publishSnapshot(sql, {
    sourceRunId: "run-1",
    workbookModifiedAt: null,
    gitSha: "abc",
    files,
  });
  assert.equal(await liveContentHash(sql), generatedContentHash(files));
  await publishSnapshot(sql, {
    sourceRunId: "run-2",
    workbookModifiedAt: null,
    gitSha: "def",
    files: [{ name: "a.json", body: "[1]" }],
  });
  assert.equal(
    await liveContentHash(sql),
    generatedContentHash([{ name: "a.json", body: "[1]" }]),
  );
});
