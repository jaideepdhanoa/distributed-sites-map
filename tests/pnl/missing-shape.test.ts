import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { financialsCard } from "../../lib/pnl/cue";
import { buildPnlGrid } from "../../lib/pnl/grid";
import {
  MISSING_SOURCE_DOCUMENT,
  MISSING_SOURCE_PAGE,
  MISSING_SITE,
  insertMissingMonthShape,
} from "../../lib/pnl/missingShape";
import { loadPnlStatement } from "../../lib/pnl/read";
import { memorySql } from "../helpers/sql";

test("a null line code with status missing is a missing month for the whole period", async () => {
  assert.equal(MISSING_SOURCE_DOCUMENT.length, 47);
  const sql = await memorySql();
  await migrate(sql);
  await insertMissingMonthShape(sql);

  const line = await sql.query<{
    line_code: string | null;
    amount: string | null;
    amount_text: string | null;
    status: string;
    source_page: string;
    deleted_at: string | null;
    document_length: number;
  }>(
    `SELECT line_code, amount::text, amount_text, status, source_page, deleted_at::text, length(source_document) AS document_length
     FROM pnl_lines WHERE entity_id = 'PL-000285'`,
  );
  const stored = line.rows[0];
  assert.ok(stored);
  assert.equal(stored.line_code, null);
  assert.equal(stored.amount, null);
  assert.equal(stored.amount_text, null);
  assert.equal(stored.status, "missing");
  assert.equal(stored.source_page, MISSING_SOURCE_PAGE);
  assert.equal(stored.deleted_at, null);
  assert.equal(Number(stored.document_length), 47);

  const period = await sql.query<{ grain: string; year: number; month: number; missing: boolean; business_type: string; period_start: string; period_end: string }>(
    `SELECT grain, year, month, missing, business_type, period_start::text, period_end::text
     FROM pnl_periods WHERE entity_id = 'PP-000096'`,
  );
  const mayPeriod = period.rows[0];
  assert.ok(mayPeriod);
  assert.equal(mayPeriod.grain, "monthly");
  assert.equal(Number(mayPeriod.year), 2026);
  assert.equal(Number(mayPeriod.month), 5);
  assert.equal(mayPeriod.missing, true);
  assert.equal(mayPeriod.business_type, "car_wash");
  assert.equal(String(mayPeriod.period_start).slice(0, 10), "2026-05-01");
  assert.equal(String(mayPeriod.period_end).slice(0, 10), "2026-05-31");

  const statement = await loadPnlStatement(sql, MISSING_SITE);
  assert.deepEqual(statement.years.find((year) => year.year === 2026)?.missingMonths, [5]);
  assert.deepEqual(statement.years.find((year) => year.year === 2025)?.missingMonths, [4]);
  const card = financialsCard(statement);
  const grid = buildPnlGrid(statement, "months", 2026);
  const ytd = grid.rows.find((row) => row.id === "total-revenue")?.cells[12];
  assert.equal(card?.coverage, "Jan–Jul 2026 · 6 of 7 months (May missing)");
  assert.equal(card?.revenue, "$60,000");
  assert.equal(card?.cash, "$48,000");
  assert.equal(card?.margin, "80.0%");
  assert.equal(ytd?.kind, "value");
  if (ytd?.kind === "value") assert.equal(ytd.amount, card?.revenue);
  assert.equal(card?.revenue.includes("90,000"), false);

  const may = grid.rows.find((row) => row.id === "total-revenue")?.cells[4];
  assert.equal(grid.columns[4]?.missing, true);
  assert.equal(may?.kind, "missing");
  if (may?.kind === "missing") {
    assert.equal(may.sourceDocument, MISSING_SOURCE_DOCUMENT);
    assert.equal(may.sourcePage, MISSING_SOURCE_PAGE);
    assert.equal(may.markerSource, "");
  }
  const labor = grid.rows.find((row) => row.id === "labor")?.cells[4];
  assert.equal(labor?.kind, "missing");

  const april = buildPnlGrid(statement, "months", 2025);
  const aprilCell = april.rows.find((row) => row.id === "total-revenue")?.cells[3];
  assert.equal(april.columns[3]?.missing, true);
  assert.equal(aprilCell?.kind, "missing");
  if (aprilCell?.kind === "missing") {
    assert.equal(aprilCell.sourceDocument, MISSING_SOURCE_DOCUMENT);
    assert.equal(aprilCell.sourcePage, MISSING_SOURCE_PAGE);
  }
});

