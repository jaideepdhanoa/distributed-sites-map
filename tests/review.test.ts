import assert from "node:assert/strict";
import test from "node:test";
import { leadSourceLine } from "../lib/format";
import { plainVerdict, stageDetail, stageTitle, statusOf, uncheckedNote } from "../lib/labels";
import type { DealProps, SiteProps } from "../lib/types";

function site(partial: Partial<SiteProps>): SiteProps {
  return {
    site_id: "PHX-U1",
    city: "PHX",
    name: "Example",
    address: "1 Main St",
    apn: "1",
    coord_status: "known",
    site_class: "Core",
    in_area: true,
    service_ring: "service",
    expansion_horizon: false,
    duplicate_of: null,
    counts_as_site: true,
    lot_ac: 1,
    owner: "Owner",
    tenure: "",
    spare_ac_own: null,
    spare_ac_own_text: "",
    spare_ac_adjoining: null,
    spare_ac_adjoining_text: "",
    verdict: null,
    land_tier: null,
    land_control: "",
    network_status: null,
    reconciliation_tier: "",
    second_review_verdict: null,
    verdict_disagreement: false,
    acreage_note: "",
    scale_note: "",
    confidence: "low",
    listed: false,
    contacted: false,
    asking_price: null,
    asking_price_display: null,
    asking_price_source: "",
    asking_price_url: "",
    asking_price_date: "",
    asking_price_status: null,
    pipeline_stage: null,
    pipeline_id: null,
    land_only: false,
    on_land_tab: false,
    quarantine: false,
    flood_zone: "",
    zoning: "",
    tank_status: "",
    utility_proximity: "",
    aerial_fit: "",
    verification: "not screened",
    elimination_reason: "",
    tenure_fail: false,
    is_held_fit: false,
    tier_from_adjoining: false,
    is_candidate: false,
    miles_to_depot: null,
    evidence: "",
    operating: "",
    agreement: "",
    county_url: "",
    street_view_url: "",
    why_stopped: "",
    fields: {},
    reviews: [],
    origin: "universe",
    ...partial,
  };
}

function deal(partial: Partial<DealProps> = {}): DealProps {
  return {
    deal_id: "PIPE-PHX-0008",
    kind: "pipeline",
    name: "Repair shop",
    address: "1 Main",
    city: "PHX",
    stage: "Dropped",
    stage_group: "dropped",
    broker: "BizBuySell",
    firm: "Not shown",
    listing_url: "",
    asking_price: null,
    asking_price_display: null,
    asking_price_source: "BizBuySell",
    next_step: "",
    universe_id: "",
    coord_status: "failed",
    miles_to_depot: null,
    listed: false,
    source_line: "BizBuySell",
    source_kind: "broker",
    ...partial,
  };
}

test("lead source is off-market only for an off-market workbook lead", () => {
  assert.equal(leadSourceLine(site({ origin: "off-market" })), "Off-market");
  assert.equal(leadSourceLine(site({ lead_source: "None (off market)" })), "Off-market");
  assert.equal(leadSourceLine(site({}), deal({ source_kind: "off-market", lead_source: "None (off market)" })), "Off-market");
  assert.equal(leadSourceLine(site({}), deal()), "BizBuySell");
  assert.equal(leadSourceLine(site({}), deal({ broker: "", firm: "", source_line: "Broker", listing_url: "" })), "Broker (name not shown)");
  assert.equal(leadSourceLine(site({ origin: "universe" })), "Census site");
  assert.equal(leadSourceLine(site({ listed: true, asking_price_source: "listings_v2 (web, Nov 2 2026)" })), "Census site");
  assert.equal(leadSourceLine(site({ listed: true, listing_url: "https://www.loopnet.com/Listing/1" })), "LoopNet");
  assert.equal(leadSourceLine(site({ listed: false, research_sources: "Maricopa County parcel" })), "Off-market");
});

test("unchecked status follows the aerial result and lists say Not reviewed", () => {
  assert.equal(plainVerdict(null), "Not reviewed");
  assert.equal(plainVerdict(""), "Not reviewed");
  assert.equal(plainVerdict("PASS"), "Cleared");
  assert.equal(statusOf({ aerial_fit: "FIT_10" }).label, "County record not reviewed");
  assert.equal(uncheckedNote("FIT_4"), "Aerial review shows room; county parcel record not reviewed yet");
  assert.equal(uncheckedNote("NO_FIT"), "Aerial review found too little spare land; county parcel record not reviewed");
  assert.match(statusOf({ aerial_fit: "NO_FIT" }).note, /too little spare land/);
  assert.doesNotMatch(statusOf({ aerial_fit: "NO_FIT" }).note, /suggests the land fits/);
});

test("stage 3 is shown as Site checks", () => {
  assert.equal(stageTitle("checks"), "Site checks");
  assert.equal(stageDetail("3 Site checks", "checks"), "Site checks");
  assert.equal(stageTitle("financial"), "Financial screen");
  assert.equal(stageTitle("close"), "Offer and close");
});
