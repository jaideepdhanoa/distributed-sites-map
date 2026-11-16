import assert from "node:assert/strict";
import test from "node:test";
import { plainNextStep } from "../../lib/nextStepLine.ts";

test("the next step is one plain line and drops rule codes", () => {
  const zoning = plainNextStep("Zoning (T-058 measurement, Nov 9, 2026): RS5.2 residential adjacency is inside the line. Certainty step follows.");
  assert.equal(zoning.line.startsWith("Zoning:"), true);
  assert.equal(/\bT-\d+/.test(zoning.line), false);
  assert.equal(/\bT-\d+/.test(zoning.full), false);
  assert.match(zoning.full, /Certainty step follows/);

  const coded = plainNextStep("Confirm the spare land under R-078 before an offer. Ask for the survey.");
  assert.equal(coded.line, "Confirm the spare land under before an offer.");
  assert.equal(/\bR-\d+/.test(coded.full), false);
  assert.match(coded.full, /Ask for the survey/);

  const short = plainNextStep("Awaiting POS/car counts and water bills.");
  assert.equal(short.line, short.full);
  assert.match(short.line, /POS\/car counts/);

  const wall = "A".repeat(180);
  const clipped = plainNextStep(wall);
  assert.ok(clipped.line.endsWith("…"));
  assert.ok(clipped.line.length < wall.length);
  assert.equal(clipped.full, wall);
});
