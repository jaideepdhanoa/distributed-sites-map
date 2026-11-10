import assert from "node:assert/strict";
import test from "node:test";
import { assertClean, findPolicyHits, POLICY_MESSAGE, PolicyError, safeSnapshot } from "../../lib/policy/banned";

const TEAM_NOTE = [
  "We asked the broker for a current rent roll, month-to-month lease documents, and electrical service details (amps, voltage, phase, utility bills).",
  "We are waiting on an NDA.",
  "The site is on hold.",
  "Under 4 stalls fit.",
  "The offer covers charging at 50 kW.",
  "Water and utility bills are on file.",
].join(" ");

test("team map text is accepted, including diligence and charging language", () => {
  assert.equal(findPolicyHits("Stage should be Dropped. The lot is smaller than the screen requires."), 0);
  assert.equal(findPolicyHits(""), 0);
  assert.equal(findPolicyHits(TEAM_NOTE), 0);
  assert.doesNotThrow(() => assertClean(TEAM_NOTE));
  assert.equal(safeSnapshot(TEAM_NOTE), TEAM_NOTE);
  for (const text of [
    "electrical service details (amps, voltage, phase, utility bills)",
    "utility bills",
    "water and utility bills",
    "utility easement",
    "We are waiting on an NDA.",
    "The site is on hold.",
    "a hold is in place",
    "charging",
    "Under 4 stalls fit",
    "The power drop is 50 kW.",
    "walk-away",
    "target price",
    "our offer",
  ]) {
    assert.equal(findPolicyHits(text), 0, text);
    assert.doesNotThrow(() => assertClean(text));
  }
});

test("a contact number is still rejected without echoing it", () => {
  const number = ["555", "010", "0199"].join("-");
  const text = `Call ${number} about the listing.`;
  assert.ok(findPolicyHits(text) > 0);
  assert.equal(findPolicyHits("Parcel 123-45-678 stays."), 0);
  assert.equal(POLICY_MESSAGE.includes(number), false);
  assert.equal(findPolicyHits(POLICY_MESSAGE), 0);
  assert.throws(
    () => assertClean(text),
    (error: unknown) => error instanceof PolicyError && error.message === POLICY_MESSAGE && !error.message.includes(number),
  );
  assert.equal(safeSnapshot(text), "");
});
