import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { EXCLUDED_SITE_ID, isExcludedSite } from "../../lib/alerts/excluded";
import { applyStageBackfill, assertStageBackfillApply, formatStageBackfill, loadStageBackfill } from "../../lib/changes/stageBackfill";
import { shortHash } from "../../lib/changes/site";
import { memorySql } from "../helpers/sql";

const QUIET = "PIPE-LAS-0004";
const LEGACY = "PIPE-PHX-0003";

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO sites (site_id, market, version, updated_by) VALUES ($1, 'LAS', 1, 'system'), ($2, 'PHX', 1, 'system')`,
    [QUIET, LEGACY],
  );
  await sql.query(
    `INSERT INTO site_stages (site_id, market, stage, version, updated_by) VALUES ($1, 'PHX', 'Financial screen', 1, 'workbook-sync')`,
    [LEGACY],
  );
  return sql;
}

test("the stage backfill is a dry run until apply, then it is idempotent", async () => {
  const sql = await ready();
  const plan = await loadStageBackfill(sql);
  const printed = formatStageBackfill(plan);
  assert.match(printed, /insert 1/);
  assert.match(printed, /normalize 1/);
  assert.match(printed, new RegExp(`#${shortHash(QUIET)}`));
  assert.match(printed, new RegExp(`#${shortHash(LEGACY)}`));
  assert.equal(printed.includes(QUIET), false);
  assert.equal(printed.includes(LEGACY), false);
  assert.equal(printed.includes("Financial screen"), false);
  assert.equal(printed.includes("Dropped"), false);
  const before = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", [QUIET]);
  assert.equal(before.rows.length, 0);

  assert.equal(await applyStageBackfill(sql, plan), 2);
  const quiet = await sql.query<{ stage: string; updated_by: string }>("SELECT stage, updated_by FROM site_stages WHERE site_id = $1", [QUIET]);
  assert.equal(quiet.rows[0]?.stage, "1 Desk screen");
  assert.notEqual(quiet.rows[0]?.stage, "Dropped");
  assert.equal(quiet.rows[0]?.updated_by, "system");
  const legacy = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", [LEGACY]);
  assert.equal(legacy.rows[0]?.stage, "2 Financial screen");
  const sources = await sql.query<{ source: string; actor: string }>(
    "SELECT source, actor FROM events WHERE entity_type = 'stage' ORDER BY source",
  );
  assert.deepEqual(
    sources.rows.map((row) => `${row.actor} ${row.source}`).sort(),
    ["system Initial stage for new capture", "system Legacy stage normalization"],
  );

  const again = await loadStageBackfill(sql);
  assert.equal(again.inserts.length, 0);
  assert.equal(again.normalizes.length, 0);
  assert.equal(await applyStageBackfill(sql, again), 0);
  const count = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM site_stages");
  assert.equal(Number(count.rows[0]?.n), 2);
});

test("the backfill does not plan the excluded site and refuses production", async () => {
  const sql = await ready();
  const excluded = EXCLUDED_SITE_ID;
  assert.equal(isExcludedSite(excluded), true);
  await sql.query(
    `INSERT INTO sites (site_id, market, version, updated_by) VALUES ($1, 'PHX', 1, 'system')`,
    [excluded],
  );
  const plan = await loadStageBackfill(sql);
  const printed = formatStageBackfill(plan);
  assert.equal(printed.includes(excluded), false);
  assert.equal(printed.includes(shortHash(excluded)), false);
  assert.equal(plan.inserts.some((row) => row.siteId === excluded), false);

  const saved = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    assert.throws(() => assertStageBackfillApply("postgres://localhost/app", "backfill-stages"), /production/);
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  }
  assert.throws(() => assertStageBackfillApply("postgres://localhost/app", ""), /Dry run/);
});
