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
