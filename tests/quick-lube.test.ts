import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { migrate } from "../lib/actions/migrate";
import { InputError } from "../lib/actions/text";
import { applyBatch } from "../lib/changes/apply";
import { censusRowFromStored } from "../lib/changes/read";
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
  assert.equal(siteInCategories(site, links, defaultCategories()), true);
  assert.equal(siteInCategories(site, links, { ...defaultCategories(), lube: false }), false);
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

function universeChange(extra: Record<string, unknown> = {}, address = "910 Placeholder Lane") {
  return {
    entity_type: "site",
    expected_version: 0,
    source: "Sample map",
    payload: {
      kind: "universe",
      market: "PHX",
      name: "Sample Lube",
      address,
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

test("a universe create mints a Universe id, counts in the Universe funnel, and does not open Pipeline", async () => {
  const sql = await memorySql();
  await migrate(sql);
  const created = await applyBatch(sql, muse, "universe-1", { changes: [universeChange()] });
  const result = created.results.find((row) => row.entity_type === "site");
  assert.equal(created.results.length, 1);
  assert.match(result?.universe_id || "", /^WB-PHX-\d{4}$/);
  assert.equal(result?.site_id, "");
  assert.equal(result?.entity_id, result?.universe_id);
  assert.equal(result?.listing_id, undefined);
  assert.equal((result?.site_id || "").startsWith("PIPE-"), false);
  assert.equal((result?.entity_id || "").startsWith("PIPE-"), false);

  const outside = await applyBatch(sql, muse, "universe-outside", {
    changes: [universeChange({ service_area_class: "Outside" }, "911 Placeholder Lane")],
  });
  const outsideId = outside.results.find((row) => row.entity_type === "site")?.universe_id || "";
  assert.match(outsideId, /^WB-PHX-\d{4}$/);
  assert.notEqual(outsideId, result?.universe_id);

  const stored = await sql.query<Record<string, unknown>>(
    `SELECT universe_id, site_id, listing_id, market, name, address, category, lat, lng,
            service_area_class, miles_to_depot, facts, fact_sources
     FROM universe_rows ORDER BY universe_id`,
  );
  assert.equal(stored.rows.length, 2);
  const near = stored.rows.find((row) => row.universe_id === result?.universe_id);
  assert.equal(near?.site_id, "");
  assert.equal(near?.listing_id, "");
  assert.equal(JSON.stringify(near).includes("L-"), false);
  assert.equal(JSON.stringify(near).includes("PIPE-"), false);
  const facts = near?.facts && typeof near.facts === "object" ? near.facts as Record<string, string> : {};
  assert.equal(facts.brand_type, "Independent");
  const sources = near?.fact_sources && typeof near.fact_sources === "object" ? near.fact_sources as Record<string, string> : {};
  assert.equal(sources.brand_type, "Sample map");

  const sites = stored.rows.map((row) => quickLubeCensusSite(censusRowFromStored({ ...row, listing_status: "" })));
  const counted = sites.filter((site): site is NonNullable<typeof site> => Boolean(site));
  assert.equal(counted.filter((site) => inStage(site, "universe")).length, 2);
  assert.equal(counted.filter((site) => inStage(site, "in_area")).length, 1);
  const inArea = counted.find((site) => site.site_id === result?.universe_id);
  assert.equal(inArea?.origin, "universe");
  assert.equal(inArea?.service_area_class, "near_0_5");
  assert.equal(inStage(inArea!, "in_area"), true);
  const out = counted.find((site) => site.site_id === outsideId);
  assert.equal(out?.service_area_class, "outside");
  assert.equal(inStage(out!, "universe"), true);
  assert.equal(inStage(out!, "in_area"), false);

  const pipelineSites = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM sites");
  const stages = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM site_stages");
  const mints = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM site_mints");
  const added = await sql.query<{ n: number | string }>(
    `SELECT count(*)::int AS n FROM activities WHERE payload->>'summary' = 'Site added'`,
  );
  assert.equal(Number(pipelineSites.rows[0]?.n), 0);
  assert.equal(Number(stages.rows[0]?.n), 0);
  assert.equal(Number(mints.rows[0]?.n), 0);
  assert.equal(Number(added.rows[0]?.n), 0);
  const pipelineRows = await sql.query<{ site_id: string }>(
    `SELECT site_id FROM sites WHERE site_id LIKE 'PIPE-%' OR site_id LIKE 'LAND-%'`,
  );
  assert.equal(pipelineRows.rows.length, 0);

  const retry = await applyBatch(sql, muse, "universe-1-retry", { changes: [universeChange()] });
  assert.equal(retry.replayed, false);
  assert.equal(retry.results.find((row) => row.entity_type === "site")?.universe_id, result?.universe_id);
  assert.equal(retry.results.find((row) => row.entity_type === "site")?.site_id, "");
  const afterRetry = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM universe_rows");
  assert.equal(Number(afterRetry.rows[0]?.n), 2);
  const events = await sql.query<{ n: number | string }>(
    `SELECT count(*)::int AS n FROM events WHERE entity_id = $1`,
    [result?.universe_id],
  );
  assert.equal(Number(events.rows[0]?.n), 1);

  await assert.rejects(
    () => applyBatch(sql, muse, "universe-conflict", { changes: [universeChange({ name: "Other Lube" })] }),
    (error: unknown) => error instanceof InputError && error.status === 409 && /address was already used/.test(String(error)),
  );
  const stayed = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM universe_rows");
  assert.equal(Number(stayed.rows[0]?.n), 2);
});

test("a universe create rejects a blank address, and a pipeline create still needs an L- id", () => {
  assert.throws(() => validateBatch(muse, "blank-address", { changes: [universeChange({ address: "  " })] }), /A universe row needs an address/);
  assert.throws(() => validateBatch(muse, "blank-missing", { changes: [universeChange({ address: "" })] }), /A universe row needs an address/);
  assert.throws(
    () => validateBatch(muse, "pipe-no-listing", {
      changes: [{
        entity_type: "site",
        expected_version: 0,
        source: "Sample listing",
        payload: {
          kind: "pipeline",
          market: "PHX",
          name: "Sample Wash",
          category: "Car wash",
          sources: { name: "Sample listing", market: "Sample listing", category: "Sample listing" },
        },
      }],
    }),
    /A new site needs a listing id \(L-\)/,
  );
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
