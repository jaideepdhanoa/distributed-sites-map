import assert from "node:assert/strict";
import test from "node:test";
import {displayedPriceDelta} from "../../lib/charging/pipelineCost";

test("price changes reconcile the two displayed prices, including negative prices and half cents",()=>{
  assert.equal(displayedPriceDelta(13.536,10.154),3.39);
  assert.equal(displayedPriceDelta(10.154,13.536),-3.39);
  assert.equal(displayedPriceDelta(1.005,-1.005),2.02);
  assert.equal(displayedPriceDelta(10.151,10.154),0);
});
