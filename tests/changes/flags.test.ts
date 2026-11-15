import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../lib/api/handlers/changes";
import { migrate } from "../../lib/actions/migrate";
import { importChanged } from "../../lib/changes/backfill";
import { applyStageRows } from "../../lib/changes/read";
import { changesApiEnabled, importEntityFromWorkbook, readEntityFromDb } from "../../lib/changes/flags";
import { diffDatabase } from "../../lib/changes/diff";
import { memorySql } from "../helpers/sql";

const KEYS = ["VERCEL_ENV", "CHANGES_API_ENABLED", "READ_STAGES_FROM_DB", "READ_ACTIVITY_FROM_DB", "READ_COMMS_FROM_DB", "READ_SITES_FROM_DB", "AGENT_WRITE_TOKEN_INDIE"] as const;

test("read flags cut over only when writes are on, and invalid workbook values stay unchanged", async () => {
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  const restore = () => {
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    for (const key of KEYS) delete process.env[key];
    assert.equal(readEntityFromDb("stage"), false);
    assert.equal(importEntityFromWorkbook("stage"), true);
    process.env.READ_STAGES_FROM_DB = "1";
    assert.equal(readEntityFromDb("stage"), true);
    process.env.VERCEL_ENV = "production";
    assert.equal(changesApiEnabled(), false);
    assert.equal(readEntityFromDb("stage"), false);
    assert.equal(importEntityFromWorkbook("stage"), true);
    process.env.AGENT_WRITE_TOKEN_INDIE = "indie-test-token";
    const refused = await POST(new Request("http://localhost/api/changes", {
      method: "POST",
      headers: { authorization: "Bearer indie-test-token", "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(refused.status, 403);
    assert.match(((await refused.json()) as { error: string }).error, /CHANGES_API_ENABLED/);
    process.env.CHANGES_API_ENABLED = "1";
    assert.equal(readEntityFromDb("stage"), true);
    assert.equal(importEntityFromWorkbook("stage"), false);

    const painted = applyStageRows(
      { features: [{ properties: { deal_id: "PIPE-PHX-0001", stage: "1 Desk screen", stage_group: "desk" } }] },
      [{ site_id: "PIPE-PHX-0001", stage: "Dropped" }],
    );
    assert.equal(painted.features?.[0]?.properties?.stage, "Dropped");
    assert.equal(painted.features?.[0]?.properties?.stage_group, "dropped");

    delete process.env.READ_STAGES_FROM_DB;
    delete process.env.VERCEL_ENV;
    delete process.env.CHANGES_API_ENABLED;
    const sql = await memorySql();
    await migrate(sql);
    const slice = {
      stages: [{ site_id: "PIPE-PHX-0001", stage: "1 Desk screen", market: "Phoenix", service_area_class: "", reason: "" }],
      activities: [],
      comms: [],
    };
    const imported = await importChanged(sql, slice, "bad-market");
    assert.equal(imported.inserted.stage, 0);
    assert.equal(imported.invalid.stage, 1);
    const report = await diffDatabase(sql, slice, "bad-market");
    assert.equal(report.invalid.stage[0]?.value, "Phoenix");
    assert.equal(report.clean, false);
    const rows = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM site_stages");
    assert.equal(Number(rows.rows[0]?.n), 0);
  } finally {
    restore();
  }
});