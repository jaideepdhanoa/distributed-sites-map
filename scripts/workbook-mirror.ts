import { appendFileSync } from "node:fs";
import { withConnectionString } from "../lib/actions/db";
import { assertProductionDiff } from "../lib/changes/guard";
import { raiseIdFloor } from "../lib/changes/apply";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";
import { MIRROR_FIELD_HEADERS } from "../lib/changes/site";
import {
  ACTIVITY_HEADER_ROW,
  ACTIVITY_SHEET,
  COMMS_HEADER_ROW,
  COMMS_SHEET,
  MIRROR_SHEETS_SCOPE,
  SPREADSHEET_ID,
  a1,
  assertMirrorRefusals,
  assertPlannedWrites,
  assertReadBack,
  assertWorkbookMirrorAllowed,
  entitiesToMirror,
  entityChangeCounts,
  formatHeld,
  formatMirrorDrift,
  formatPlan,
  formatPlanSummary,
  formatTabCounts,
  labeledFloorsFromTable,
  loadMirrorRows,
  mirrorDrift,
  mirrorDryRun,
  mirrorGridNeedsGrowth,
  mirrorGridRequests,
  sheetsFailureMessage,
  planActivityMirror,
  planCommsMirror,
  planCreatedSiteMirror,
  planMirrorTabs,
  planSiteMirror,
  planUniverseMirror,
  newMirrorRunId,
  planStageMirror,
  redactMirrorError,
  UNIVERSE_HEADER_ROW,
  UNIVERSE_SHEET,
  saveMirrorRun,
  sheetIdFloor,
  watchMirrorCancel,
  writeMirrorTabs,
  type FailedMirrorTab,
  type MirrorPlan,
  type MirrorWritePhase,
  stageTabs,
  type CellChange,
  type SheetRender,
  type SheetTable,
} from "../lib/changes/mirror";
import { loadSheetTable, readBackCells, readBackOutcome, readSheetRanges, sheetsFetch } from "../lib/changes/sheetTable";
import { writeFormulaBatch, readGrids } from "./power-sheet-read";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function publicError(error: unknown): string {
  return redactMirrorError(error);
}

function logTabFailure(failure: FailedMirrorTab): void {
  console.error(JSON.stringify({ event: "mirror_tab_failed", tab: failure.tab, message: failure.message }));
}

function failedTabsError(failed: FailedMirrorTab[], suffix = ""): Error {
  const detail = failed.map((failure) => `${failure.tab}: ${failure.message}`).join("\n");
  return new Error(`Workbook mirror failed on ${failed.map((failure) => failure.tab).join(", ")}.${suffix}\n${detail}`);
}

const GROWN_SHEETS = new Set([UNIVERSE_SHEET, "Pipeline", "Land Sites"]);

/** Grow a sheet grid, then write those cells. Returns false when the cells already fit. */
async function writeGrownGrid(token: string, title: string, changes: CellChange[]): Promise<boolean> {
  const grids = await readGrids(token);
  const grid = grids.find((item) => item.title === title);
  if (!grid) throw new Error(`${title} sheet is missing from the workbook.`);
  if (!mirrorGridNeedsGrowth(changes, grid)) return false;
  await writeFormulaBatch(token, mirrorGridRequests(changes, grid).requests);
  return true;
}

function blankPlan(): MirrorPlan {
  return { changes: [], skippedProtected: 0, unmatched: [], appended: 0, refused: [], held: [] };
}

function sheetsToken(raw: string): Promise<string> {
  return sheetsAccessToken(raw, MIRROR_SHEETS_SCOPE);
}

async function loadTable(token: string, title: string, headerRow: number, fieldHeaders: string[][], siteCells = false): Promise<SheetTable> {
  const read = (ranges: string[], kind: SheetRender) => readSheetRanges(token, SPREADSHEET_ID, ranges, kind);
  return loadSheetTable(read, title, headerRow, fieldHeaders, siteCells);
}

