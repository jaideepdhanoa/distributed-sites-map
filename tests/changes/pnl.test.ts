import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { InputError } from "../../lib/actions/text";
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
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [line({ amount: "1.2 million" })] }),
    (error: unknown) => error instanceof InputError && error.field === "amount" && error.message.includes("amount must be a string such as \"12345\", \"12345.6\", or \"12345.00\", with at most two decimal places and no commas or symbols"),
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [line({ amount: "12345.678" })] }),
    (error: unknown) => error instanceof InputError && error.field === "amount" && error.message.includes("at most two decimal places"),
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [line({ amount: 500000 })] }),
    (error: unknown) => error instanceof InputError && error.field === "amount" && error.message.includes("amount must be a string such as \"12345\", \"12345.6\", or \"12345.00\", not a number"),
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [line({ source_page: 4 })] }),
    (error: unknown) => error instanceof InputError && error.field === "source_page" && error.message.includes("source_page must be a string"),
  );
  assert.throws(
    () => validateBatch(muse, "k1", { changes: [line({ captured_at: undefined })] }),
    (error: unknown) => error instanceof InputError && error.field === "captured_at" && error.message.includes("captured_at is required"),
  );
  assert.doesNotThrow(() => validateBatch(muse, "k1", { changes: [line({ amount: "12345.6" })] }));
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ grain: "monthly" })] }), (error: unknown) => error instanceof InputError && error.field === "month");
  assert.throws(() => validateBatch(muse, "k1", { changes: [line({ month: 3 })] }), (error: unknown) => error instanceof InputError && error.field === "month");
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
  assert.match(statement.years[0]?.coverage || "", /On file: January/);
  assert.doesNotMatch(statement.years[0]?.coverage || "", /Missing/);
  assert.equal(statement.years[0]?.months[1], null);
  assert.deepEqual(statement.years[0]?.missingMonths, []);
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
  assert.match(empty.message, /No P&L captured yet/);
  assert.match(empty.message, /broken into line items/);
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

test("stated is stored as reported, and a normalized line can sit beside it", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, muse, "pnl-basis", {
    changes: [
      line({ status: "stated", amount: "500000" }),
      line({ status: "normalized", amount: "450000", source_page: "Normalized sheet" }),
    ],
  });
  assert.equal(created.results.length, 2);
  const rows = await sql.query<{ status: string; amount_text: string }>(
    `SELECT status, amount_text FROM pnl_lines ORDER BY status`,
  );
  assert.deepEqual(rows.rows.map((row) => row.status), ["normalized", "reported"]);
  assert.deepEqual(rows.rows.map((row) => row.amount_text), ["450000", "500000"]);
  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  assert.equal(statement.years[0]?.annual?.costs[0]?.amount, "$500,000");
  assert.equal(statement.years[0]?.annual?.costs[0]?.status, "reported");
  assert.equal(statement.years[0]?.annual?.costs[0]?.normalized?.raw, "450000");
  assert.equal(statement.hasNormalized, true);
  assert.equal(statement.normalizedYears[0]?.annual?.costs[0]?.amount, "$450,000");
  assert.equal(statement.normalizedYears[0]?.annual?.costs[0]?.status, "normalized");
  const accepted = validateBatch(muse, "k-reported", { changes: [line({ status: "reported" })] });
  assert.equal(accepted.changes[0] && "status" in accepted.changes[0].payload ? accepted.changes[0].payload.status : "", "reported");
});

test("a fiscal year, two partials, and the full year are different periods", async () => {
  const sql = await ready();
  await applyBatch(sql, muse, "pnl-periods", {
    changes: [
      line({ year: 2026, amount: "1000000", line: "revenue", source_page: "FY2026" }),
      line({ year: 2026, through_month: 4, amount: "300000", line: "revenue", source_page: "Jan-Apr" }),
      line({ year: 2026, through_month: 7, amount: "600000", line: "revenue", source_page: "Jan-Jul" }),
      line({ year: 2025, start_month: 10, amount: "900000", line: "revenue", source_page: "FY Oct" }),
    ],
  });
  const periods = await sql.query<{ period_start: string | Date; period_end: string | Date; start_month: number | null }>(
    `SELECT period_start::text, period_end::text, start_month FROM pnl_periods ORDER BY period_start, period_end`,
  );
  const spans = periods.rows.map((row) => `${String(row.period_start).slice(0, 10)}..${String(row.period_end).slice(0, 10)}`);
  assert.deepEqual(spans, [
    "2025-10-01..2026-09-30",
    "2026-01-01..2026-04-30",
    "2026-01-01..2026-07-31",
    "2026-01-01..2026-12-31",
  ]);
  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  const fiscal = statement.years.find((item) => item.columnLabel === "FY2026");
  assert.equal(fiscal?.annual?.title, "October 2025–September 2026");
  assert.equal(fiscal?.annual?.periodStart, "2025-10-01");
  const calendar = statement.years.find((item) => item.year === 2026);
  assert.equal(calendar?.annual?.columnLabel, "2026");
  assert.deepEqual(calendar?.ranges.map((period) => period.columnLabel), ["Jan–Apr 2026", "Jan–Jul 2026"]);
});

