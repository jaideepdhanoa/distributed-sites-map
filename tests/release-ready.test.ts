import assert from "node:assert/strict";
import test from "node:test";
import { readGenerated, resetParsedSnapshotCache } from "../lib/snapshot/read";
import { fullUniverseNeeded, viewHelp } from "../lib/viewHelp";
import { resolveSiteLink, siteHref } from "../lib/siteLink";
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

test("a Universe id opens that row, and a promoted id opens the Pipeline deal", () => {
  assert.deepEqual(resolveSiteLink("WB-LAS-0062", []), { kind: "universe", id: "WB-LAS-0062", market: "LAS" });
  assert.deepEqual(
    resolveSiteLink("WB-PHX-9101", [{ deal_id: "PIPE-PHX-9101", universe_id: "WB-PHX-9101", kind: "pipeline" }]),
    { kind: "pipeline", id: "PIPE-PHX-9101" },
  );
  assert.deepEqual(resolveSiteLink("PIPE-MIA-0008", []), { kind: "pipeline", id: "PIPE-MIA-0008" });
  assert.deepEqual(resolveSiteLink("LAND-PHX-0002", []), { kind: "pipeline", id: "LAND-PHX-0002" });
  assert.equal(resolveSiteLink("PIPE-PHX-0006", []).kind, "missing");
  assert.deepEqual(resolveSiteLink("WB-ZZZ-0001", []), { kind: "universe", id: "WB-ZZZ-0001", market: null });
  assert.equal(resolveSiteLink("nope", []).kind, "missing");
  assert.equal(siteHref("https://distributedsites.com", "WB-LAS-0062"), "https://distributedsites.com/?site=WB-LAS-0062");
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
