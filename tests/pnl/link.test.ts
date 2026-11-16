import assert from "node:assert/strict";
import test from "node:test";
import type { Sql } from "../../lib/actions/db.ts";
import { recordLinks } from "../../lib/actions/records.ts";
import { linkedPnlIds, loadPnlStatement } from "../../lib/pnl/read.ts";

test("a pipeline deal and its universe site share one P&L id list", async () => {
  const links = await recordLinks();
  assert.deepEqual(linkedPnlIds("PIPE-LAS-0011", links), ["PIPE-LAS-0011", "LAS-U858"]);
  assert.deepEqual(linkedPnlIds("LAS-U858", links), ["LAS-U858", "PIPE-LAS-0011"]);
  assert.deepEqual(linkedPnlIds("PIPE-LAS-0099", [{ dealId: "PIPE-LAS-0099", siteId: "" }]), ["PIPE-LAS-0099"]);
});

test("lines stored on the pipeline id render when the read starts from the universe site", async () => {
  const sql = {
    async query(_text: string, values?: unknown[]) {
      const ids = values?.[0];
      assert.deepEqual(ids, ["LAS-U858", "PIPE-LAS-0011"]);
      return {
        rows: [{
          site_id: "PIPE-LAS-0011",
          period_id: "PP-000001",
          grain: "annual",
          year: 2024,
          month: null,
          through_month: null,
          business_type: "car_wash",
          line_id: "PL-000001",
          line_code: "revenue",
          amount_text: "1000000.00",
          status: "reported",
          source_document: "Seller package",
          source_page: "2024",
          source_href: "",
          captured_at_iso: "2026-03-01T15:00:00-07:00",
        }],
      };
    },
  } as Sql;
  const statement = await loadPnlStatement(sql, ["LAS-U858", "PIPE-LAS-0011"]);
  assert.equal(statement.status, "ready");
  assert.equal(statement.years[0]?.annual?.revenue[0]?.amount, "$1,000,000.00");
});
