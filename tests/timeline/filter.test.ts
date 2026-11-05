import assert from "node:assert/strict";
import test from "node:test";
import { presentCard, showActivityLines } from "../../lib/timeline/filter.ts";

test("the card merges counts and drops blocked lines", () => {
  const card = presentCard(
    {
      records: {
        "PIPE-PHX-0001": {
          folder_url: "https://drive.google.com/drive/folders/fld1",
          materials: [
            { category: "financials", label: "Financials", count: 3, latest: "2026-10-23" },
            { category: "property_legal", label: "Property and legal", count: 1, latest: "2026-10-22" },
          ],
          last_touched: "2026-10-23",
        },
        "LAND-PHX-0036": {
          folder_url: "https://drive.google.com/drive/folders/fld2",
          materials: [{ category: "financials", label: "Financials", count: 2, latest: "2026-11-01" }],
          last_touched: "2026-11-01",
        },
      },
      items: [
        { record_id: "PIPE-PHX-0001", event_id: "A-1", date: "2026-10-22", type: "om", summary: "Sales package on file" },
        { record_id: "PIPE-PHX-0001", event_id: "A-2", date: "2026-10-22", type: "call", summary: "A neutral line" },
        { record_id: "PIPE-PHX-0001", event_id: "A-3", date: "2026-10-22", type: "doc", summary: "Quoted " + String.fromCharCode(36) + "1" },
        { record_id: "OTHER", event_id: "A-4", date: "2026-10-22", type: "visit", summary: "Site visit logged" },
      ],
    },
    ["PIPE-PHX-0001", "LAND-PHX-0036"],
  );
  assert.equal(card.folderUrl, "https://drive.google.com/drive/folders/fld1");
  assert.equal(card.materials[0]?.count, 5);
  assert.equal(card.materials[0]?.latest, "2026-11-01");
  assert.equal(card.materials[1]?.category, "property_legal");
  assert.equal(card.items.length, 1);
  assert.equal(card.items[0]?.type, "om");
  assert.equal("link" in (card.items[0] || {}), false);
  assert.equal(JSON.stringify(card).includes("/file/d/"), false);
});

test("activity lines stay on unless the config turns them off", () => {
  assert.equal(showActivityLines(), true);
});

test("a stage line keeps the fixed sentence and drops a parenthetical", () => {
  const card = presentCard(
    {
      items: [
        {
          record_id: "PIPE-PHX-0005",
          event_id: "S-1",
          date: "2026-10-04",
          type: "stage",
          summary: "Stage set to Dropped (date approximate)",
        },
      ],
    },
    ["PIPE-PHX-0005"],
  );
  assert.equal(card.items.length, 1);
  assert.equal(card.items[0]?.summary, "Stage set to Dropped");
});