test("a missing period stays missing when another line on it has an amount", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const captured = "2026-11-16T12:00:00Z";
  await sql.query(
    `INSERT INTO pnl_periods (
       entity_id, site_id, grain, period_start, period_end, year, month, through_month, start_month, missing, business_type, version, updated_by
     ) VALUES
       ('PP-900510', 'PIPE-LAS-9001', 'monthly', '2026-01-01', '2026-01-31', 2026, 1, NULL, NULL, false, 'car_wash', 1, 'fixture'),
       ('PP-900505', 'PIPE-LAS-9001', 'monthly', '2026-05-01', '2026-05-31', 2026, 5, NULL, NULL, true, 'car_wash', 1, 'fixture')`,
  );
  await sql.query(
    `INSERT INTO pnl_lines (
       entity_id, period_id, site_id, line_code, amount, amount_text, status,
       source_document, source_page, source_href, captured_at, captured_at_iso, version, updated_by
     ) VALUES
       ('PL-900510', 'PP-900510', 'PIPE-LAS-9001', 'revenue', 10000, '10000', 'reported', 'Sample package', '1', '', $1::timestamptz, $2, 1, 'fixture'),
       ('PL-900505', 'PP-900505', 'PIPE-LAS-9001', 'revenue', 50000, '50000', 'reported', 'Sample package', '5', '', $1::timestamptz, $2, 1, 'fixture'),
       ('PL-900506', 'PP-900505', 'PIPE-LAS-9001', NULL, NULL, NULL, 'missing', 'Sample package', 'Month index', '', $1::timestamptz, $2, 1, 'fixture')`,
    [captured, captured],
  );
  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  const card = financialsCard(statement);
  const grid = buildPnlGrid(statement, "months", 2026);
  assert.equal(card?.revenue, "$10,000");
  assert.equal(grid.rows.find((row) => row.id === "total-revenue")?.cells[4]?.kind, "missing");
  assert.deepEqual(statement.years.find((year) => year.year === 2026)?.missingMonths, [5]);
});

test("a linked site does not hide the other site's missing month", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const captured = "2026-11-16T12:00:00Z";
  await sql.query(
    `INSERT INTO pnl_periods (
       entity_id, site_id, grain, period_start, period_end, year, month, through_month, start_month, missing, business_type, version, updated_by
     ) VALUES
       ('PP-S-U1', 'PIPE-LAS-9002', 'monthly', '2026-01-01', '2026-01-31', 2026, 1, NULL, NULL, false, 'car_wash', 1, 'fixture'),
       ('PP-S-U6', 'PIPE-LAS-9002', 'monthly', '2026-06-01', '2026-06-30', 2026, 6, NULL, NULL, false, 'car_wash', 1, 'fixture'),
       ('PP-S-D5', 'PIPE-LAS-9001', 'monthly', '2026-05-01', '2026-05-31', 2026, 5, NULL, NULL, true, 'car_wash', 1, 'fixture'),
       ('PP-S-RANGE', 'PIPE-LAS-9002', 'annual', '2026-01-01', '2026-07-31', 2026, NULL, 7, NULL, false, 'car_wash', 1, 'fixture')`,
  );
  await sql.query(
    `INSERT INTO pnl_lines (
       entity_id, period_id, site_id, line_code, amount, amount_text, status,
       source_document, source_page, source_href, captured_at, captured_at_iso, version, updated_by
     ) VALUES
       ('PL-S-U1', 'PP-S-U1', 'PIPE-LAS-9002', 'revenue', 10000, '10000', 'reported', 'Sample package', '1', '', $1::timestamptz, $2, 1, 'fixture'),
       ('PL-S-U6', 'PP-S-U6', 'PIPE-LAS-9002', 'revenue', 10000, '10000', 'reported', 'Sample package', '6', '', $1::timestamptz, $2, 1, 'fixture'),
       ('PL-S-D5', 'PP-S-D5', 'PIPE-LAS-9001', NULL, NULL, NULL, 'missing', 'Sample package', 'Month index', '', $1::timestamptz, $2, 1, 'fixture')`,
    [captured, captured],
  );
  const statement = await loadPnlStatement(sql, ["PIPE-LAS-9001", "PIPE-LAS-9002"]);
  const year = statement.years.find((item) => item.year === 2026);
  assert.deepEqual(year?.missingMonths, [5]);
  assert.equal(year?.coverage.includes("Missing: May"), true);
  const grid = buildPnlGrid(statement, "months", 2026);
  assert.equal(grid.rows.find((row) => row.id === "total-revenue")?.cells[4]?.kind, "missing");
  assert.equal(financialsCard(statement)?.coverage.includes("(May missing)"), true);
});
