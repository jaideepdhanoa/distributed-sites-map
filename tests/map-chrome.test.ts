import assert from "node:assert/strict";
import test from "node:test";
import { AREA_LABELS, AREA_PAINT, areaRole, miamiAreaLabels } from "../lib/areas.ts";
import { areaTip, ringTip } from "../lib/markerTip.ts";
import { nearbyWashPoints } from "../lib/nearbyWashes.ts";
import { FUNNEL_VERSION, resolveFunnelMode } from "../lib/funnelMode.ts";
import { PIN_LABEL_VERSION, resolvePinLabel } from "../lib/pinLabel.ts";
import { pipelineMapSummary } from "../lib/mapSummary.ts";
import { droppedDealsShown, parsePipeView, pipelineStageFilter, stageLandShown } from "../lib/pipeStage.ts";
import { AREA_TIP_DWELL_MS, boxesOverlap, placeReadableTip, type TipBox } from "../lib/tipPlace.ts";
import { depotRingFeatures, ringFrameCoordinates, ringStrokeMeets } from "../lib/depotRings.ts";
import { previewChromePlacement } from "../lib/previewChrome.ts";
import type { GeoFeature } from "../lib/types.ts";

test("pin labels default to asking price and keep a later explicit choice", () => {
  assert.equal(resolvePinLabel(null, { version: null, value: null }), "asking");
  assert.equal(resolvePinLabel(null, { version: null, value: "peracre" }), "asking");
  assert.equal(resolvePinLabel(null, { version: null, value: "none" }), "asking");
  assert.equal(resolvePinLabel("peracre", { version: null, value: null }), "peracre");
  assert.equal(resolvePinLabel(null, { version: PIN_LABEL_VERSION, value: "acres" }), "acres");
  assert.equal(resolvePinLabel(null, { version: PIN_LABEL_VERSION, value: "none" }), "none");
  assert.equal(resolvePinLabel("asking", { version: PIN_LABEL_VERSION, value: "peracre" }), "asking");
});

test("a bare visit opens Pipeline, and an explicit Universe link still wins", () => {
  assert.equal(resolveFunnelMode(null, { version: null, value: null }), "pipeline");
  assert.equal(resolveFunnelMode(null, { version: null, value: "universe" }), "pipeline");
  assert.equal(resolveFunnelMode(null, { version: "1", value: "universe" }), "pipeline");
  assert.equal(resolveFunnelMode("universe", { version: null, value: null }), "universe");
  assert.equal(resolveFunnelMode("pipeline", { version: FUNNEL_VERSION, value: "universe" }), "pipeline");
  assert.equal(resolveFunnelMode(null, { version: FUNNEL_VERSION, value: "universe" }), "universe");
  assert.equal(resolveFunnelMode(null, { version: FUNNEL_VERSION, value: "pipeline" }), "pipeline");
});

test("pipeline all-stages is the default and not a filter", () => {
  assert.equal(parsePipeView(null).all, true);
  assert.equal(parsePipeView("all").all, true);
  assert.equal(parsePipeView("desk").all, false);
  assert.equal(parsePipeView("desk").stage, "desk");
  assert.equal(parsePipeView("financial").stage, "financial");
  assert.equal(pipelineStageFilter(null), null);
  assert.equal(pipelineStageFilter("all"), null);
  assert.equal(pipelineStageFilter("desk"), "desk");
  assert.equal(droppedDealsShown({ all: true, stage: "desk", droppedLayer: false, searchWide: false }), false);
  assert.equal(droppedDealsShown({ all: false, stage: "dropped", droppedLayer: false, searchWide: false }), true);
  assert.equal(droppedDealsShown({ all: false, stage: "desk", droppedLayer: false, searchWide: false }), false);
  assert.equal(droppedDealsShown({ all: true, stage: "desk", droppedLayer: true, searchWide: false }), true);
  assert.equal(stageLandShown(false), false);
  assert.equal(stageLandShown(true), true);
});

