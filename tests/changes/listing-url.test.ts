import assert from "node:assert/strict";
import test from "node:test";
import { LISTING_SEARCH_MESSAGE, listingSearchPage } from "../../lib/listingUrl";
import { factConflicts, normalizeApn, samePlaceAddress } from "../../lib/universeMatch";

test("a search page is rejected and a property page is kept", () => {
  assert.equal(listingSearchPage("https://www.crexi.com/search?types=retail"), true);
  assert.equal(listingSearchPage("https://crexi.com/properties?page=2"), true);
  assert.equal(listingSearchPage("https://www.crexi.com/properties/12345/sample-shop"), false);
  assert.equal(listingSearchPage("https://www.loopnet.com/search/retail-for-sale/phoenix-az/"), true);
  assert.equal(listingSearchPage("https://www.loopnet.com/Listing/900-Placeholder-Lane-Phoenix-AZ/1/"), false);
  assert.equal(listingSearchPage("https://realmo.com/car-washes/for-sale/phoenix"), true);
  assert.equal(listingSearchPage("https://realmo.com/listing/sample-shop"), false);
  assert.equal(listingSearchPage("https://www.bizbuysell.com/search/"), true);
  assert.equal(listingSearchPage("https://www.bizbuysell.com/businesses-for-sale/"), true);
  assert.equal(listingSearchPage("https://www.bizbuysell.com/business-opportunity/sample-lube/100"), false);
  assert.equal(listingSearchPage(""), false);
  assert.equal(LISTING_SEARCH_MESSAGE.includes("search page"), true);
});

test("facts conflict only when both sides name a different value", () => {
  assert.deepEqual(factConflicts({ bay_count: "4" }, { bay_count: "6", brand_type: "Independent" }), ["bay_count"]);
  assert.deepEqual(factConflicts({ bay_count: "4" }, { bay_count: "4" }), []);
  assert.deepEqual(factConflicts({}, { bay_count: "4" }), []);
  assert.equal(normalizeApn("123-45-678"), "12345678");
  assert.equal(samePlaceAddress("900 Placeholder Lane, Phoenix, AZ", "900 Placeholder Lane, Phoenix, AZ 85001"), true);
  assert.equal(samePlaceAddress("900 Placeholder Lane, Phoenix, AZ 85001", "900 Placeholder Lane, Phoenix, AZ 85002"), false);
  assert.equal(samePlaceAddress("900 Placeholder Lane", "400 Other Lane, Phoenix, AZ 85001"), false);
  assert.equal(samePlaceAddress("", "900 Placeholder Lane"), false);
});