async function writeCells(token: string, changes: CellChange[]): Promise<void> {
  const groups = new Map<"RAW" | "USER_ENTERED", CellChange[]>();
  for (const change of changes) {
    const input = change.valueInput || "RAW";
    const list = groups.get(input) || [];
    list.push(change);
    groups.set(input, list);
  }
  for (const [valueInputOption, group] of groups) {
    for (let start = 0; start < group.length; start += 400) {
      const chunk = group.slice(start, start + 400);
      const response = await sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          valueInputOption,
          data: chunk.map((change) => ({
            range: a1(change.sheet, change.row, change.column),
            values: [[change.after]],
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(sheetsFailureMessage(response.status, await response.text()));
      }
    }
  }
}

function readBack(token: string, changes: CellChange[]): Promise<{ sheet: string; row: number; column: number; value: string }[]> {
  return readBackCells(token, SPREADSHEET_ID, changes);
}

async function main(): Promise<void> {
  assertWorkbookMirrorAllowed();
  const selected = entitiesToMirror();
  if (!selected.length) {
    const message = "No cut-over read flags are on, so the mirror has nothing to copy.";
    console.log(message);
    summary(`## Workbook mirror\n\n${message}\n`);
    return;
  }
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  assertProductionDiff(url);
  const dryRun = mirrorDryRun();
  const rows = await withConnectionString(url, (sql) => loadMirrorRows(sql));
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const token = await sheetsToken(raw);
  const refused: string[] = [];
  const held: { id: string; header: string }[] = [];
  let skippedProtected = 0;
  let appended = 0;
  let unmatched = 0;
  let activitySheetFloor = 0;
  const failed: FailedMirrorTab[] = [];
  const tasks: { tab: string; run: () => Promise<MirrorPlan> }[] = [];
  if (selected.includes("stage")) {
    tasks.push({
      tab: "Stage",
      run: async () => {
        const tables = [];
        for (const tab of stageTabs()) {
          tables.push(await loadTable(token, tab.title, tab.headerRow, [["site id"], ["stage"]]));
        }
        return planStageMirror(tables, rows.stages);
      },
    });
  }
  if (selected.includes("site")) {
    tasks.push({
      tab: "Sites",
      run: async () => {
        const tables = [];
        const names = [...new Set(MIRROR_FIELD_HEADERS.flatMap((row) => row.headers))];
        const headers = [["site id"], ...names.map((name) => [name])];
        for (const tab of stageTabs()) {
          tables.push(await loadTable(token, tab.title, tab.headerRow, headers, true));
        }
        const plan = planSiteMirror(tables, rows.sites);
        const created = planCreatedSiteMirror(tables, rows.createdSites);
        const floors = tables.flatMap((table) => labeledFloorsFromTable(table, ["site id"]));
        await withConnectionString(url, async (sql) => {
          for (const floor of floors) await raiseIdFloor(sql, floor.name, floor.value);
        });
        return {
          changes: [...plan.changes, ...created.changes],
          skippedProtected: plan.skippedProtected + created.skippedProtected,
          unmatched: [...plan.unmatched, ...created.unmatched],
          appended: plan.appended + created.appended,
          refused: [...plan.refused, ...created.refused],
          held: [...plan.held, ...created.held],
        };
      },
    });
    tasks.push({
      tab: "Universe",
      run: async () => {
        let universe: SheetTable;
        try {
          universe = await loadTable(token, UNIVERSE_SHEET, UNIVERSE_HEADER_ROW, [
            ["universe id", "site id", "lead id"],
            ["business name", "name"],
            ["address"],
            ["market"],
            ["apn", "apn or folio"],
            ["lat"],
            ["lon", "lng"],
            ["segment group", "category"],
            ["listing link"],
            ["broker"],
            ["counted in funnel"],
          ]);
        } catch (error) {
          if (rows.universeRows.length) throw error;
          console.error(JSON.stringify({ event: "universe_sheet_skipped" }));
          return blankPlan();
        }
        const plan = planUniverseMirror(universe, rows.universeRows);
        const floors = labeledFloorsFromTable(universe, ["universe id", "site id", "lead id"]);
        await withConnectionString(url, async (sql) => {
          for (const floor of floors) await raiseIdFloor(sql, floor.name, floor.value);
        });
        return plan;
      },
    });
  }
  if (selected.includes("activity")) {
    tasks.push({
      tab: "Activity",
      run: async () => {
        const table = await loadTable(token, ACTIVITY_SHEET, ACTIVITY_HEADER_ROW, [
          ["event id"],
          ["date", "when"],
          ["site id", "site_id", "record id"],
          ["type", "kind"],
          ["summary"],
          ["source link", "source_link"],
        ]);
        activitySheetFloor = sheetIdFloor(table, ["event id"], "A-");
        return planActivityMirror(table, rows.activities);
      },
    });
  }
  if (selected.includes("comms")) {
    tasks.push({
      tab: "Comms Log",
      run: async () => {
        const table = await loadTable(token, COMMS_SHEET, COMMS_HEADER_ROW, [
          ["comms id"],
          ["site ids"],
          ["thread id"],
          ["link"],
          ["date/time"],
          ["direction"],
          ["counterparty person"],
          ["counterparty firm"],
          ["channel"],
          ["summary"],
          ["asks made"],
          ["asks answered"],
          ["attachments"],
          ["state changes"],
          ["source"],
          ["message id"],
          ["subject"],
        ]);
        return planCommsMirror(table, rows.comms);
      },
    });
  }
  const plannedTabs = await planMirrorTabs(tasks);
  for (const failure of plannedTabs.failed) logTabFailure(failure);
  failed.push(...plannedTabs.failed);
  const changes: CellChange[] = [];
  for (const tab of plannedTabs.planned) {
    changes.push(...tab.plan.changes);
    skippedProtected += tab.plan.skippedProtected;
    appended += tab.plan.appended;
    unmatched += tab.plan.unmatched.length;
    refused.push(...tab.plan.refused);
    held.push(...tab.plan.held);
  }
  const bySheet = new Map<string, CellChange[]>();
  for (const change of changes) {
    const list = bySheet.get(change.sheet) || [];
    list.push(change);
    bySheet.set(change.sheet, list);
  }
  const sheetPlans = [...bySheet.entries()].map(([tab, sheetChanges]) => ({
    tab,
    plan: { ...blankPlan(), changes: sheetChanges },
  }));
  assertPlannedWrites(changes);
  const byEntity = entityChangeCounts(changes);
  const drift = mirrorDrift(changes);
  const driftText = formatMirrorDrift(drift);
  const counts = {
    cells: changes.length,
    stage_cells: byEntity.stage,
    site_cells: byEntity.site,
    activity_cells: byEntity.activity,
    comms_cells: byEntity.comms,
    drift_cells: drift.cells,
    fills: drift.fills,
    appended,
    unmatched,
    skipped_protected: skippedProtected,
    refused: refused.length,
    held_truncations: held.length,
    activity_sheet_floor: activitySheetFloor,
  };
  const preview = formatPlan(changes);
  const counted = formatPlanSummary(changes);
  const tabCounts = formatTabCounts(changes);
  const failureNote = failed.length ? failed.map((failure) => `${failure.tab}: ${failure.message}`).join("\n") : "tabs failed 0";
  const notes = [
    driftText,
    formatHeld(held),
    counted,
    tabCounts,
    `activity_sheet_floor ${activitySheetFloor}`,
    `refused ${refused.length}${refused.length ? ` ${refused.join(", ")}` : ""}`,
    failureNote,
  ].join("\n");
  console.log(notes);
  console.log(preview);
  if (dryRun) {
    summary(`## Workbook mirror dry run\n\nNothing was written.\n\n${notes}\n\n\`\`\`\n${preview.slice(0, 8000)}\n\`\`\`\n`);
  }
  assertMirrorRefusals(refused);
  if (dryRun) {
    if (failed.length) throw failedTabsError(failed);
    return;
  }
  const runId = newMirrorRunId();
  let phase: MirrorWritePhase = "idle";
  let settled = false;
  const finish = (status: "succeeded" | "failed", note: string): Promise<void> => {
    if (settled) return Promise.resolve();
    settled = true;
    return withConnectionString(url, (sql) => saveMirrorRun(sql, runId, counts, note, status)).then(
      () => undefined,
      () => undefined,
    );
  };
  watchMirrorCancel(
    () => phase,
    (note) => finish("failed", note),
    (code) => process.exit(code),
  );
  let written: CellChange[] = [];
  try {
    await withConnectionString(url, (sql) => saveMirrorRun(sql, runId, counts, "writing cells", "running"));
    phase = "writing";
    const writtenTabs = await writeMirrorTabs(sheetPlans, async (tab, sheetChanges) => {
      if (!sheetChanges.length) return;
      const bySheet = new Map<string, CellChange[]>();
      for (const change of sheetChanges) {
        const list = bySheet.get(change.sheet) || [];
        list.push(change);
        bySheet.set(change.sheet, list);
      }
      const remaining: CellChange[] = [];
      for (const [title, mine] of bySheet) {
        if (GROWN_SHEETS.has(title) && await writeGrownGrid(token, title, mine)) continue;
        remaining.push(...mine);
      }
      if (remaining.length) await writeCells(token, remaining);
    });
    for (const failure of writtenTabs.failed) logTabFailure(failure);
    failed.push(...writtenTabs.failed);
    written = writtenTabs.written;
    phase = "written";
  } catch (error) {
    await finish("failed", "write failed");
    throw error;
  }
  try {
    if (written.length) assertReadBack(written, await readBack(token, written));
  } catch (error) {
    const outcome = readBackOutcome(error);
    await finish(failed.length || outcome.rethrow ? "failed" : outcome.status, failed.length ? "tab failed" : outcome.note);
    if (outcome.rethrow) throw error;
    if (failed.length) throw failedTabsError(failed);
    console.log(`Wrote ${written.length} cells. Read-back was rate limited after retries.\n${driftText}\n${counted}`);
    summary(`## Workbook mirror\n\nWrote ${written.length} cells. Read-back was rate limited after retries. The run is recorded as succeeded.\n\n${driftText}\n\n${counted}\n`);
    return;
  }
  if (failed.length) {
    await finish("failed", "tab failed");
    throw failedTabsError(failed, ` Wrote ${written.length} cells on the other tabs.`);
  }
  await finish("succeeded", "wrote cells");
  console.log(`Wrote ${written.length} cells.\n${driftText}\n${counted}\n${tabCounts}`);
  summary(`## Workbook mirror\n\nWrote ${written.length} cells. Protected rows skipped: ${skippedProtected}. Drifted cells were overwritten with the database value.\n\n${driftText}\n\n${counted}\n\n${tabCounts}\n`);
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary(`## Workbook mirror failed\n\n${publicError(error)}\n`);
  process.exit(1);
});
