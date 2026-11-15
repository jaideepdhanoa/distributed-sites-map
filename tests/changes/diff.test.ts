import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { importShadow } from "../../lib/changes/backfill";
import { diffDatabase, readDatabaseSlice, renderReport } from "../../lib/changes/diff";
import type { Actor } from "../../lib/changes/schema";
import { workbookFromFiles, type WorkbookSlice } from "../../lib/changes/workbook";
import { memorySql } from "../helpers/sql";

const human: Actor = { id: "jaideep", kind: "human" };

function files(): WorkbookSlice {
  return workbookFromFiles({
    deals: readFileSync("data/generated/deals.geojson", "utf8"),
    timeline: readFileSync("data/generated/timeline.json", "utf8"),
    comms: readFileSync("data/generated/comms.json", "utf8"),
  });
}

test("the workbook parser keeps stage, activity, and comms rows", () => {
  const slice = files();
  assert.equal(slice.stages.find((row) => row.site_id === "PIPE-PHX-0001")?.stage, "1 Desk screen");
  assert.equal(slice.stages.find((row) => row.site_id === "PIPE-PHX-0001")?.market, "PHX");
  assert.ok(slice.activities.some((row) => row.entity_id === "A-000002"));
  assert.equal(slice.comms.find((row) => row.entity_id === "CM-0001")?.direction, "in");
  assert.ok(slice.comms.some((row) => row.direction === "internal"));
  assert.ok(slice.comms.some((row) => row.site_id === "L-441"));
});

test("a backfill is idempotent and the diff is clean until a write drifts", { timeout: 120_000 }, async () => {
  const slice = files();
  const sql = await memorySql();
  await migrate(sql);
  const first = await importShadow(sql, slice, "files");
  assert.equal(first.inserted.stage, slice.stages.length);
  assert.equal(first.inserted.activity, slice.activities.length);
  assert.equal(first.inserted.comms, slice.comms.length);
  const second = await importShadow(sql, slice, "files");
  assert.equal(second.inserted.stage, 0);
  assert.equal(second.inserted.activity, 0);
  assert.equal(second.inserted.comms, 0);
  assert.equal(second.skipped.stage, slice.stages.length);

  const clean = await diffDatabase(sql, slice, "files");
  assert.equal(clean.clean, true);
  assert.match(renderReport(clean), /Clean: yes/);
  assert.match(renderReport(clean), /three consecutive daily reports/);
  const internal = slice.comms.find((row) => row.direction === "internal");
  assert.ok(internal);
  const stored = await readDatabaseSlice(sql);
  assert.equal(stored.comms.find((row) => row.entity_id === internal?.entity_id)?.direction, "internal");

  const maxActivity = Math.max(...slice.activities.map((row) => Number(row.entity_id.slice(2)) || 0));
  const minted = await applyBatch(sql, human, "after-backfill", {
    changes: [
      {
        entity_type: "activity",
        site_id: "PIPE-PHX-0001",
        expected_version: 0,
        source: "listing note",
        payload: { date: "2026-11-15", type: "listing", summary: "Listing noted" },
      },
    ],
  });
  assert.ok(Number((minted.results[0]?.entity_id || "").slice(2)) > maxActivity);

  await applyBatch(sql, human, "drift-stage", {
    changes: [
      {
        entity_type: "stage",
        site_id: "PIPE-PHX-0001",
        expected_version: 1,
        source: "desk review",
        payload: { stage: "2 Financial screen", market: "PHX" },
      },
    ],
  });
  const drifted = await diffDatabase(sql, slice, "files");
  assert.equal(drifted.clean, false);
  assert.ok(drifted.entities.stage.changed.some((row) => row.id === "PIPE-PHX-0001" && row.field === "stage"));
  assert.match(renderReport(drifted), /Clean: no/);
});
