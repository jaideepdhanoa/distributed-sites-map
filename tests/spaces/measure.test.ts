import assert from "node:assert/strict";
import test from "node:test";
import {
  axisAlignedBox,
  geodesicDirect,
  geodesicFeet,
  geodesicInverse,
  measureRectangle,
  rotateBox,
} from "../../lib/spaces/measure";

const CITIES = {
  phoenix: { lng: -112.074, lat: 33.4484 },
  lasVegas: { lng: -115.1391, lat: 36.1699 },
  miami: { lng: -80.1918, lat: 25.7617 },
};

test("one degree of longitude on the equator is the WGS84 parallel", () => {
  const meters = (2 * Math.PI * 6378137) / 360;
  const end = geodesicDirect({ lng: 0, lat: 0 }, 90, meters);
  assert.ok(Math.abs(end.lat) < 1e-8, `lat ${end.lat}`);
  assert.ok(Math.abs(end.lng - 1) < 1e-6, `lng ${end.lng}`);
  const back = geodesicInverse({ lng: 0, lat: 0 }, end);
  assert.ok(Math.abs(back.meters - meters) < 0.01);
  assert.ok(Math.abs(back.bearingDeg - 90) < 1e-6);
});

test("a 100 ft by 50 ft rectangle measures true ground distance in Phoenix, Las Vegas, and Miami", () => {
  for (const [name, center] of Object.entries(CITIES)) {
    for (const rotationDeg of [0, 20, 75, -35]) {
      const box = { center, lengthFt: 100, widthFt: 50, rotationDeg };
      const measured = measureRectangle(box);
      assert.ok(Math.abs(measured.lengthFt - 100) < 0.05, `${name} length ${measured.lengthFt} at ${rotationDeg}`);
      assert.ok(Math.abs(measured.widthFt - 50) < 0.05, `${name} width ${measured.widthFt} at ${rotationDeg}`);
      assert.ok(Math.abs(measured.areaSqFt - 5000) < 2, `${name} area ${measured.areaSqFt} at ${rotationDeg}`);
    }
    const east = geodesicDirect(center, 90, 100 * 0.3048);
    assert.ok(Math.abs(geodesicFeet(center, east) - 100) < 0.02, name);
  }
});

test("dragging opposite corners builds an east-west by north-south box", () => {
  const center = CITIES.phoenix;
  const west = geodesicDirect(center, 270, 40 * 0.3048);
  const east = geodesicDirect(center, 90, 60 * 0.3048);
  const south = geodesicDirect(west, 180, 15 * 0.3048);
  const north = geodesicDirect(east, 0, 25 * 0.3048);
  const box = axisAlignedBox(south, north);
  assert.ok(Math.abs(box.lengthFt - 100) < 0.1, String(box.lengthFt));
  assert.ok(Math.abs(box.widthFt - 40) < 0.1, String(box.widthFt));
  assert.equal(box.rotationDeg, 0);
});

test("the rotate handle aims the width axis at the pointer", () => {
  const center = CITIES.lasVegas;
  const pointer = geodesicDirect(center, 30, 80 * 0.3048);
  const turned = rotateBox({ center, lengthFt: 90, widthFt: 40, rotationDeg: 0 }, pointer);
  assert.ok(Math.abs(turned.rotationDeg - 30) < 0.05, String(turned.rotationDeg));
  const measured = measureRectangle(turned);
  assert.ok(Math.abs(measured.lengthFt - 90) < 0.05);
  assert.ok(Math.abs(measured.widthFt - 40) < 0.05);
});
