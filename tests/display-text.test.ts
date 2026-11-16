import assert from "node:assert/strict";
import test from "node:test";
import { previewAtWord, redactGmailPayload, stripGmailIds, withoutGmail } from "../lib/displayText.ts";
import { plainNextStep } from "../lib/nextStepLine.ts";

const HEX = "abcdef0123456789";

test("gmail ids are stripped from displayed next-step text and the rest stays", () => {
  const paren = stripGmailIds(`Ask for the survey (Gmail ${HEX}) before Friday.`);
  assert.equal(paren, "Ask for the survey before Friday.");
  assert.equal(paren.toLowerCase().includes(HEX), false);

  const bare = stripGmailIds(`Reply on Gmail ${HEX} and confirm the visit.`);
  assert.equal(bare, "Reply on Gmail and confirm the visit.");
  assert.equal(/\b[0-9a-f]{16}\b/i.test(bare), false);

  const kept = stripGmailIds("Gmail is the channel. The code abcd is short.");
  assert.equal(kept, "Gmail is the channel. The code abcd is short.");

  const message = stripGmailIds(`Inquiry sent. Gmail message ${HEX}.`);
  assert.equal(/\b[0-9a-f]{16}\b/i.test(message), false);
  assert.match(message, /Inquiry sent/);

  const bareId = stripGmailIds(`The inquiry line cites ${HEX} only.`);
  assert.equal(/\b[0-9a-f]{16}\b/i.test(bareId), false);

  const link = `https://mail.google.com/mail/u/0/#inbox/${HEX}`;
  assert.equal(stripGmailIds(link), link);
  const hidden = withoutGmail(`Rent roll ${link} ${HEX}`);
  assert.equal(hidden, "Rent roll");
  assert.equal(hidden.includes("mail.google.com"), false);
  assert.equal(/\b[0-9a-f]{16}\b/i.test(hidden), false);

  const payload = redactGmailPayload({
    summary: `Inquiry sent. Gmail message ${HEX}.`,
    messageId: HEX,
    href: link,
    name: "A site",
  });
  assert.equal(/\b[0-9a-f]{16}\b/i.test(payload.summary), false);
  assert.equal(payload.messageId, "");
  assert.equal(payload.href, link);
  assert.equal(payload.name, "A site");

  const step = plainNextStep(`Zoning (T-058, Nov 9): confirm access (Gmail ${HEX}).`);
  assert.equal(/\bT-\d+/.test(step.full), false);
  assert.equal(step.full.toLowerCase().includes(HEX), false);
  assert.match(step.line, /confirm access/);
});

test("a preview cuts on a word and can keep the full sentence", () => {
  const short = previewAtWord("Ask for the survey.");
  assert.equal(short.clipped, false);
  assert.equal(short.preview, short.full);

  const long = previewAtWord("Suggested drop for the north parcel because the lot is too small for the layout we need", 36);
  assert.equal(long.clipped, true);
  assert.equal(long.preview.endsWith("…"), true);
  const body = long.preview.slice(0, -1);
  assert.equal(long.full.startsWith(body), true);
  assert.equal(long.full[body.length], " ");
  assert.equal(long.full.includes("layout"), true);
});
