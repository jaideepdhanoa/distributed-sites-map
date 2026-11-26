import test from "node:test";
import assert from "node:assert/strict";
import { compareAttention, parseOpportunities, type Opportunity } from "../../lib/selection/opportunity";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";

const offer: Opportunity = {route:"Operating acquisition", disposition:"Shortlist", rank:2, rationale:"A release is possible.",
  next:"Measure the turning aisle.", reviewedOn:"2026-01-01", owner:null, revisitOn:null,
  evidence:"https://example.org/record", offering:null};
const entry = {name:"Example premises", primary:offer, alternatives:[]};
const file = {version:1, register:null, sites:{"PIPE-LAS-9001":entry}};
test("each reviewed site has a primary opportunity and independently evaluated routes", () => {
  const host = {...offer, route:"Host agreement", disposition:"Conditional", rank:null};
  const primary = {...offer,disposition:"Close offering", rank:null};
  const value = parseOpportunities({...file,sites:{"PIPE-LAS-9001":{...entry,primary,alternatives:[host]}}});
  assert.equal(value.sites["PIPE-LAS-9001"].alternatives[0].disposition,"Conditional");
  assert.throws(()=>parseOpportunities({...file,sites:{"PIPE-LAS-9001":{...entry,alternatives:[offer]}}}));
  assert.throws(()=>parseOpportunities({...file,sites:{[EXCLUDED_SITE_ID]:entry}}));
  assert.throws(()=>parseOpportunities({...file,sites:{...file.sites,"PIPE-MIA-9002":entry}}));
  assert.throws(()=>parseOpportunities({...file,sites:{"PIPE-LAS-9001":{...entry,primary:{...offer,evidence:"javascript:alert(1)"}}}}));
});
test("prioritize separately ranked acquisition and service options and keep unreviewed leads visible", () => {
  const one={...offer,rank:1}, service:Opportunity={...one,disposition:"Service diligence",route:"Operating lease"};
  const hold:Opportunity={...offer,rank:null,disposition:"Hold"};
  assert.ok(compareAttention(one,offer)<0 && compareAttention(offer,service)<0);
  assert.ok(compareAttention(service,undefined)<0 && compareAttention(undefined,hold)<0);
});
