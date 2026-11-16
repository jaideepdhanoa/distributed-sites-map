import assert from "node:assert/strict";
import { DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, clampDrawerWidth, drawerMax } from "../lib/drawerWidth.ts";

assert.equal(DRAWER_DEFAULT, 480);
assert.equal(clampDrawerWidth(200, 1440), DRAWER_MIN);
assert.equal(clampDrawerWidth(480, 1440), 480);
assert.equal(drawerMax(1440), 864);
assert.equal(clampDrawerWidth(5000, 1440), 864);
assert.equal(clampDrawerWidth(900, 2000), DRAWER_MAX);
assert.equal(clampDrawerWidth(800, 1000), 600);
console.log("drawer width ok");
