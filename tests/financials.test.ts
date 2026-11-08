import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDecisions,
  claimWord,
  packageLine,
  safePackageHref,
  shownAmount,
  showsFinancials,
  panelFromDeal,
} from "../lib/financials.ts";
import type { DealProps } from "../lib/types.ts";

function deal(partial: Partial<DealProps>): DealProps {
  return {
    deal_id: "PIPE-PHX-0001",
    kind: "pipeline",
    name: "Sonoran",
    address: "1523 E Southern Ave",
    city: "PHX",
    stage: "1 Desk screen",
    stage_group: "desk",
    broker: "",
    firm: "",
    listing_url: "",
    asking_price: null,
    asking_price_display: null,
    asking_price_source: "",
    next_step: "",
    universe_id: "",
    coord_status: "listing",
    miles_to_depot: null,
    listed: true,
    source_line: "",
    figures_status: "shown",
    ...partial,
  };
}

test("the card headline uses the claim word and package line", () => {
  assert.equal(claimWord(deal({ figures_basis: "Claimed" })), "Broker-stated");
  assert.equal(claimWord(deal({ figures_basis: "Documented" })), "Documented");
  assert.equal(claimWord(deal({ cash_flow_label: "Normalized EBITDA", figures_basis: "Documented" })), "Normalized");
  assert.equal(packageLine(deal({ package_status: "Received" })), "Package on file");
  assert.equal(packageLine(deal({ package_status: "partial" })), "Partial package");
  assert.equal(packageLine(deal({ package_status: "Requested" }), "2026-11-08"), "Package asked for (2026-11-08)");
  assert.equal(packageLine(deal({ package_status: "None" })), "");
  assert.equal(packageLine(deal({ package_status: "Refused or unavailable" })), "");
});

test("anonymous viewers get no package link and land gets no panel", () => {
  const href = "https://drive.google.com/drive/folders/finFolder123";
  assert.equal(safePackageHref(href, false), "");
  assert.equal(safePackageHref(href, true), href);
  assert.equal(safePackageHref("https://drive.google.com/drive/folders/1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk", true), "");
  assert.equal(showsFinancials(deal({ kind: "land", figures_status: "vacant" })), false);
  assert.equal(showsFinancials(deal({ financials_open: false, stated_cash_flow_display: "$20,212" })), false);
  const hidden = panelFromDeal(deal({ kind: "land" }));
  assert.equal(hidden.open, false);
  assert.equal(hidden.packageHref, "");
  assert.equal(JSON.stringify(hidden).includes("drive.google.com"), false);
});

test("a blank figure shows its state and a proposed addback is not counted", () => {
  assert.equal(shownAmount("", "Not asked yet"), "Not asked yet");
  assert.equal(shownAmount("$0", "Asked for", "2026-11-01"), "Asked for, waiting since 2026-11-01");
  assert.equal(shownAmount("-$121,000", "On file"), "-$121,000");
  const panel = panelFromDeal(deal({
    stated_cash_flow_display: "-$121,000",
    cash_flow_label: "EBITDA",
    figures_basis: "Documented",
    package_status: "partial",
    stage: "2 Screen",
  }));
  const stage = panelFromDeal(deal({ stage: "2 Screen" })).open;
  const next = applyDecisions(panel, [{
    status: "accepted",
    mode: "request",
    items: ["payroll", "rent"],
    owner: "Reviewer",
    askedOn: "2026-11-08",
    reason: "Request documents",
  }]);
  assert.equal(next.packageStatus, "Partial, more requested");
  assert.equal(next.checklist.find((item) => item.id === "payroll")?.state, "Asked for");
  assert.equal(next.checklist.find((item) => item.id === "payroll")?.owner, "Reviewer");
  assert.equal(stage, true);
  assert.equal(deal({ stage: "2 Screen" }).stage, "2 Screen");
  const refused = applyDecisions(panel, [{
    status: "accepted",
    mode: "package_refused",
    items: [],
    owner: "Reviewer",
    askedOn: "2026-11-08",
    reason: "Seller will share at escrow",
  }]);
  assert.equal(refused.packageStatus, "Refused or unavailable");
  assert.equal(refused.checklist[0]?.state, "Not available");
  assert.match(refused.checklist[0]?.why || "", /escrow/);
});
