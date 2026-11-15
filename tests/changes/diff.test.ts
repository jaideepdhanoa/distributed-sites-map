import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { importChanged } from "../../lib/changes/backfill";
import { diffDatabase, readDatabaseSlice, renderReport } from "../../lib/changes/diff";
import type { Actor } from "../../lib/changes/schema";
import { workbookFromFiles, type WorkbookSlice } from "../../lib/changes/workbook";
import { memorySql } from "../helpers/sql";

const human: Actor = { id: "jaideep", kind: "human", role: "reviewer" };

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
  const first = await importChanged(sql, slice, "snap-1");
  assert.equal(first.inserted.stage, slice.stages.length);
  assert.equal(first.inserted.activity, slice.activities.length);
  assert.equal(first.inserted.comms, slice.comms.length);
  assert.equal(first.invalid.comms, 0);
  const second = await importChanged(sql, slice, "snap-1");
  assert.equal(second.inserted.stage, 0);
  assert.equal(second.inserted.activity, 0);
  assert.equal(second.inserted.comms, 0);
  assert.equal(second.unchanged.stage, first.inserted.stage);

  const report = await diffDatabase(sql, slice, "files");
  assert.equal(report.clean, true);
  assert.deepEqual(report.clean_by_entity, { stage: true, activity: true, comms: true, site: true });
  assert.equal(report.entities.stage.changed.length, 0);
  assert.equal(report.entities.stage.missing.length, 0);
  assert.deepEqual(report.legacy_stages, ["LAND-PHX-0003"]);
  assert.equal(report.invalid.comms.some((issue) => issue.value === "L-441"), false);
  assert.match(renderReport(report), /one clean on-demand diff/);
  assert.match(renderReport(report), /clean_by_entity: stage yes, activity yes, comms yes, site yes/);
  const legacy = slice.stages.find((row) => row.stage === "Financial screen");
  assert.ok(legacy);
  const stored = await readDatabaseSlice(sql);
  assert.equal(stored.stages.find((row) => row.site_id === legacy?.site_id)?.stage, "Financial screen");
  const internal = slice.comms.find((row) => row.direction === "internal" && row.site_id.startsWith("PIPE-"));
  assert.ok(internal);
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
  assert.equal(drifted.clean_by_entity.stage, false);
  assert.equal(drifted.clean_by_entity.comms, true);
  assert.ok(drifted.entities.stage.changed.some((row) => row.id === "PIPE-PHX-0001" && row.field === "stage"));
  assert.match(renderReport(drifted), /Clean: no/);
  assert.match(renderReport(drifted), /clean_by_entity: stage no/);
});
