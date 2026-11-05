import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findPolicyHits, POLICY_MESSAGE, safeSnapshot } from "../../lib/policy/banned";

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