test("an explicit missing month is labeled Missing and an unmarked month stays blank", async () => {
  const sql = await ready();
  await applyBatch(sql, muse, "pnl-missing", {
    changes: [
      line({ grain: "monthly", month: 1, line: "revenue", amount: "80000", source_page: "Jan" }),
      {
        ...line(),
        payload: {
          grain: "monthly",
          year: 2024,
          month: 2,
          business_type: "car_wash",
          missing: true,
          source_document: "Sample package",
          source_page: "Month index",
          captured_at: CAPTURED,
        },
      },
    ],
  });
  const stored = await sql.query<{ status: string; amount_text: string | null; line_code: string | null }>(
    `SELECT status, amount_text, line_code FROM pnl_lines WHERE status = 'missing'`,
  );
  assert.equal(stored.rows[0]?.status, "missing");
  assert.equal(stored.rows[0]?.amount_text, null);
  assert.equal(stored.rows[0]?.line_code, null);
  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  assert.deepEqual(statement.years[0]?.missingMonths, [2]);
  assert.match(statement.years[0]?.coverage || "", /On file: January/);
  assert.match(statement.years[0]?.coverage || "", /Missing: February/);
  assert.doesNotMatch(statement.years[0]?.coverage || "", /March/);
  assert.equal(statement.years[0]?.months[0]?.revenue[0]?.amount, "$80,000");
  assert.equal(statement.years[0]?.months[1], null);
});

test("one decimal place is stored as written, and a mid-month end can sit beside the full year", async () => {
  const sql = await ready();
  await applyBatch(sql, muse, "pnl-mid", {
    changes: [
      line({ year: 2026, line: "revenue", amount: "12345.6", source_page: "Full year" }),
      line({ year: 2026, line: "revenue", amount: "400000", period_end: "2026-06-14", source_page: "Seller statement" }),
    ],
  });
  const amounts = await sql.query<{ amount_text: string }>(`SELECT amount_text FROM pnl_lines ORDER BY amount_text`);
  assert.deepEqual(amounts.rows.map((row) => row.amount_text), ["12345.6", "400000"]);
  const periods = await sql.query<{ period_end: string }>(`SELECT period_end::text FROM pnl_periods ORDER BY period_end`);
  assert.deepEqual(periods.rows.map((row) => String(row.period_end).slice(0, 10)), ["2026-06-14", "2026-12-31"]);
  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  const labels = [statement.years[0]?.annual?.columnLabel, ...(statement.years[0]?.ranges.map((period) => period.columnLabel) ?? [])];
  assert.deepEqual(labels, ["2026", "Jan 1 - Jun 14 2026"]);
  assert.throws(
    () => validateBatch(muse, "k-end", { changes: [line({ period_end: "2026-02-31" })] }),
    (error: unknown) => error instanceof InputError && error.field === "period_end",
  );
  assert.throws(
    () => validateBatch(muse, "k-full", { changes: [line({ period_end: "2026-12-31", year: 2026 })] }),
    (error: unknown) => error instanceof InputError && error.field === "period_end" && /full year/.test(error.message),
  );
});

test("only Muse can retract a line, and the row and the event stay", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, muse, "pnl-keep", { changes: [line({ amount: "12345.6", line: "labor" })] });
  const id = created.results[0]?.entity_id || "";
  assert.throws(
    () => validateBatch(indie, "k-retract", { changes: [{ ...line(), entity_id: id, expected_version: 1, payload: { retract: true, reason: "Duplicate sample line", at: CAPTURED } }] }),
    /Only Muse can retract/,
  );
  assert.throws(
    () => validateBatch(reviewer, "k-retract", { changes: [{ ...line(), entity_id: id, expected_version: 1, payload: { retract: true, reason: "Duplicate sample line", at: CAPTURED } }] }),
    /Only Muse can retract/,
  );
  assert.throws(
    () => validateBatch(muse, "k-retract", { changes: [{ ...line(), entity_id: id, expected_version: 1, payload: { retract: true } }] }),
    (error: unknown) => error instanceof InputError && error.field === "reason",
  );
  const retracted = await applyBatch(sql, muse, "pnl-retract", {
    changes: [{ ...line(), entity_id: id, expected_version: 1, payload: { retract: true, reason: "Duplicate sample line", at: CAPTURED } }],
  });
  assert.equal(retracted.results[0]?.version, 2);
  const row = await sql.query<{ amount_text: string; delete_reason: string; deleted_by: string; deleted_at_iso: string }>(
    `SELECT amount_text, delete_reason, deleted_by, deleted_at_iso FROM pnl_lines WHERE entity_id = $1`,
    [id],
  );
  assert.equal(row.rows[0]?.amount_text, "12345.6");
  assert.equal(row.rows[0]?.delete_reason, "Duplicate sample line");
  assert.equal(row.rows[0]?.deleted_by, "muse");
  assert.equal(row.rows[0]?.deleted_at_iso, CAPTURED);
  const event = await sql.query<{ actor: string; payload: { retract?: boolean; reason?: string; actor?: string; at?: string } }>(
    `SELECT actor, payload FROM events WHERE entity_id = $1 AND payload->>'retract' = 'true'`,
    [id],
  );
  assert.equal(event.rows[0]?.actor, "muse");
  assert.equal(event.rows[0]?.payload.reason, "Duplicate sample line");
  assert.equal(event.rows[0]?.payload.actor, "muse");
  assert.equal(event.rows[0]?.payload.at, CAPTURED);
  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  assert.equal(statement.status, "empty");
  const again = await applyBatch(sql, muse, "pnl-again", { changes: [line({ amount: "12345.6", line: "labor" })] });
  assert.notEqual(again.results[0]?.entity_id, id);
  const visible = await loadPnlStatement(sql, "PIPE-LAS-9001");
  assert.equal(visible.years[0]?.annual?.costs[0]?.raw, "12345.6");
});
