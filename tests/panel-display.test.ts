import assert from "node:assert/strict";
import test from "node:test";
import { suggestedDropProposal } from "../lib/actions/nextStep.ts";
import { formatNoteBlocks } from "../lib/noteDisplay.ts";
import { missingScoreSentence, storedScoreView } from "../lib/scoreDisplay.ts";
import { suggestedDropPhrase } from "../lib/suggestedDropLine.ts";

const HEX = "abcdef0123456789";

test("a note splits enumerations into a list and keeps the source string", () => {
  const source = "(1) Confirm the lot can hold the layout. (2) Ask for the survey before Friday.";
  const blocks = formatNoteBlocks(source);
  assert.equal(source, "(1) Confirm the lot can hold the layout. (2) Ask for the survey before Friday.");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "ol");
  if (blocks[0]?.kind !== "ol") return;
  assert.deepEqual(blocks[0].items, [
    "Confirm the lot can hold the layout.",
    "Ask for the survey before Friday.",
  ]);

  const numbered = formatNoteBlocks("1. Confirm the lot can hold the layout. 2. Ask for the survey before Friday.");
  assert.equal(numbered[0]?.kind, "ol");
  if (numbered[0]?.kind !== "ol") return;
  assert.equal(numbered[0].items.length, 2);
  assert.equal(numbered[0].items[0]?.startsWith("Confirm"), true);
});

test("prose after the last enumerated item becomes paragraphs and keeps em dashes", () => {
  const text = "(1) Confirm the lot can hold the layout we need. (2) Ask for the survey before Friday. The north parcel — the one beside the wash — is too small for the bays we planned. Power along the frontage is not confirmed yet; a second check would still be required before anyone walks the lot.";
  const blocks = formatNoteBlocks(text);
  assert.equal(blocks[0]?.kind, "ol");
  if (blocks[0]?.kind !== "ol") return;
  assert.deepEqual(blocks[0].items, [
    "Confirm the lot can hold the layout we need.",
    "Ask for the survey before Friday.",
  ]);
  const prose = blocks.slice(1);
  assert.ok(prose.length >= 2);
  assert.equal(prose.every((block) => block.kind === "p"), true);
  const joined = prose.map((block) => (block.kind === "p" ? block.text : "")).join(" ");
  assert.equal(joined.includes("—"), true);
  assert.equal(joined.includes(" - "), false);
  assert.match(joined, /second check/);
});

test("a note splits obvious sentences and semicolons and keeps em dashes", () => {
  const text = "The north parcel — the one beside the wash — is too small for the layout we planned. Power along the frontage is not confirmed yet.";
  const blocks = formatNoteBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, "p");
  assert.equal(blocks[1]?.kind, "p");
  if (blocks[0]?.kind !== "p" || blocks[1]?.kind !== "p") return;
  assert.equal(blocks[0].text.includes("—"), true);
  assert.equal(blocks[0].text.includes(" - "), false);
  assert.match(blocks[1].text, /^Power along/);

  const clauses = "The lot cannot hold the layout we need on this corner; the power service along the frontage is still unconfirmed.";
  const split = formatNoteBlocks(clauses);
  assert.equal(split.length, 2);
  if (split[0]?.kind !== "p" || split[1]?.kind !== "p") return;
  assert.match(split[0].text, /corner$/);
  assert.match(split[1].text, /^the power service/i);
});

test("a short note stays one paragraph and a gmail id never renders", () => {
  const short = formatNoteBlocks("Ask for the survey.");
  assert.deepEqual(short, [{ kind: "p", text: "Ask for the survey." }]);

  const hidden = formatNoteBlocks(`Ask for the survey (Gmail ${HEX}) before Friday. Then confirm access to the north parcel for the crew that walks the lot.`);
  const flat = JSON.stringify(hidden);
  assert.equal(flat.toLowerCase().includes(HEX), false);
  assert.equal(/\b[0-9a-f]{16}\b/i.test(flat), false);
});

test("a decimal and an abbreviation are not a false break", () => {
  const acres = formatNoteBlocks("The measured lot is 2.5 acres and the frontage is continuous.");
  assert.equal(acres.length, 1);
  assert.equal(acres[0]?.kind, "p");

  const named = formatNoteBlocks("Dr. Adler confirmed the visit. The crew can walk the lot on Friday if the gate is open and the survey is in the folder.");
  assert.equal(named.length, 2);
  if (named[0]?.kind !== "p") return;
  assert.match(named[0].text, /^Dr\. Adler confirmed the visit\.$/);
});

test("the score line uses stored subscores and does not invent the rest", () => {
  const located = storedScoreView({ score: 72, locationPoints: 7.5 });
  assert.equal(located.total, "72");
  assert.equal(located.line, "Location 7.5/10");
  assert.deepEqual(located.parts.map((part) => part.id), ["location"]);
  assert.deepEqual(located.missing, ["Economics", "Land", "Power", "Deal"]);
  assert.equal(missingScoreSentence(located.missing), "Economics, Land, Power, and Deal are not stored per site.");
  assert.equal(located.line.includes("40"), false);

  const totalOnly = storedScoreView({ score: "72", locationPoints: null, economics: null, land: "", power: "#REF!", deal: undefined });
  assert.equal(totalOnly.total, "72");
  assert.equal(totalOnly.parts.length, 0);
  assert.equal(totalOnly.line, "");
  assert.equal(missingScoreSentence(totalOnly.missing), "Economics, Land, Power, Location, and Deal are not stored per site.");

  const zero = storedScoreView({ score: 10, locationPoints: 0 });
  assert.equal(zero.line, "Location 0/10");
});

test("accepting a suggested drop opens the human drop flow and does not set a status", () => {
  const body = suggestedDropProposal("Lot too small");
  assert.equal(body.detail, "knock_off");
  assert.equal(body.field, "proposed_next_step");
  assert.equal(body.proposedValue, "Dropped");
  assert.equal("status" in body, false);
  assert.equal(suggestedDropPhrase("Lot too small"), "Suggested drop: lot too small");
  assert.equal(suggestedDropPhrase("LOT TOO SMALL"), "Suggested drop: lot too small");
  assert.equal(suggestedDropPhrase("The lot is too small."), "Suggested drop: The lot is too small.");
  assert.equal(suggestedDropPhrase(`Lot too small (Gmail ${HEX})`).toLowerCase().includes(HEX), false);
});