test("Miami layers are labeled in plain words and the mid-2027 line is its own role", () => {
  const miami = miamiAreaLabels();
  assert.equal(miami.length, 7);
  assert.deepEqual(miami.map((item) => item.name), [
    "Miami service area (current)",
    "Miami launch area",
    "Miami extended area (later)",
    "Mid-2027 northern boundary",
    "Fort Lauderdale",
    "Highland Lakes",
    "Fontainebleau",
  ]);
  for (const item of AREA_LABELS) assert.equal(/\bODD\b/i.test(item.name), false);
  assert.equal(areaRole("mia-future", "expansion"), "future");
  assert.equal(areaRole("mia-launch", "service"), "launch");
  assert.equal(areaRole("mia-current", "service"), "current");
  assert.equal(areaRole("mia-extended", "expansion"), "later");
  assert.equal(areaRole("mia-pri-ftl", "expansion"), "priority");
  assert.equal(areaRole("las-100", "service"), "current");
  assert.equal(areaRole("las-300", "expansion"), "later");
  assert.equal(areaRole("phx-service", "service"), "current");
  assert.equal(AREA_LABELS.find((item) => item.id === "phx-service")?.name, "Phoenix service area (current)");
  assert.equal(AREA_LABELS.find((item) => item.id === "las-100")?.name, "Core and ring 100 (current)");
  assert.equal(AREA_LABELS.find((item) => item.id === "las-300")?.name, "Rings 200 and 300 (later)");
  assert.equal(areaTip({ id: "mia-future", group: "expansion" }).title, "Mid-2027 northern boundary");
  assert.equal(areaTip({ id: "mia-launch", group: "service" }).marks[0]?.label, "Launch area");
  assert.notEqual(AREA_PAINT.futureLine, "#d6e4f5");
  assert.notEqual(AREA_PAINT.futureLineSatellite, "#d6e4f5");
  assert.match(ringTip({ miles: 5, depot: "Phoenix depot" }).extra || "", /5- and 10-mile rings around each depot/);
});

test("the map line calls dropped deals hidden only while they are not drawn", () => {
  const hidden = { placed: 23, dropped: 19, droppedPlaced: 15, droppedShown: false, droppedOnly: false };
  assert.equal(pipelineMapSummary(hidden), "23 on the map · 19 dropped, hidden");
  assert.equal(pipelineMapSummary({ placed: 1, dropped: 0, droppedPlaced: 0, droppedShown: false, droppedOnly: false }), "1 on the map");
  assert.equal(pipelineMapSummary({ ...hidden, droppedShown: true }), "23 on the map · 15 dropped on the map");
  assert.equal(pipelineMapSummary({ ...hidden, droppedShown: true, droppedOnly: true }), "15 dropped on the map");
  assert.equal(pipelineMapSummary({ placed: 23, dropped: 19, droppedPlaced: 19, droppedShown: true, droppedOnly: false }).includes("hidden"), false);
});

test("a ring note with the site card and Layers open stays in open map space", () => {
  const bounds = { left: 0, top: 138, right: 1280, bottom: 800 };
  const card = { left: 900, top: 138, right: 1280, bottom: 800 };
  const layers = { left: 662, top: 210, right: 890, bottom: 780 };
  const placed = placeReadableTip({
    cursor: { x: 820, y: 460 },
    bounds,
    obstacles: [card, layers],
    widths: [248, 200, 168],
    measure: (width) => ({ width, height: 96 }),
  });
  const note: TipBox = { left: placed.left, right: placed.left + placed.width, top: placed.top, bottom: placed.top + placed.height };
  assert.equal(boxesOverlap(note, card), false);
  assert.equal(boxesOverlap(note, layers), false);
  assert.ok(note.left >= bounds.left && note.top >= bounds.top && note.right <= bounds.right && note.bottom <= bounds.bottom);
  assert.ok(placed.width >= 168);
  assert.match(ringTip({ miles: 10, depot: "Yale Substation" }).title, /10-mile ring/);
  const above = placeReadableTip({
    cursor: { x: 400, y: 500 },
    bounds: { left: 0, top: 0, right: 800, bottom: 800 },
    obstacles: [],
    widths: [200],
    measure: () => ({ width: 200, height: 80 }),
    above: true,
  });
  assert.ok(above.top + above.height <= 500 - 12);
  assert.ok(above.left <= 400 && above.left + above.width >= 400);
  assert.equal(AREA_TIP_DWELL_MS >= 300 && AREA_TIP_DWELL_MS <= 700, true);
});

