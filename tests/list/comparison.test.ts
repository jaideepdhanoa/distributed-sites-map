import test from "node:test";
import assert from "node:assert/strict";
import { comparisonMeasures, dealRows } from "../../lib/comparison";
import type { DealProps } from "../../lib/types";

function deal(changes: Partial<DealProps> = {}) {
  return { deal_id: "example", kind: "pipeline", stage_group: "financial", address: "Example Avenue",
    asking_price: 100, asking_price_display: "$100", asking_price_source: "Example source",
    stated_cash_flow: 20, stated_cash_flow_display: "$20", earnings_period: "2024", cash_flow_label: "EBITDA",
    ...changes } as DealProps;
}
const compare = (a: DealProps, b: DealProps, signedIn = true) => new Map(comparisonMeasures([a, b].map(record => ({
  id: record.deal_id, title: record.address, rows: dealRows(record, [], signedIn),
}))).map(row => [row.label, row]));

test("comparison uses decision values and exposes provenance without counting different wording", () => {
  const rows = compare(deal(), deal({ address: "Example Road", asking_price_source: "Another source", next_step: "Request the survey" }));
  assert.equal(rows.get("Address")?.kind, "detail");
  assert.equal(rows.get("Asking")?.kind, "shared");
  assert.notEqual(rows.get("Asking")?.values[0], rows.get("Asking")?.values[1]);
  assert.equal(rows.get("Next check")?.kind, "detail");
  assert.equal(compare(deal(), deal({ asking_price: null, asking_price_display: null })).get("Asking")?.kind, "gap");
  assert.equal(compare(deal(), deal({ asking_price: 0, asking_price_display: "$0" })).get("Asking")?.kind, "different");
});

test("financial comparison flags different periods and measures without exposing signed-out figures", () => {
  for (const change of [{ earnings_period: "2023" }, { cash_flow_label: "SDE" }]) {
    assert.equal(compare(deal(), deal(change)).get("Cash flow")?.kind, "basis");
  }
  const hidden = compare(deal(), deal({ stated_cash_flow: 30 }), false);
  assert.equal(hidden.get("Cash flow")?.kind, "empty");
  assert.deepEqual(hidden.get("Cash flow")?.values, ["—", "—"]);
  assert.ok(!hidden.has("Figure basis"));
});


test("shortlist claims require links to selected evidence", async () => {
  const { citedShortlistAnswer } = await import("../../lib/ask/policy");
  const sources = [{ label: "Parcel", href: "/?site=EXAMPLE-A" }];
  assert.equal(citedShortlistAnswer("Recorded on the [parcel](/?site=EXAMPLE-A).",sources).gap,false);
  assert.equal(citedShortlistAnswer("Recorded on the [parcel](/?site=OTHER).",sources).gap,true);
  assert.equal(citedShortlistAnswer("Recorded on the [parcel](/?site=EXAMPLE-A).\n\nRevenue is verified.",sources).gap,true);
});

test("EBITDA keeps normalized and stated bases explicit and never substitutes SDE", () => {
  const rows = compare(deal({cash_flow_label:"Normalized EBITDA"}),deal({cash_flow_label:"SDE"}));
  const ebitda = rows.get("EBITDA");
  assert.match(ebitda!.values[0],/Normalized EBITDA/);
  assert.equal(ebitda!.values[1],"—");
  assert.equal(ebitda!.kind,"gap");
  assert.equal(compare(deal({cash_flow_label:"Normalized EBITDA"}),deal({cash_flow_label:"EBITDA"})).get("EBITDA")?.kind,"basis");
});
