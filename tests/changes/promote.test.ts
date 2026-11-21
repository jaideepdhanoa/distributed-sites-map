import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { InputError } from "../../lib/actions/text";
import { applyBatch } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { applyUniverseFolds, formatUniverseFolds, planUniverseFolds } from "../../lib/changes/universeRepair";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };

function universe(address = "910 Placeholder Lane", extra: Record<string, unknown> = {}) {
  const { sources, ...rest } = extra;
  return {
    entity_type: "site",
    expected_version: 0,
    source: "Sample map",
    payload: {
      kind: "universe",
      market: "PHX",
      name: "Sample Lube",
      address,
      category: "Quick lube",
      service_area_class: "Near 0-5",
      facts: { brand_type: "Independent", bay_count: 4 },
      sources: {
        name: "Sample map",
        market: "Sample map",
        category: "Sample map",
        address: "Sample map",
        service_area_class: "Sample map",
        brand_type: "Sample map",
        bay_count: "Sample map",
        ...(sources as Record<string, string> | undefined),
      },
      ...rest,
    },
  };
}

function pipeline(listingId: string, address = "910 Placeholder Lane", extra: Record<string, unknown> = {}) {
  const { sources, facts, ...rest } = extra;
  return {
    entity_type: "site",
    expected_version: 0,
    source: "Sample listing",
    payload: {
      kind: "pipeline",
      market: "PHX",
      listing_id: listingId,
      name: "Sample Lube",
      address,
      category: "Quick lube",
      service_area_class: "Near 0-5",
      facts: { brand_type: "Independent", bay_count: 4, ...(facts as Record<string, string> | undefined) },
      sources: {
        name: "Sample listing",
        market: "Sample listing",
        category: "Sample listing",
        address: "Sample listing",
        service_area_class: "Sample listing",
        brand_type: "Sample listing",
        bay_count: "Sample listing",
        ...(sources as Record<string, string> | undefined),
      },
      ...rest,
    },
  };
}

test("a pipeline create promotes a universe-only row and keeps its id", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const created = await applyBatch(sql, muse, "promote-universe", { changes: [universe()] });
  const universeId = created.results.find((row) => row.entity_type === "site")?.universe_id || "";
  assert.match(universeId, /^WB-PHX-\d{4}$/);

  const promoted = await applyBatch(sql, muse, "promote-pipe", { changes: [pipeline("L-9101")] });
  const site = promoted.results.find((row) => row.entity_type === "site");
  assert.match(site?.site_id || "", /^PIPE-PHX-\d{4}$/);
  assert.equal(site?.universe_id, universeId);
  const activity = promoted.results.find((row) => row.entity_type === "activity");
  assert.ok(promoted.results.some((row) => row.entity_type === "activity"));
  const line = await sql.query<{ summary: string }>(
    `SELECT payload->>'summary' AS summary FROM activities WHERE site_id = $1`,
    [site?.site_id],
  );
  assert.equal(line.rows.some((row) => row.summary === "Promoted from Universe"), true);
  const stored = await sql.query<{ site_id: string; facts: Record<string, string> }>(
    `SELECT site_id, facts FROM universe_rows WHERE universe_id = $1`,
    [universeId],
  );
  assert.equal(stored.rows[0]?.site_id, site?.site_id);
  assert.equal(stored.rows[0]?.facts.brand_type, "Independent");
  const rows = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM universe_rows");
  assert.equal(Number(rows.rows[0]?.n), 1);

  const again = await applyBatch(sql, muse, "promote-pipe", { changes: [pipeline("L-9101")] });
  assert.equal(again.replayed, true);
  assert.equal(again.results.find((row) => row.entity_type === "site")?.site_id, site?.site_id);
  const retry = await applyBatch(sql, muse, "promote-pipe-retry", { changes: [pipeline("L-9101")] });
  assert.equal(retry.results.find((row) => row.entity_type === "site")?.site_id, site?.site_id);
  const after = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM universe_rows");
  assert.equal(Number(after.rows[0]?.n), 1);
  assert.equal(activity?.entity_type, "activity");
});

test("a second pipeline site at that address stays a conflict", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await applyBatch(sql, muse, "promote-universe-2", { changes: [universe()] });
  await applyBatch(sql, muse, "promote-pipe-2", { changes: [pipeline("L-9102")] });
  await assert.rejects(
    () => applyBatch(sql, muse, "promote-pipe-3", { changes: [pipeline("L-9103")] }),
    (error: unknown) => error instanceof InputError && error.status === 409,
  );
});

