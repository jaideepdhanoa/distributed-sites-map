import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { readGenerated, readGeneratedText } from "../../lib/guard";
import { SAFE_FILE_NAME, unpackFile, workbookModifiedAt } from "../../lib/snapshot/pack";
import { installSnapshotForTests, resetSnapshotForTests } from "../../lib/snapshot/read";
import { publishSnapshot, selectLive, selectLiveBundle } from "../../lib/snapshot/store";
import { memorySql } from "../helpers/sql";

function featureCount(value: unknown): number {
  const features = (value as { features?: unknown[] } | null)?.features;
  return Array.isArray(features) ? features.length : -1;
}

function funnelTotals(value: unknown): Record<string, number> {
  const stages = (value as { stages?: { id?: string; total?: number }[] } | null)?.stages || [];
  const totals: Record<string, number> = {};
  for (const stage of stages) {
    if (stage.id && typeof stage.total === "number") totals[stage.id] = stage.total;
  }
  return totals;
}

test("the site reads the same counts from a database snapshot as from the files", async () => {
  const dir = join(process.cwd(), "data", "generated");
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SAFE_FILE_NAME.test(name) && /\.(json|geojson|csv)$/.test(name))
    .sort()
    .map((name) => ({ name, body: readFileSync(join(dir, name), "utf8") }));
  assert.ok(files.some((file) => file.name === "deals.geojson"));
  assert.ok(files.some((file) => file.name === "sites.geojson"));
  assert.equal(files.some((file) => file.name === "photos"), false);

  const fromFiles = {
    deals: featureCount(JSON.parse(files.find((file) => file.name === "deals.geojson")!.body)),
    sites: featureCount(JSON.parse(files.find((file) => file.name === "sites.geojson")!.body)),
    funnel: funnelTotals(JSON.parse(files.find((file) => file.name === "funnel.json")!.body)),
  };

  const sql = await memorySql();
  await migrate(sql);
  const published = await publishSnapshot(sql, {
    sourceRunId: "counts",
    workbookModifiedAt: workbookModifiedAt(files.find((file) => file.name === "funnel.json")?.body),
    gitSha: "deadbeef",
    files,
  });
  const live = await selectLive(sql);
  assert.equal(live?.id, published.id);
  assert.equal(live?.rowCounts["deals.geojson"], fromFiles.deals);
  assert.equal(live?.rowCounts["sites.geojson"], fromFiles.sites);
  const bundle = await selectLiveBundle(sql);
  assert.ok(bundle);
  const texts: Record<string, string> = {};
  for (const [name, packed] of Object.entries(bundle.files)) texts[name] = unpackFile(packed);
  installSnapshotForTests({ id: bundle.id, createdAt: bundle.createdAt, files: texts });
  try {
    const servedDeals = featureCount(readGenerated("deals.geojson"));
    const servedSites = featureCount(readGenerated("sites.geojson"));
    const servedFunnel = funnelTotals(readGenerated("funnel.json"));
    assert.equal(servedDeals, fromFiles.deals);
    assert.equal(servedSites, fromFiles.sites);
    assert.deepEqual(servedFunnel, fromFiles.funnel);
    for (const file of files) {
      const served = readGeneratedText(file.name);
      const hash = (body: string) => createHash("sha256").update(body).digest("hex");
      assert.equal(hash(served), hash(file.body), file.name);
    }
  } finally {
    resetSnapshotForTests();
  }
});
