import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { readGenerated, readGeneratedText } from "../../lib/guard";
import { productionRevalidateUrl } from "../../lib/snapshot/auth";
import {
  installSnapshotForTests,
  readGenerated as readFromSnapshot,
  resetSnapshotForTests,
  snapshotStatus,
} from "../../lib/snapshot/read";
import { POST, snapshotRevalidate } from "../../lib/api/handlers/data/revalidate";

test.afterEach(() => {
  resetSnapshotForTests();
});

test("with no snapshot the reader uses the committed files", () => {
  const funnel = readGenerated("funnel.json") as { stages?: { total?: number }[] };
  assert.ok((funnel.stages || []).length > 0);
  assert.equal(snapshotStatus().snapshot_source, "files");
  assert.equal(snapshotStatus().snapshot_id, null);
});

test("a live snapshot replaces the files and a reset falls back", () => {
  const fromFile = readGenerated("deals.geojson") as { features?: unknown[] };
  const fileCount = fromFile.features?.length || 0;
  assert.ok(fileCount > 0);
  installSnapshotForTests({
    id: "snap-test",
    createdAt: "2026-11-15T00:00:00.000Z",
    files: {
      "deals.geojson": JSON.stringify({ features: [{ properties: { deal_id: "PIPE-TEST" } }] }),
      "funnel.json": JSON.stringify({ stages: [{ id: "census", total: 4 }] }),
    },
  });
  const fromSnapshot = readFromSnapshot("deals.geojson") as { features?: unknown[] };
  assert.equal(fromSnapshot.features?.length, 1);
  assert.notEqual(fromSnapshot.features?.length, fileCount);
  const funnel = readGenerated("funnel.json") as { stages?: { id?: string; total?: number }[] };
  assert.equal(funnel.stages?.[0]?.total, 4);
  assert.deepEqual(snapshotStatus(), {
    snapshot_id: "snap-test",
    snapshot_created_at: "2026-11-15T00:00:00.000Z",
    snapshot_source: "database",
  });
  resetSnapshotForTests();
  const again = readGenerated("deals.geojson") as { features?: unknown[] };
  assert.equal(again.features?.length, fileCount);
  assert.equal(snapshotStatus().snapshot_source, "files");
});

test("SNAPSHOT_READ=off ignores a live snapshot", () => {
  const previous = process.env.SNAPSHOT_READ;
  installSnapshotForTests({
    id: "snap-off",
    createdAt: "2026-11-15T00:00:00.000Z",
    files: { "funnel.json": JSON.stringify({ stages: [] }) },
  });
  process.env.SNAPSHOT_READ = "off";
  try {
    const funnel = readGenerated("funnel.json") as { stages?: unknown[] };
    assert.ok((funnel.stages || []).length > 0);
    assert.equal(snapshotStatus().snapshot_source, "files");
    assert.equal(readGeneratedText("funnel.json").includes("workbook_as_of"), true);
  } finally {
    if (previous === undefined) delete process.env.SNAPSHOT_READ;
    else process.env.SNAPSHOT_READ = previous;
  }
});

test("the cache refresh rejects a missing or wrong secret", async () => {
  const previous = process.env.CRON_SECRET;
  let busts = 0;
  const original = snapshotRevalidate.bust;
  snapshotRevalidate.bust = async () => {
    busts += 1;
  };
  try {
    delete process.env.CRON_SECRET;
    const missing = await POST(new NextRequest("http://localhost/api/data/revalidate", { method: "POST" }));
    assert.equal(missing.status, 401);
    process.env.CRON_SECRET = "cron-secret";
    const wrong = await POST(new NextRequest("http://localhost/api/data/revalidate", {
      method: "POST",
      headers: { authorization: "Bearer other-secret" },
    }));
    assert.equal(wrong.status, 401);
    const bare = await POST(new NextRequest("http://localhost/api/data/revalidate", {
      method: "POST",
      headers: { authorization: "cron-secret" },
    }));
    assert.equal(bare.status, 401);
    assert.equal(busts, 0);
    const ok = await POST(new NextRequest("http://localhost/api/data/revalidate", {
      method: "POST",
      headers: { authorization: "Bearer cron-secret" },
    }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    assert.equal(busts, 1);
  } finally {
    snapshotRevalidate.bust = original;
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("cache refresh stays on the production host", () => {
  assert.equal(
    productionRevalidateUrl(undefined),
    "https://distributedsites.com/api/data/revalidate",
  );
  assert.equal(
    productionRevalidateUrl("https://www.distributedsites.com/api/data/revalidate"),
    "https://www.distributedsites.com/api/data/revalidate",
  );
  assert.throws(() => productionRevalidateUrl("https://sites-map-git-preview.vercel.app/api/data/revalidate"));
  assert.throws(() => productionRevalidateUrl("http://distributedsites.com/api/data/revalidate"));
  assert.throws(() => productionRevalidateUrl("https://distributedsites.com/api/data/deals"));
});
