import assert from "node:assert/strict";
import test from "node:test";
import { financialsCard, packageOnFile } from "../../lib/pnl/cue.ts";
import { DEMO_PNL_SITE_ID, demoStatement } from "../../lib/pnl/demo.ts";
import { sampleStatement } from "../../lib/pnl/fixture.ts";
import { emptyStatement } from "../../lib/pnl/statement.ts";

test("a package on file is not the same as a captured P&L", () => {
  assert.equal(packageOnFile("Received", "Package on file"), true);
  assert.equal(packageOnFile("partial", ""), true);
  assert.equal(packageOnFile("Requested", ""), false);
  assert.equal(packageOnFile("Refused or unavailable", ""), false);
  assert.equal(packageOnFile("", ""), false);
  assert.equal(financialsCard(emptyStatement()), null);
});

test("the card uses the latest full year and counts every captured month", () => {
  const card = financialsCard(sampleStatement(), true);
  assert.equal(card?.revenue, "$1,000,000");
  assert.equal(card?.cashLabel, "SDE");
  assert.equal(card?.cash, "$520,000");
  assert.equal(card?.margin, "52%");
  assert.equal(card?.coverage, "FY2024 · 2 of 12 months · Sample package");
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  assert.equal(demoStatement(DEMO_PNL_SITE_ID), null);
  process.env.VERCEL_ENV = "preview";
  assert.equal(demoStatement("PIPE-LAS-0001"), null);
  assert.equal(demoStatement(DEMO_PNL_SITE_ID)?.status, "ready");
  if (previous == null) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previous;
});
