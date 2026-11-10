import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertClean, findPolicyHits, POLICY_MESSAGE, PolicyError, safeSnapshot } from "../../lib/policy/banned";

function decodedWords(): string[] {
  const file = JSON.parse(readFileSync("config/display-policy.json", "utf8")) as { words: string[]; phrases: string[] };
  return [...file.words, ...file.phrases].map((item) => Buffer.from(item, "base64").toString("utf8").replace(/^term:/, ""));
}

test("clean map text is accepted", () => {
  assert.equal(findPolicyHits("Stage should be Dropped. The lot is smaller than the screen requires."), 0);
  assert.equal(findPolicyHits(""), 0);
});

test("blocked wording is rejected without echoing it", () => {
  const word = decodedWords().find((item) => item.length >= 6);
  assert.ok(word);
  assert.ok(findPolicyHits(`Please check ${word} before Friday.` ) > 0);
  assert.equal(POLICY_MESSAGE.includes(word), false);
  assert.equal(findPolicyHits(POLICY_MESSAGE), 0);
  assert.equal(safeSnapshot(`note about ${word}`), "");
});

test("a contact number is rejected", () => {
  const number = ["555", "010", "0199"].join("-");
  assert.ok(findPolicyHits(`Call ${number} about the listing.`) > 0);
  assert.equal(findPolicyHits("Parcel 123-45-678 stays."), 0);
});

test("diligence and process status can be posted as one draft", () => {
  const drafts = [
    "We asked the broker for a current rent roll, month-to-month lease documents, and electrical service details (amps, voltage, phase, utility bills).",
    "electrical service details (amps, voltage, phase, utility bills)",
    "electrical services",
    "utility bills",
    "utility bill",
    "utility easement",
    "utility easements",
    "water and utility bills",
    "Water and utility bills",
    "1982 utility easement (Book 1617, Inst. Unplottable",
    "We are waiting on an NDA.",
    "The site is on hold.",
    "a hold is in place",
    "Spare square footage is the tight part.",
    "The building is fully built out.",
    "We asked the broker for a current rent roll, month-to-month lease documents, and electrical service details (amps, voltage, phase, utility bills). We are waiting on an NDA. The site is on hold.",
  ];
  for (const draft of drafts) {
    assert.equal(findPolicyHits(draft), 0, draft);
    assert.doesNotThrow(() => assertClean(draft));
    assert.equal(safeSnapshot(draft), draft);
  }
});

test("charging, AV, and price language stays blocked without echoing the term", () => {
  assert.equal(/stall|charg|utilit|electric|offer|walk|power/i.test(POLICY_MESSAGE), false);
  const blocked = [
    "charging",
    "Please check the charge before Friday.",
    "Order a charger.",
    "The lot is for EV use.",
    "This is an AV site.",
    "One stall is open.",
    "Under 4 stalls fit",
    "The power drop is the issue.",
    "Service is 50 kW.",
    "The feed is 2 MW.",
    "Use is 400 kWh.",
    "walk-away",
    "walk away",
    "walkaway",
    "target price",
    "our offer",
    "offer price",
    "The offers are in.",
    "electric vehicle",
    "electric service",
    "electrical",
    "utility",
    "utility proximity",
    "serving utility",
    "utility hosting map",
    "utility billing",
    "Waiting on an LOI.",
    "Proposed by cindel",
    "Assignee jaideep",
    "We asked for electrical service details (amps, voltage, phase, utility bills) and 4 stalls.",
    "The site is on hold for charging.",
    "utility bills at 50 kW",
    "utility easement for EV stalls",
    "electrical service for the charger",
    "Spare square footage, but under 4 stalls fit.",
  ];
  for (const text of blocked) {
    assert.ok(findPolicyHits(text) > 0, text);
    assert.throws(
      () => assertClean(text),
      (error: unknown) => {
        assert.ok(error instanceof PolicyError, text);
        assert.equal(error.message, POLICY_MESSAGE);
        assert.equal(error.message.includes(text), false);
        return true;
      },
    );
    assert.equal(safeSnapshot(text), "");
  }
});
