import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { migrate } from "../lib/actions/migrate";
import { InputError } from "../lib/actions/text";
import { applyBatch } from "../lib/changes/apply";
import { validateBatch, type Actor } from "../lib/changes/schema";
import { defaultCategories, landLinks, siteInCategories } from "../lib/categories";
import { inStage } from "../lib/filter";
import { chipLabelProblem } from "../lib/chips";
import { QUICK_LUBE_LABEL } from "../lib/labels";
import { addressConflict, mergeQuickLubeCensus, quickLubeCensusSite, serviceAreaToken } from "../lib/quickLube";
import { storedScoreView } from "../lib/scoreDisplay";
import { memorySql } from "./helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };

function createLube(listingId: string, extra: Record<string, unknown> = {}) {
  return {
    entity_type: "site",
    expected_version: 0,
    source: "Sample map",
    payload: {
      kind: "pipeline",
      market: "PHX",
      listing_id: listingId,
      name: "Sample Lube",
      address: "900 Placeholder Lane",
      category: "Quick lube",
      service_area_class: "Near 0-5",
      facts: {
        brand_type: "Independent",
        bay_count: 4,
        owner_verdict: "Unknown",
        source_tag: "Sample map, Nov 20, 2026",
      },
      sources: {
        name: "Sample map",
        market: "Sample map",
        category: "Sample map",
        address: "Sample map",
        service_area_class: "Sample map",
        brand_type: "Sample map",
        bay_count: "Sample map",
        owner_verdict: "Sample map",
      },
      ...extra,
    },
  };
}

test("quick lube uses the car wash census steps and a short chip", () => {
  assert.equal(QUICK_LUBE_LABEL, "Quick lube");
  assert.equal(chipLabelProblem(QUICK_LUBE_LABEL), "");
  assert.equal(chipLabelProblem("Independent"), "");
  assert.equal(chipLabelProblem("National chain"), "");
  assert.equal(serviceAreaToken("Near 0-5"), "near_0_5");
  assert.equal(serviceAreaToken("Unclassified"), "");
  assert.equal(serviceAreaToken("Outside"), "outside");
  const site = quickLubeCensusSite({
    universeId: "WB-PHX-9001",
    siteId: "PIPE-PHX-9001",
    market: "PHX",
    name: "Sample Lube",
    address: "900 Placeholder Lane",
    category: "Quick lube",
    serviceArea: "inside",
    facts: { brand_type: "Independent" },
  });
  assert.ok(site);
  assert.equal(site.origin, "universe");
  assert.equal(inStage(site, "universe"), true);
  assert.equal(inStage(site, "in_area"), true);
  const links = landLinks([]);
  assert.equal(siteInCategories(site, links, defaultCategories()), false);
  assert.equal(siteInCategories(site, links, { ...defaultCategories(), lube: true }), true);
  const outside = quickLubeCensusSite({
    universeId: "WB-PHX-9002",
    siteId: "PIPE-PHX-9002",
    market: "PHX",
    name: "Sample Lube",
    address: "901 Placeholder Lane",
    category: "Quick lube",
    serviceArea: "outside",
  });
  assert.ok(outside);
  assert.equal(inStage(outside, "universe"), true);
  assert.equal(inStage(outside, "in_area"), false);
  const merged = mergeQuickLubeCensus({ features: [] }, [{
    universeId: "WB-PHX-9001",
    siteId: "PIPE-PHX-9001",
    market: "PHX",
    name: "Sample Lube",
    address: "900 Placeholder Lane",
    category: "Quick lube",
  }]);
  assert.equal(merged.features?.length, 1);
  assert.equal(addressConflict("900 placeholder lane", ["900 Placeholder Lane"]), true);
  assert.equal(addressConflict("", ["900 Placeholder Lane"]), false);
  const score = storedScoreView({ score: 12, economics: 0, naEconomics: true });
  assert.match(score.line, /Economics N\/A/);
  assert.equal(score.parts.find((part) => part.id === "economics")?.shown, "N/A");
  assert.doesNotMatch(score.line, /Economics 0/);
});

test("Muse can create a quick lube census row, and a repeated address conflicts", async () => {
  const parsed = validateBatch(muse, "lube-create", { changes: [createLube("L-9101")] });
  const payload = parsed.changes[0]?.payload;
  assert.equal(payload && "fields" in payload ? payload.fields.service_area_class : "", "near_0_5");
  assert.equal(payload && "facts" in payload ? payload.facts?.brand_type : "", "Independent");
  assert.throws(
    () => validateBatch(muse, "lube-blank-source", {
      changes: [createLube("L-9102", { facts: { bay_count: 2 }, sources: { name: "Sample map", market: "Sample map", category: "Sample map", address: "Sample map", service_area_class: "Sample map" } })],
    }),
    /bay_count needs a source/,
  );
  const sql = await memorySql();
  await migrate(sql);
  const created = await applyBatch(sql, muse, "lube-1", { changes: [createLube("L-9101")] });
  assert.equal(created.results[0]?.universe_id, "WB-PHX-0001");
  await assert.rejects(
    () => applyBatch(sql, muse, "lube-2", { changes: [createLube("L-9103", { name: "Other Lube" })] }),
    (error: unknown) => error instanceof InputError && error.status === 409,
  );
  assert.equal(renderToStaticMarkup(createElement("span", null, QUICK_LUBE_LABEL)).includes("·"), false);
});