test("disagreeing facts are refused and not overwritten", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await applyBatch(sql, muse, "promote-facts-u", { changes: [universe()] });
  await assert.rejects(
    () => applyBatch(sql, muse, "promote-facts-p", {
      changes: [pipeline("L-9104", "910 Placeholder Lane", { facts: { brand_type: "Local chain", bay_count: 4 } })],
    }),
    (error: unknown) => error instanceof InputError && error.status === 409 && /facts disagree/.test(String(error)),
  );
  const stored = await sql.query<{ site_id: string; facts: Record<string, string> }>(
    `SELECT site_id, facts FROM universe_rows`,
  );
  assert.equal(stored.rows[0]?.site_id, "");
  assert.equal(stored.rows[0]?.facts.brand_type, "Independent");
});

test("an APN match promotes when both sides have one", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await applyBatch(sql, muse, "promote-apn-u", {
    changes: [universe("910 Placeholder Lane", { apn: "111-22-333", sources: { apn: "Sample map" } })],
  });
  const promoted = await applyBatch(sql, muse, "promote-apn-p", {
    changes: [pipeline("L-9105", "400 Other Lane", { apn: "11122333", sources: { apn: "Sample listing" } })],
  });
  assert.match(promoted.results.find((row) => row.entity_type === "site")?.site_id || "", /^PIPE-PHX-/);
});

test("a search listing url is rejected", () => {
  assert.throws(
    () => validateBatch(muse, "search-url", {
      changes: [pipeline("L-9106", "910 Placeholder Lane", { listing_url: "https://www.crexi.com/properties?page=2", sources: { listing_url: "Sample listing" } })],
    }),
    /search page/,
  );
  assert.doesNotThrow(() => validateBatch(muse, "property-url", {
    changes: [pipeline("L-9107", "910 Placeholder Lane", { listing_url: "https://www.crexi.com/properties/12345/sample-shop", sources: { listing_url: "Sample listing" } })],
  }));
});

test("the duplicate repair lists ids and retires the extra row", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO universe_rows (universe_id, market, site_id, name, address, apn, address_key, created_by)
     VALUES
       ('WB-PHX-0229', 'PHX', '', 'Sample Lube', '910 Placeholder Lane', '', '910 placeholder lane', 'muse'),
       ('WB-PHX-0270', 'PHX', 'PIPE-PHX-0094', 'Sample Lube', '910 Placeholder Lane', '', '', 'muse')`,
  );
  await sql.query(
    `INSERT INTO sites (site_id, name, address, market, universe_id, version, updated_by)
     VALUES ('PIPE-PHX-0094', 'Sample Lube', '910 Placeholder Lane', 'PHX', 'WB-PHX-0270', 1, 'muse')`,
  );
  await sql.query(
    `INSERT INTO site_mints (listing_id, site_id, universe_id, kind, market, request_hash, actor)
     VALUES ('L-94', 'PIPE-PHX-0094', 'WB-PHX-0270', 'pipeline', 'PHX', 'hash', 'muse')`,
  );
  const plan = await planUniverseFolds(sql);
  assert.equal(formatUniverseFolds(plan), "PIPE-PHX-0094 WB-PHX-0270 -> WB-PHX-0229");
  assert.equal(formatUniverseFolds(plan).includes("Placeholder"), false);
  assert.equal(await applyUniverseFolds(sql, plan), 1);
  const kept = await sql.query<{ site_id: string; merged_into: string }>(
    `SELECT site_id, merged_into FROM universe_rows WHERE universe_id = 'WB-PHX-0229'`,
  );
  const retired = await sql.query<{ site_id: string; merged_into: string }>(
    `SELECT site_id, merged_into FROM universe_rows WHERE universe_id = 'WB-PHX-0270'`,
  );
  const site = await sql.query<{ universe_id: string }>(`SELECT universe_id FROM sites WHERE site_id = 'PIPE-PHX-0094'`);
  assert.equal(kept.rows[0]?.site_id, "PIPE-PHX-0094");
  assert.equal(retired.rows[0]?.merged_into, "WB-PHX-0229");
  assert.equal(retired.rows.length, 1);
  assert.equal(site.rows[0]?.universe_id, "WB-PHX-0229");
});