test("depot rings are closed lines and stay outside a neighborhood view", () => {
  const phx03: GeoFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-112.0704241, 33.4356713] },
    properties: { id: "DEP-PHX-03", address: "1224 S 3rd St" },
  };
  const far: GeoFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-111.904597, 33.6203296] },
    properties: { id: "DEP-PHX-01", address: "8175 E Butherus Dr" },
  };
  const features = depotRingFeatures([phx03, far]);
  assert.equal(features.length, 4);
  for (const feature of features) {
    assert.equal(feature.geometry.type, "LineString");
    const line = feature.geometry.coordinates;
    assert.equal(line.length, 65);
    assert.ok(Math.abs(line[0][0] - line[line.length - 1][0]) < 1e-9);
    assert.ok(Math.abs(line[0][1] - line[line.length - 1][1]) < 1e-9);
  }
  const five = features.find((feature) => feature.properties.miles === 5 && feature.properties.depot === "1224 S 3rd St");
  assert.ok(five);
  const lats = five.geometry.coordinates.map((point) => point[1]);
  const span = (Math.max(...lats) - Math.min(...lats)) * 69;
  assert.ok(span > 9.5 && span < 10.5, `5-mile ring span ${span}`);
  const neighborhood = { west: -112.11, south: 33.41, east: -112.03, north: 33.46 };
  assert.equal(ringStrokeMeets([phx03], neighborhood), false);
  assert.equal(ringStrokeMeets([phx03, far], { west: -112.3, south: 33.2, east: -111.7, north: 33.7 }), true);
  const framed = ringFrameCoordinates([phx03, far], [-112.07, 33.44], neighborhood);
  const framedLats = framed.map((point) => point[1]);
  assert.ok(Math.max(...framedLats) > 33.5 && Math.max(...framedLats) < 33.6);
  assert.ok(Math.min(...framedLats) < 33.4 && Math.min(...framedLats) > 33.28);
});

test("the preview comment button hides while a phone sheet or list covers it", () => {
  const base = {
    viewportWidth: 390,
    viewportHeight: 844,
    drawerLeft: 0,
    drawerTop: 524,
    phone: true,
    abovePeek: false,
  };
  assert.equal(previewChromePlacement({ ...base, covered: true }).display, "none");
  const parked = previewChromePlacement({ ...base, covered: false });
  assert.equal(parked.display, "block");
  assert.equal(parked.right, "12px");
  assert.equal(parked.top, "468px");
  const desktop = previewChromePlacement({
    viewportWidth: 1280,
    viewportHeight: 800,
    drawerLeft: 900,
    drawerTop: 140,
    phone: false,
    abovePeek: false,
    covered: true,
  });
  assert.equal(desktop.display, "block");
  assert.ok(parseFloat(desktop.left) < 900);
});

test("nearby washes use real pins and skip anything without a location", () => {
  const origin: [number, number] = [-112, 33];
  const points = nearbyWashPoints(origin, [
    { id: "self", name: "Open site", lng: -112, lat: 33, businessType: "Car wash" },
    { id: "near", name: "Close wash", lng: -112, lat: 33.01, businessType: "Car wash" },
    { id: "mid", name: "Farther wash", lng: -112, lat: 33.03, businessType: "Car wash" },
    { id: "out", name: "Too far", lng: -112, lat: 33.1, businessType: "Car wash" },
    { id: "other", name: "Not a wash", lng: -112, lat: 33.01, businessType: "Car wash", verdict: "NOT_A_WASH" },
    { id: "land", name: "Bare land", lng: -112, lat: 33.012, businessType: "Car wash", landOnly: true },
    { id: "blank", name: "No pin", lng: null, lat: null, businessType: "Car wash" },
    { id: "store", name: "Fuel", lng: -112, lat: 33.011, businessType: "Convenience store" },
  ], new Set(["self"]));
  assert.deepEqual(points.map((point) => point.id), ["near", "mid"]);
  assert.equal(points[0]?.band, "1");
  assert.equal(points[1]?.band, "3");
  assert.equal(points.some((point) => point.name === "No pin"), false);
});
