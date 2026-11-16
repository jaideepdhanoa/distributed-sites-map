import assert from "node:assert/strict";
import test from "node:test";
import { formatCapturedDate } from "../../lib/pnl/dateLabel.ts";
import { sampleStatement } from "../../lib/pnl/fixture.ts";
import { buildPnlGrid, columnSummary } from "../../lib/pnl/grid.ts";

function row(id: string, mode: "months" | "years" = "months") {
  const grid = buildPnlGrid(sampleStatement(), mode);
  const found = grid.rows.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return { grid, found };
}

test("a captured timestamp is shown as a calendar date", () => {
  assert.equal(formatCapturedDate("2026-03-01T15:00:00-07:00"), "Mar 1, 2026");
  assert.equal(formatCapturedDate("2026-03-01T15:00:00Z"), "Mar 1, 2026");
  assert.equal(formatCapturedDate("not-a-date"), "");
});

test("the month sheet keeps missing months empty and calculates EBITDA from captured lines", () => {
  const { grid, found } = row("labor");
  assert.deepEqual(grid.columns.map((column) => column.label), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "YTD"]);
  assert.equal(grid.columns[1]?.missing, true);
  assert.equal(found.cells[1]?.kind, "missing");
  assert.equal(found.cells[0]?.kind, "value");
  if (found.cells[0]?.kind === "value") {
    assert.equal(found.cells[0].amount, "$10,000");
    assert.match(found.cells[0].flag || "", /15–40%/);
    assert.equal(found.cells[0].capturedLabel, "Mar 1, 2026");
    assert.equal(found.cells[0].capturedLabel.includes("T"), false);
  }
  const ytd = found.cells[12];
  assert.equal(ytd?.kind, "value");
  if (ytd?.kind === "value") {
    assert.equal(ytd.amount, "$500,000");
    assert.equal(ytd.status, "reported");
  }
  const ebitda = row("ebitda").found.cells[12];
  assert.equal(ebitda?.kind, "value");
  if (ebitda?.kind === "value") {
    assert.equal(ebitda.amount, "$440,000");
    assert.equal(ebitda.status, "calculated");
  }
  const margin = row("margin").found.cells[12];
  assert.equal(margin?.kind, "value");
  if (margin?.kind === "value") assert.equal(margin.amount, "44%");
  const sde = row("sde").found.cells[12];
  assert.equal(sde?.kind, "value");
  if (sde?.kind === "value") assert.equal(sde.amount, "$520,000");
  assert.equal(row("sde").found.cells[0]?.kind, "blank");
  const march = columnSummary(grid, 2);
  assert.equal(march.revenue, "$90,000");
  assert.equal(march.costs, "$12,000");
  assert.equal(columnSummary(grid, 1).revenue, "Missing");
});

test("years view uses one column per year and does not invent a second year", () => {
  const { grid } = row("total-revenue", "years");
  assert.deepEqual(grid.columns.map((column) => column.label), ["2024"]);
  const revenue = grid.rows.find((item) => item.id === "total-revenue")?.cells[0];
  assert.equal(revenue?.kind, "value");
  if (revenue?.kind === "value") assert.equal(revenue.amount, "$1,000,000");
});
