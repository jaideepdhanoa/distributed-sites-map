import assert from "node:assert/strict";
import test from "node:test";
import { linkedPnlIds, linksFromRecords } from "../../lib/pnl/ids.ts";

test("review scope matches a pipeline id and its linked universe id", () => {
  const links = linksFromRecords([
    { dealId: "PIPE-SAMPLE-0001", siteId: "LAS-U001" },
    { dealId: "LAND-SAMPLE-0002", siteId: "PHX-U002" },
    { dealId: "", siteId: "LAS-U001" },
  ]);
  const fromDeal = linkedPnlIds("PIPE-SAMPLE-0001", links);
  const fromSite = linkedPnlIds("LAS-U001", links);
  const fromLand = linkedPnlIds("LAND-SAMPLE-0002", links);
  assert.deepEqual(fromDeal, ["PIPE-SAMPLE-0001", "LAS-U001"]);
  assert.deepEqual(fromSite, ["LAS-U001", "PIPE-SAMPLE-0001"]);
  assert.deepEqual(fromLand, ["LAND-SAMPLE-0002", "PHX-U002"]);
  const queue = ["PIPE-OTHER-0009", "PIPE-SAMPLE-0001"];
  assert.equal(queue.find((id) => fromDeal.includes(id)), "PIPE-SAMPLE-0001");
  assert.equal(queue.find((id) => fromSite.includes(id)), "PIPE-SAMPLE-0001");
  assert.equal(queue.find((id) => fromLand.includes(id)), undefined);
});
