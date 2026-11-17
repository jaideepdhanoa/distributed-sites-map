import assert from "node:assert/strict";
import test from "node:test";
import { siteSpaceChange } from "../../lib/spaces/change.ts";
import { applyDrawCommand, draftFromDrag, emptyDraft } from "../../lib/spaces/draw.ts";
import type { GroundBox } from "../../lib/spaces/measure.ts";

const start = { lng: -112.07, lat: 33.407 };
const end = { lng: -112.0692, lat: 33.4076 };

function box(): GroundBox {
  return {
    center: { lng: -112.07, lat: 33.407 },
    lengthFt: 90,
    widthFt: 60,
    rotationDeg: 0,
  };
}

test("cancel and Escape discard the in-progress shape and do not save it", () => {
  const draft = draftFromDrag(start, end);
  assert.ok(draft.box);
  for (const command of ["cancel", "escape"] as const) {
    const next = applyDrawCommand(draft, command);
    assert.equal(next.commit, null);
    assert.equal(next.close, true);
    assert.deepEqual(next.draft, emptyDraft());
  }
});

test("undo removes one corner and Finish saves only a finished shape", () => {
  const draft = draftFromDrag(start, end);
  const undone = applyDrawCommand(draft, "undo");
  assert.equal(undone.close, false);
  assert.equal(undone.commit, null);
  assert.equal(undone.draft.box, null);
  assert.equal(undone.draft.points.length, 1);
  const cleared = applyDrawCommand(undone.draft, "undo");
  assert.equal(cleared.draft.points.length, 0);
  const finished = applyDrawCommand(draft, "finish");
  assert.equal(finished.close, true);
  assert.ok(finished.commit && finished.commit.lengthFt >= 4);
  const empty = applyDrawCommand(emptyDraft(), "finish");
  assert.equal(empty.commit, null);
  assert.equal(empty.close, true);
});

test("delete removes a finished lot through the site space write", () => {
  const space = {
    siteId: "PHX-U189",
    id: "SS-1001",
    version: 2,
    box: box(),
    type: "excess_parking" as const,
    layout: "stalls_90" as const,
  };
  const removed = siteSpaceChange(space, true);
  assert.equal(removed.entity_type, "site_space");
  assert.equal(removed.entity_id, "SS-1001");
  assert.equal(removed.expected_version, 2);
  assert.deepEqual(removed.payload, { deleted: true });
  const created = siteSpaceChange({ ...space, id: "", version: 0 }, false);
  assert.equal("entity_id" in created, false);
  assert.equal("deleted" in created.payload, false);
  if ("length_ft" in created.payload) assert.equal(created.payload.length_ft, 90);
});
