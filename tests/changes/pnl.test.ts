import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { loadPnlStatement } from "../../lib/pnl/read";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };
const reviewer: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const viewer: Actor = { id: "guest", kind: "human", role: "viewer" };

const CAPTURED = "2026-03-01T15:00:00-07:00";

function line(partial: Record<string, unknown> = {}) {
  return {
    entity_type: "pnl_line",
    site_id: "PIPE-LAS-9001",
    expected_version: 0,
    source: "Sample package",
    payload: {
      grain: "annual",
      year: 2024,
      business_type: "car_wash",
      line: "labor",
      amount: "500000",
      status: "reported",
      source_document: "Sample package",
      source_page: "Sheet 2024",
      captured_at: CAPTURED,
      ...partial,
    },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("Muse can write a captured line and a viewer, Indie, a bad clock, and a shorthand amount cannot", () => {
  assert.throws(() => validateBatch(viewer, "k1", { changes: [line()] }), /do not have permission/);
  assert.throws(() => validateBatch(indie, "k1", { changes: [line()] }), /Only Muse can write a P&L line/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ captured_at: "2026-03-01" })] }), /ISO-8601 time with a zone offset/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ captured_at: "2026-03-01T15:00:00" })] }), /ISO-8601 time with a zone offset/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ amount: "1.2 million" })] }), /captured number/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ amount: 500000 })] }), /captured number/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ grain: "monthly" })] }), /monthly period needs a month/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ month: 3 })] }), /annual period has no month/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ line: "profit" })] }), /chart of accounts/);
  assert.throws(() => validateBatch(muse, "k1", { changes: [{ ...line(), site_id: EXCLUDED_SITE_ID }] }), /not written here/);
  assert.doesNotThrow(() => validateBatch(muse, "k1", { changes: [line()] }));
  assert.doesNotThrow(() => validateBatch(reviewer, "k1", { changes: [line()] }));
});

test("a P&L write stores the exact timestamp, flags the line, and does not invent EBITDA", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, muse, "pnl-1", {
    changes: [
      line(),
      line({ line: "revenue", amount: "1000000" }),
      line({ line: "addback_owner_pay", amount: "80000", status: "estimated", source_document: "Sample notes", source_page: "Note 2" }),
      line({ grain: "monthly", month: 1, line: "revenue", amount: "80000", source_page: "Jan" }),
    ],
  });
  assert.equal(created.results.length, 4);
  assert.match(created.results[0]?.entity_id || "", /^PL-\d{6}$/);
  assert.equal(created.results[0]?.version, 1);
  const stored = await sql.query<{ amount_text: string; captured_at_iso: string; status: string }>(
    `SELECT amount_text, captured_at_iso, status FROM pnl_lines WHERE entity_id = $1`,
    [created.results[2]?.entity_id],
  );
  assert.equal(stored.rows[0]?.amount_text, "80000");
  assert.equal(stored.rows[0]?.captured_at_iso, CAPTURED);
  assert.equal(stored.rows[0]?.status, "estimated");
  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  assert.equal(statement.status, "ready");
  const annual = statement.years[0]?.annual;
  assert.equal(annual?.costs[0]?.amount, "$500,000");
  assert.match(annual?.costs[0]?.flag?.reason || "", /15–40%/);
  assert.equal(annual?.results.length, 0);
  assert.equal(annual?.addbacks[0]?.flag, null);
  assert.match(statement.years[0]?.coverage || "", /Missing: February/);
  assert.equal(statement.years[0]?.months[1], null);
  const replay = await applyBatch(sql, muse, "pnl-1", {
    changes: [
      line(),
      line({ line: "revenue", amount: "1000000" }),
      line({ line: "addback_owner_pay", amount: "80000", status: "estimated", source_document: "Sample notes", source_page: "Note 2" }),
      line({ grain: "monthly", month: 1, line: "revenue", amount: "80000", source_page: "Jan" }),
    ],
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.results[0]?.entity_id, created.results[0]?.entity_id);
  const empty = await loadPnlStatement(sql, "PIPE-LAS-9002");
  assert.equal(empty.status, "empty");
  assert.match(empty.message, /No financial package has been captured yet/);
});

test("a second create conflicts, an update keeps the source, and a bad version rolls back", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, reviewer, "pnl-create", { changes: [line({ line: "revenue", amount: "1000000" })] });
  const id = created.results[0]?.entity_id || "";
  await assert.rejects(
    () => applyBatch(sql, reviewer, "pnl-dup", { changes: [line({ line: "revenue", amount: "1000000" })] }),
    (error: unknown) => error instanceof VersionConflictError && error.conflicts[0]?.entity_id === id,
  );
  const updated = await applyBatch(sql, reviewer, "pnl-update", {
    changes: [{
      ...line({ line: "revenue", amount: "1100000", source_page: "Sheet 2024 revised" }),
      entity_id: id,
      expected_version: 1,
    }],
  });
  assert.equal(updated.results[0]?.version, 2);
  const row = await sql.query<{ amount_text: string; captured_at_iso: string; source_page: string }>(
    `SELECT amount_text, captured_at_iso, source_page FROM pnl_lines WHERE entity_id = $1`,
    [id],
  );
  assert.equal(row.rows[0]?.amount_text, "1100000");
  assert.equal(row.rows[0]?.captured_at_iso, CAPTURED);
  assert.equal(row.rows[0]?.source_page, "Sheet 2024 revised");
  await assert.rejects(() => applyBatch(sql, reviewer, "pnl-stale", {
    changes: [{ ...line({ line: "revenue", amount: "1" }), entity_id: id, expected_version: 1 }],
  }));
  const after = await sql.query<{ amount_text: string }>(`SELECT amount_text FROM pnl_lines WHERE entity_id = $1`, [id]);
  assert.equal(after.rows[0]?.amount_text, "1100000");
});
