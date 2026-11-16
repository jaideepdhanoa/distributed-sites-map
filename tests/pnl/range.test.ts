import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded.ts";
import { flagLine } from "../../lib/pnl/benchmarks.ts";
import { sampleStatement } from "../../lib/pnl/fixture.ts";
import { parseAmount, percentOf } from "../../lib/pnl/money.ts";
import { buildStatement, type CapturedLine } from "../../lib/pnl/statement.ts";

function line(partial: Partial<CapturedLine> & Pick<CapturedLine, "code" | "amount">): CapturedLine {
  return {
    id: partial.id || "PL-1",
    periodId: partial.periodId || "PP-1",
    grain: partial.grain || "annual",
    year: partial.year || 2024,
    month: partial.month ?? null,
    throughMonth: partial.throughMonth ?? null,
    business: partial.business || "car_wash",
    code: partial.code,
    amount: partial.amount,
    status: partial.status || "reported",
    sourceDocument: partial.sourceDocument || "Sample package",
    sourcePage: partial.sourcePage || "Sheet 2024",
    sourceHref: partial.sourceHref || "",
    capturedAt: partial.capturedAt || "2026-03-01T15:00:00-07:00",
  };
}

function money(raw: string) {
  const parsed = parseAmount(raw);
  if (!parsed) throw new Error("bad amount");
  return parsed;
}

test("a captured amount keeps its fraction and rejects a rounded shorthand", () => {
  assert.equal(parseAmount("1000000")?.raw, "1000000");
  assert.equal(parseAmount("1000000.50")?.cents, 100000050n);
  assert.equal(parseAmount("1.2 million"), null);
  assert.equal(parseAmount("1000000.5"), null);
  assert.equal(parseAmount("010"), null);
  assert.equal(percentOf(50000000n, 100000000n), "50.0%");
  assert.equal(percentOf(1250000n, 10000000n), "12.5%");
  assert.equal(percentOf(1200000n, 9000000n), "13.3%");
});

test("car wash labor outside 15–40% is flagged and an in-range line is not", () => {
  const high = flagLine({
    code: "labor",
    cents: 50000000n,
    business: "car_wash",
    revenueCents: 100000000n,
    revenueStatus: "reported",
    status: "reported",
  });
  assert.match(high?.reason || "", /50\.0% of stated revenue/);
  assert.match(high?.reason || "", /15–40%/);
  const inside = flagLine({
    code: "labor",
    cents: 20000000n,
    business: "car_wash",
    revenueCents: 100000000n,
    revenueStatus: "reported",
    status: "reported",
  });
  assert.equal(inside, null);
  const estimated = flagLine({
    code: "chemicals",
    cents: 1200000n,
    business: "car_wash",
    revenueCents: 10000000n,
    revenueStatus: "estimated",
    status: "estimated",
  });
  assert.match(estimated?.reason || "", /This figure is estimated/);
  assert.match(estimated?.reason || "", /Stated revenue on this period is estimated/);
});

test("auto service parts outside 30–45% are flagged and a missing revenue total is not invented", () => {
  const high = flagLine({
    code: "cogs",
    cents: 6000000n,
    business: "auto_service",
    revenueCents: 10000000n,
    revenueStatus: "reported",
    status: "reported",
  });
  assert.match(high?.reason || "", /60\.0% of stated revenue/);
  assert.match(high?.reason || "", /30–45%/);
  const quiet = flagLine({
    code: "cogs",
    cents: 3400000n,
    business: "auto_service",
    revenueCents: 10000000n,
    revenueStatus: "reported",
    status: "reported",
  });
  assert.equal(quiet, null);
  const noRevenue = flagLine({
    code: "labor",
    cents: 50000000n,
    business: "car_wash",
    revenueCents: null,
    revenueStatus: null,
    status: "reported",
  });
  assert.equal(noRevenue, null);
  const zero = flagLine({
    code: "labor",
    cents: 500n,
    business: "car_wash",
    revenueCents: 0n,
    revenueStatus: "reported",
    status: "reported",
  });
  assert.equal(zero, null);
});

test("a statement shows captured lines only, gaps, and add-backs apart from the result", () => {
  const statement = buildStatement([
    line({ code: "labor", amount: money("500000"), id: "PL-2" }),
    line({ code: "revenue", amount: money("1000000"), id: "PL-1" }),
    line({ code: "addback_owner_pay", amount: money("80000"), id: "PL-3", status: "estimated" }),
    line({
      id: "PL-4",
      periodId: "PP-2",
      grain: "monthly",
      month: 1,
      code: "revenue",
      amount: money("80000"),
    }),
  ]);
  assert.equal(statement.status, "ready");
  const year = statement.years[0];
  assert.equal(year?.annual?.results.length, 0);
  assert.equal(year?.annual?.costs[0]?.amount, "$500,000");
  assert.equal(year?.annual?.costs[0]?.raw, "500000");
  assert.equal(year?.annual?.costs[0]?.status, "reported");
  assert.match(year?.annual?.costs[0]?.flag?.reason || "", /15–40%/);
  assert.equal(year?.annual?.addbacks[0]?.status, "estimated");
  assert.equal(year?.annual?.addbacks[0]?.flag, null);
  assert.match(year?.coverage || "", /On file: January/);
  assert.match(year?.coverage || "", /Missing: February/);
  assert.equal(year?.months[1], null);
  assert.equal(JSON.stringify(statement).includes("ebitda"), false);
});

test("the synthetic preview flags labor, leaves EBITDA out, and names the missing months", () => {
  const statement = sampleStatement();
  const year = statement.years[0];
  const labor = year?.annual?.costs.find((item) => item.code === "labor");
  assert.equal(labor?.amount, "$500,000");
  assert.match(labor?.flag?.reason || "", /outside the car wash band of 15–40%/);
  assert.equal(year?.annual?.results.length, 0);
  assert.equal(year?.annual?.addbacks[0]?.label, "Owner pay");
  assert.match(year?.coverage || "", /Missing: February/);
  assert.equal(year?.months[0]?.costs[0]?.share, "12.5% of stated revenue");
  assert.match(year?.months[0]?.costs[0]?.flag?.reason || "", /15–40%/);
  const source = readFileSync("lib/pnl/fixture.ts", "utf8") + readFileSync("components/PnlPreview.tsx", "utf8") + readFileSync("app/financials/preview/page.tsx", "utf8");
  assert.equal(source.includes(EXCLUDED_SITE_ID), false);
  assert.match(readFileSync("app/financials/preview/page.tsx", "utf8"), /VERCEL_ENV === "production"/);
});
