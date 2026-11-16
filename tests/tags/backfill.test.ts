import assert from "node:assert/strict";
import test from "node:test";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { migrate } from "../../lib/actions/migrate";
import { applyTagBackfill, formatTagBackfill, planTagBackfill, readTagBackfillCounts } from "../../lib/tags/backfill";
import { memorySql } from "../helpers/sql";

const SECRET = "Call the broker at 415-555-0134 about the lot.";

test("the dry-run report is counts and hashes, and it skips the quarantined row", () => {
  const plan = planTagBackfill([
    {
      siteId: "PIPE-PHX-0104",
      market: "PHX",
      blocker: "Awaiting broker reply",
      blockerSince: "2026-11-06",
      nextStep: SECRET,
      packageStatus: "Received",
      photoStatus: "Complete",
      listed: true,
      sourceKind: "broker",
    },
    { siteId: EXCLUDED_SITE_ID, market: "PHX", blocker: "NDA execution", nextStep: SECRET },
    { siteId: "PIPE-LAS-0105", market: "LAS", excelRow: 10, blocker: "NDA execution" },
    { siteId: "PIPE-MIA-0106", market: "MIA", blocker: "A custom hold" },
  ], []);
  const report = formatTagBackfill(plan);
  assert.match(report, /count waiting_on broker_reply 1/);
  assert.match(report, /count package received 1/);
  assert.match(report, /unmapped waiting_on #/);
  assert.equal(report.includes(SECRET), false);
  assert.equal(report.includes(EXCLUDED_SITE_ID), false);
  assert.equal(report.includes("PIPE-PHX-0104"), false);
  assert.equal(plan.writes.some((row) => row.siteId === EXCLUDED_SITE_ID), false);
  assert.equal(plan.writes.some((row) => row.siteId === "PIPE-LAS-0105"), false);
  assert.equal(plan.skipped, 2);
});

test("apply writes tags and does not touch the legacy note column", async () => {
  const sql = await memorySql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO sites (site_id, market, notes, version, updated_by) VALUES ('PIPE-PHX-0104', 'PHX', 'legacy note', 1, 'tester')`,
  );
  const plan = planTagBackfill([{
    siteId: "PIPE-PHX-0104",
    market: "PHX",
    blocker: "Our-side diligence",
    blockerSince: "2026-11-02",
    packageStatus: "Refused or unavailable",
    photoStatus: "Deferred",
    listed: false,
    sourceKind: "off-market",
    nextStep: "Decide after the land check.",
  }], []);
  assert.equal(formatTagBackfill(plan).includes("Decide after"), false);
  const written = await applyTagBackfill(sql, plan);
  assert.ok(written > 0);
  const tags = await sql.query<{ code: string; since_iso: string; note: string }>(
    `SELECT code, since_iso, note FROM site_tags WHERE site_id = 'PIPE-PHX-0104' AND family = 'waiting_on'`,
  );
  assert.equal(tags.rows[0]?.code, "our_diligence");
  assert.equal(tags.rows[0]?.since_iso, "2026-11-02T12:00:00-07:00");
  const legacy = await sql.query<{ notes: string }>(`SELECT notes FROM sites WHERE site_id = 'PIPE-PHX-0104'`);
  assert.equal(legacy.rows[0]?.notes, "legacy note");
  const counts = await readTagBackfillCounts(sql);
  assert.equal(counts.some((row) => row.family === "waiting_on" && row.code === "our_diligence" && row.n === 1), true);
  const again = planTagBackfill([{
    siteId: "PIPE-PHX-0104",
    market: "PHX",
    blocker: "Our-side diligence",
  }], (await sql.query<{ site_id: string; family: string }>(`SELECT site_id, family FROM site_tags`)).rows);
  assert.equal(again.writes.length, 0);
});
