import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import type { Actor } from "../../lib/changes/schema";
import { financialsCard } from "../../lib/pnl/cue";
import { buildPnlGrid } from "../../lib/pnl/grid";
import { loadPnlStatement } from "../../lib/pnl/read";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const CAPTURED = "2026-03-01T15:00:00-07:00";

function monthLine(month: number, code: "revenue" | "labor", amount: string) {
  return {
    entity_type: "pnl_line",
    site_id: "PIPE-LAS-9001",
    expected_version: 0,
    source: "Sample package",
    payload: {
      grain: "monthly",
      year: 2026,
      month,
      business_type: "car_wash",
      line: code,
      amount,
      status: "reported",
      source_document: "Sample package",
      source_page: String(month),
      captured_at: CAPTURED,
    },
  };
}

function marker(year: number, month: number) {
  return {
    entity_type: "pnl_line",
    site_id: "PIPE-LAS-9001",
    expected_version: 0,
    source: "Not in package",
    payload: {
      grain: "monthly",
      year,
      month,
      business_type: "car_wash",
      missing: true,
      source_document: "Sample package",
      source_page: "Month index",
      captured_at: CAPTURED,
    },
  };
}

test("a missing month is read from the change source when the line row is not visible", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const changes = [];
  for (const month of [1, 2, 3, 4, 6, 7]) {
    changes.push(monthLine(month, "revenue", "10000"));
    changes.push(monthLine(month, "labor", "2000"));
  }
  changes.push({
    entity_type: "pnl_line",
    site_id: "PIPE-LAS-9001",
    expected_version: 0,
    source: "Sample package",
    payload: {
      grain: "annual",
      year: 2026,
      through_month: 7,
      business_type: "car_wash",
      line: "revenue",
      amount: "90000",
      status: "reported",
      source_document: "Sample package",
      source_page: "Range",
      captured_at: CAPTURED,
    },
  });
  changes.push(marker(2026, 5), marker(2025, 4));
  const written = await applyBatch(sql, muse, "markers", { changes });
  const mayId = written.results.find((row) => row.entity_id)?.entity_id;
  assert.ok(mayId);

  await sql.query(`DELETE FROM pnl_lines WHERE status = 'missing'`);

  const statement = await loadPnlStatement(sql, "PIPE-LAS-9001");
  assert.deepEqual(statement.years.find((year) => year.year === 2026)?.missingMonths, [5]);
  assert.deepEqual(statement.years.find((year) => year.year === 2025)?.missingMonths, [4]);
  const card = financialsCard(statement);
  const grid = buildPnlGrid(statement, "months", 2026);
  assert.equal(card?.coverage, "Jan–Jul 2026 · 6 of 7 months (May missing)");
  assert.equal(card?.revenue, "$60,000");
  assert.equal(card?.revenue.includes("90,000"), false);
  const may = grid.rows.find((row) => row.id === "labor")?.cells[4];
  assert.equal(may?.kind, "missing");
  if (may?.kind === "missing") {
    assert.equal(may.markerSource, "Not in package");
    assert.equal(may.sourceDocument, "Sample package");
    assert.equal(may.sourcePage, "Month index");
  }
  const april = buildPnlGrid(statement, "months", 2025);
  const aprilCell = april.rows.find((row) => row.id === "total-revenue")?.cells[3];
  assert.equal(aprilCell?.kind, "missing");
});
