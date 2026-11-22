import assert from "node:assert/strict";
import test from "node:test";
import { readGenerated, resetParsedSnapshotCache } from "../lib/snapshot/read";
import { fullUniverseNeeded, viewHelp } from "../lib/viewHelp";
import { snapshotCacheHeaders } from "../lib/guard";

test("view lines stay one plain sentence", () => {
  assert.equal(viewHelp("review"), "Everything waiting on you");
  assert.equal(viewHelp("pipeline"), "Deals in this market");
  assert.equal(viewHelp("universe"), "Sites in this market");
  assert.equal(viewHelp("nda"), "Agreements still open");
});

test("the full Universe loads for All markets and for a search", () => {
  assert.equal(fullUniverseNeeded(true, ""), true);
  assert.equal(fullUniverseNeeded(false, "ph"), true);
  assert.equal(fullUniverseNeeded(false, "  ph "), true);
  assert.equal(fullUniverseNeeded(false, ""), false);
  assert.equal(fullUniverseNeeded(false, "a"), false);
});

test("a published snapshot is cached per version", () => {
  const headers = snapshotCacheHeaders("snap-1");
  assert.equal(headers.ETag, `"snap-1"`);
  assert.match(headers["Cache-Control"], /max-age=300/);
  assert.equal(headers["Cache-Control"].includes("no-store"), false);
});

test("the second read of a snapshot file does not parse again", () => {
  resetParsedSnapshotCache();
  const first = readGenerated("funnel.json");
  const second = readGenerated("funnel.json");
  assert.equal(first, second);
});
