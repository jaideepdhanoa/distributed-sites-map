import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { presentTimeline } from "../../lib/timeline/filter.ts";

function hiddenWord(): string {
  const file = JSON.parse(readFileSync("config/timeline-terms.json", "utf8")) as { words: string[] };
  for (const item of file.words) {
    const text = Buffer.from(item, "base64").toString("utf8").replace(/^term:/, "");
    if (text.length >= 6) return text;
  }
  throw new Error("term list is empty");
}

test("the card timeline keeps neutral rows for the open record", () => {
  const hidden = hiddenWord();
  const items = presentTimeline(
    {
      items: [
        { record_id: "PHX-U180", date: "2026-11-01", type: "brochure", summary: "Brochure on file", link: "https://example.com/doc" },
        { record_id: "PHX-U180", date: "2026-11-02", type: "doc", summary: `See ${hidden}`, link: "https://example.com/secret" },
        { record_id: "OTHER", date: "2026-11-03", type: "call", summary: "Call logged", link: "" },
        { record_id: "PHX-U180", date: "2026-11-04", type: "email", summary: "Email thread logged", link: "javascript:alert(1)" },
      ],
    },
    ["PHX-U180"],
  );
  assert.equal(items.length, 2);
  assert.equal(items[0]?.type, "email");
  assert.equal(items[0]?.link, "");
  assert.equal(items.some((item) => item.summary.includes(hidden)), false);
  assert.equal(items.some((item) => JSON.stringify(item).includes("subject")), false);
});
