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

test("coverage counts recorded zero and separates absent, inapplicable and incompatible figures", () => {
  const samples = [
    deal({stated_revenue:0,revenue_period:"2025"}),
    deal({stated_revenue:30,revenue_period:"2024"}),
    deal({kind:"land"}), deal({stated_revenue:null,stated_revenue_display:""}),
  ];
  const row = comparisonMeasures(samples.map((item,i)=>({id:String(i),title:"Example",rows:dealRows(item,[],true)}))).find(row=>row.label==="Revenue")!;
  assert.equal(row.available,2);
  assert.equal(row.partial,true);
  assert.equal(row.kind,"basis");
  assert.deepEqual(row.values,["$0 · 2025","$30 · 2024","Not applicable","—"]);
});

test("operating evidence can be inapplicable while property valuation remains available", () => {
  const closed = deal({financials_open:false,county_value:100,county_value_display:"$100"});
  const rows = compare(closed,deal());
  assert.equal(rows.get("Revenue")?.values[0],"Not applicable");
  assert.equal(rows.get("County value (land + buildings)")?.values[0],"$100");
  const withheld = deal({stated_cash_flow:null,stated_cash_flow_display:"",figures_status:"withheld"});
  assert.match(compare(withheld,deal()).get("Cash flow")!.values[0],/not shown/i);
});

test("coverage distinguishes zero, fully missing, unavailable and inapplicable measures", () => {
  function row(...values: string[]) {
    return comparisonMeasures(values.map((value, i) => ({
      id: String(i), title: String(i), rows: [{ label: "Power", value }],
    })))[0];
  }
  assert.equal(row("—", "Not on file").allMissing, true);
  assert.equal(row("Not applicable", "—").allMissing, true);
  assert.equal(row("0", "—").available, 1);
  assert.equal(row("0", "—").partial, true);
  assert.equal(row("Unavailable", "—").allMissing, false);
  assert.equal(row("Checking…", "Unavailable", "Not applicable").missing, 0);
});

test("power citations keep street hosting, service readings and their sources independent", async () => {
  const { decisionCatalog } = await import("../../lib/actions/decisionCatalog");
  const { evidenceTarget } = await import("../../lib/actions/comparisonEvidence");
  const curb = deal({ deal_id:"curb", cap_b_frontage:0, cap_b_source:"Utility map", cap_b_as_of:"2030-04-01", cap_b_confidence:"Estimated" });
  const service = deal({ deal_id:"service", cap_b_nearby:2.1, cap_c_phase:"2 MW will-serve", cap_c_confidence:"Verified", cap_c_source:"Utility letter" });
  const rows = compare(curb,service);
  assert.deepEqual(rows.get("On-site service")?.values, ["—","2 MW · Utility letter · Verified"]);
  assert.deepEqual(rows.get("Street-frontage hosting")?.values, ["0 MW · Utility map · Estimated · 2030-04-01","—"]);
  const catalog = decisionCatalog([], [curb,service]);
  const cite = evidenceTarget("deal","curb","Street-frontage hosting")!;
  assert.equal(catalog.figure(cite)?.source,"Utility map · Estimated · 2030-04-01");
  assert.equal(catalog.figure(evidenceTarget("deal","curb","On-site service")!)?.value, "—");
  assert.ok(catalog.figure(evidenceTarget("deal","curb","Power")!));
  assert.ok(!compare(curb,service,false).has("On-site service"));
});

test("acquisition pricing preserves the actual earnings definition, dates, zero and missing estimates", async () => {
  const a = deal({ asking_price:500, land_estimate:300, business_value:200, earnings_multiple_which:"EBITDA",
    earnings_period:"FY 2030", business_multiple:2, business_multiple_display:"2.0x", saving_vs_hub:"0%" });
  const b = deal({ earnings_multiple_which:"SDE", cash_flow_label:"SDE", business_multiple:2, business_multiple_display:"2.0x" });
  const rows = compare(a,b);
  assert.deepEqual(rows.get("Implied business price")?.values,["$200","—"]);
  assert.deepEqual(rows.get("Savings versus hub")?.values,["0%","—"]);
  assert.match(rows.get("Business-only multiple")!.values[0], /2.0x · EBITDA · FY 2030/);
  assert.equal(rows.get("Business-only multiple")?.kind,"basis");
  assert.equal(compare(a, deal({business_value_display:"Land covers asking"})).get("Implied business price")?.values[1], "Land covers asking");
  assert.ok(!compare(a,b,false).has("Savings versus hub"));
});

test("comparison carries a service disagreement and distinguishes utility forecast years", () => {
  const a=deal({cap_c_amps:"400 A",cap_c_source:"Example broker",universe_id:"sample"});
  const linked={site_id:"sample",cap_c_amps:"800 A",cap_c_source:"Example panel photo"} as import("../../lib/types").SiteProps;
  const row=dealRows(a,[linked],true).find(r=>r.label==="On-site service")!;
  assert.equal(row.key,"Sources disagree");
  for (const text of ["400 A","800 A","Example broker","Example panel photo"]) assert.ok(row.value.includes(text));
  const f=compare(deal({cap_b_frontage:0,cap_b_horizon:"2028"}),deal({cap_b_frontage:0,cap_b_horizon:"2032"})).get("Street-frontage hosting");
  assert.equal(f?.kind,"basis");
  assert.ok(f.values[0].includes("2028"));
});

test("power joins accept reverse links and suppress ambiguous linked readings", async () => {
  const {catalogPowerRecords} = await import("../../lib/powerLinkIndex");
  const a=deal({deal_id:"EXAMPLE-A",universe_id:""});
  const site={site_id:"EXAMPLE-S",linked_deal_id:a.deal_id,cap_c_phase:"3-phase",cap_c_volts:480} as unknown as import("../../lib/types").SiteProps;
  const only=catalogPowerRecords([site],[a]);
  assert.equal(only.siteFor(a),site);
  assert.equal(only.dealFor(site),a);
  const other=deal({deal_id:"EXAMPLE-B",universe_id:site.site_id});
  const multiple=catalogPowerRecords([site],[a,other]);
  assert.equal(multiple.siteFor(other),undefined);
  assert.equal(multiple.dealFor(site),undefined);
  assert.equal(dealRows(other,[site],true,null).find(row=>row.label==="On-site service")?.value,"—");
});
