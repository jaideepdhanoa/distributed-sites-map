import assert from "node:assert/strict";
import test from "node:test";
import { CITY_VIEW } from "../lib/filter.ts";
import {
  MARKET_VERSION,
  coversMarkets,
  marketFocus,
  marketSearchValue,
  pointBounds,
  resolveMarket,
} from "../lib/marketView.ts";

const empty = { version: null, value: null };

test("a bare visit fits every market, and a saved choice or a link still wins", () => {
  assert.equal(resolveMarket(null, empty, false), "all");
  assert.equal(resolveMarket(undefined, { version: null, value: "LAS" }, false), "all");
  assert.equal(resolveMarket(null, { version: "0", value: "PHX" }, false), "all");
  assert.equal(resolveMarket(null, { version: MARKET_VERSION, value: "LAS" }, false), "LAS");
  assert.equal(resolveMarket(null, { version: MARKET_VERSION, value: "all" }, false), "all");
  assert.equal(resolveMarket("MIA", { version: MARKET_VERSION, value: "all" }, false), "MIA");
  assert.equal(resolveMarket("PHX", empty, false), "PHX");
  assert.equal(resolveMarket("all", { version: MARKET_VERSION, value: "PHX" }, false), "all");
  assert.equal(resolveMarket("LAS", { version: MARKET_VERSION, value: "PHX" }, true), "LAS");
  assert.equal(resolveMarket(null, { version: MARKET_VERSION, value: "LAS" }, true), "site");
  assert.equal(marketSearchValue("PHX"), "PHX");
  assert.equal(marketSearchValue("LAS"), "LAS");
  assert.equal(marketSearchValue("all"), null);
  assert.equal(marketSearchValue(null), null);
});

test("the default view covers Phoenix, Las Vegas, and Miami", () => {
  const focus = marketFocus("all");
  assert.equal(focus.fit, true);
  const bounds = pointBounds([CITY_VIEW.PHX.center, CITY_VIEW.LAS.center, CITY_VIEW.MIA.center]);
  assert.ok(bounds);
  assert.equal(coversMarkets(bounds), true);
  assert.equal(marketFocus("PHX").fit, false);
  assert.equal(marketFocus("LAS").zoom, CITY_VIEW.LAS.zoom);
  assert.equal(marketFocus("MIA").center[0], CITY_VIEW.MIA.center[0]);
  assert.equal(pointBounds([]), null);
});

test("market evidence keeps a nearby maximum, a missing count and a measured zero distinct", async () => {
  const { marketEvidence, marketComparisonRows, marketColor, missingColor, readMarketMetric, sortMarketRows } = await import("../lib/marketContext");
  const deal = {trade_aadt:null, trade_aadt_max:42000, trade_washes_1mi:0, trade_washes_3mi:8} as import("../lib/types").DealProps;
  const site = {aadt_count:"1,234", aadt_year:"2023", aadt_road:"Test Ave", aadt_source:"Traffic study"} as import("../lib/types").SiteProps;
  const partial = marketEvidence(deal);
  assert.equal(partial.traffic,null);
  assert.equal(partial.maximum,42000);
  assert.notEqual(marketColor("washes",partial.washes),missingColor);
  const fallback = marketEvidence(deal,site);
  assert.equal(fallback.traffic,1234);
  assert.match(fallback.trafficNote,/2023/);
  const primary = marketEvidence({...deal,trade_aadt:900,trade_aadt_m:0},site);
  assert.match(primary.trafficNote,/0 m to segment.*Count year unavailable/);
  assert.match(primary.linkedNote,/1,234.*2023/);
  const rows = marketComparisonRows(primary);
  assert.equal(rows.find(row=>row.label==="Washes within 1 mile")?.key,0);
  assert.equal(rows.find(row=>row.label==="Traffic")?.key,900);
  assert.equal(readMarketMetric(new URLSearchParams("overlay=trafficMax%7Cwashes")),"traffic");
  assert.equal(readMarketMetric(new URLSearchParams("marketMetric=constructor")),null);
  const points = [partial,primary,fallback].map((evidence,i)=>({id:String(i),point:[0,0] as [number,number],name:"Site",city:"LAS",evidence}));
  assert.deepEqual(sortMarketRows(points,"traffic",true).map(row=>row.id),["2","1","0"]);
  assert.deepEqual(sortMarketRows(points,"traffic",false).map(row=>row.id),["1","2","0"]);
});
