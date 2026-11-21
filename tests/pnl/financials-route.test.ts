import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { financialsHeaders, loadFinancialsPayload } from "../../lib/api/handlers/data/financials-id";
import type { Sql } from "../../lib/actions/db";
import { financialsCard } from "../../lib/pnl/cue";
import { buildPnlGrid, columnSummary } from "../../lib/pnl/grid";
import { memorySql } from "../helpers/sql";

const CAPTURED = "2026-11-16T12:00:00Z";
const DOCUMENT = "Sample package. Stand-in for the missing month.";
const SITE = "PIPE-LAS-9001";

async function period(
  sql: Sql,
  id: string,
  grain: "monthly" | "annual",
  year: number,
  month: number | null,
  throughMonth: number | null,
  missing: boolean,
  end: string,
) {
  const start = grain === "monthly" && month
    ? `${year}-${String(month).padStart(2, "0")}-01`
    : `${year}-01-01`;
  await sql.query(
    `INSERT INTO pnl_periods (
       entity_id, site_id, grain, period_start, period_end, year, month, through_month, start_month, missing, business_type, version, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, 'car_wash', 1, 'fixture')`,
    [id, SITE, grain, start, end, year, month, throughMonth, missing],
  );
}

async function line(
  sql: Sql,
  id: string,
  periodId: string,
  code: string | null,
  amount: string | null,
  status: "reported" | "missing",
  page: string,
) {
  await sql.query(
    `INSERT INTO pnl_lines (
       entity_id, period_id, site_id, line_code, amount, amount_text, status,
       source_document, source_page, source_href, captured_at, captured_at_iso, version, updated_by, deleted_at
     ) VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, '', $10::timestamptz, $11, 1, 'fixture', NULL)`,
    [id, periodId, SITE, code, amount, amount, status, status === "missing" ? DOCUMENT : "Sample package", page, CAPTURED, CAPTURED],
  );
}

test("GET /api/data/financials returns a missing month from a null line code", async () => {
  assert.equal(DOCUMENT.length, 47);
  const sql = await memorySql();
  await migrate(sql);
  const ends: Record<number, string> = { 1: "31", 2: "28", 3: "31", 4: "30", 5: "31", 6: "30", 7: "31" };
  for (const month of [1, 2, 3, 4, 6, 7]) {
    const id = `PP-S-${month}`;
    await period(sql, id, "monthly", 2026, month, null, false, `2026-${String(month).padStart(2, "0")}-${ends[month]}`);
    await line(sql, `PL-S-${month}`, id, "revenue", "10000", "reported", String(month));
  }
  await period(sql, "PP-S-RANGE", "annual", 2026, null, 7, false, "2026-07-31");
  await line(sql, "PL-S-RANGE", "PP-S-RANGE", "revenue", "90000", "reported", "Range");
  await period(sql, "PP-S-MAY", "monthly", 2026, 5, null, true, "2026-05-31");
  await line(sql, "PL-S-MAY", "PP-S-MAY", null, null, "missing", "Month index");
  for (const month of [1, 2, 3, 5]) {
    const id = `PP-S-Y-${month}`;
    await period(sql, id, "monthly", 2025, month, null, false, `2025-${String(month).padStart(2, "0")}-${ends[month]}`);
    await line(sql, `PL-S-Y-${month}`, id, "revenue", "10000", "reported", String(month));
  }
  await period(sql, "PP-S-2025", "annual", 2025, null, null, false, "2025-12-31");
  await line(sql, "PL-S-2025", "PP-S-2025", "revenue", "80000", "reported", "2025");
  await period(sql, "PP-S-APR", "monthly", 2025, 4, null, true, "2025-04-30");
  await line(sql, "PL-S-APR", "PP-S-APR", null, null, "missing", "Month index");

  const body = await loadFinancialsPayload(sql, SITE, [{ dealId: SITE, siteId: "PIPE-LAS-9002" }]);
  assert.equal(body.pnl.status, "ready");
  assert.equal(body.pnlDemo, false);
  const year2026 = body.pnl.years.find((year) => year.year === 2026);
  const year2025 = body.pnl.years.find((year) => year.year === 2025);
  assert.equal(year2026?.annual, null);
  assert.equal(year2026?.ranges.length, 1);
  assert.equal(year2026?.months[4], null);
  assert.deepEqual(year2026?.missingMonths, [5]);
  assert.equal(year2026?.missingDetails[0]?.sourcePage, "Month index");
  assert.equal(year2026?.missingDetails[0]?.sourceDocument.length, 47);
  assert.equal(year2026?.coverage.includes("Missing: May"), true);
  assert.equal(year2025?.months[3], null);
  assert.deepEqual(year2025?.missingMonths, [4]);
  assert.equal(year2025?.coverage.includes("Missing: April"), true);

  const card = financialsCard(body.pnl);
  const grid = buildPnlGrid(body.pnl, "months", 2026);
  assert.equal(card?.coverage, "Jan–Jul 2026 · 6 of 7 months (May missing)");
  assert.equal(grid.rows.find((row) => row.id === "total-revenue")?.cells[4]?.kind, "missing");
  assert.equal(columnSummary(grid, 4).revenue, "Missing");
  const april = buildPnlGrid(body.pnl, "months", 2025);
  assert.equal(april.rows.find((row) => row.id === "total-revenue")?.cells[3]?.kind, "missing");
});

test("the financials response is not cacheable and names the build", () => {
  const previous = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "abc1234deadbeef";
  const headers = financialsHeaders();
  assert.equal(headers["Cache-Control"].includes("no-store"), true);
  assert.equal(headers["Cache-Control"].includes("max-age=0"), true);
  assert.equal(headers["CDN-Cache-Control"], "no-store");
  assert.equal(headers["Vercel-CDN-Cache-Control"], "no-store");
  assert.equal(headers["x-build-sha"], "abc1234deadbeef");
  if (previous == null) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = previous;
});
