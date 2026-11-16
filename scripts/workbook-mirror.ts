import { appendFileSync } from "node:fs";
import { withConnectionString } from "../lib/actions/db";
import { assertProductionDiff } from "../lib/changes/guard";
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
  loadMirrorRows,
  mirrorDrift,
  mirrorDryRun,
  planActivityMirror,
  planCommsMirror,
  planSiteMirror,
  newMirrorRunId,
  planStageMirror,
  saveMirrorRun,
  sheetIdFloor,
  watchMirrorCancel,
  type MirrorWritePhase,
  stageTabs,
  type CellChange,
  type SheetRender,
  type SheetTable,
} from "../lib/changes/mirror";
import { loadSheetTable, readBackCells, readBackOutcome, readSheetRanges, sheetsFetch } from "../lib/changes/sheetTable";

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function publicError(error: unknown): string {
  const text = error instanceof Error ? error.message : "workbook mirror failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .slice(0, 500);
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
        throw new Error(
          `Sheets write failed (${response.status}). GOOGLE_SERVICE_ACCOUNT_JSON is used with ${MIRROR_SHEETS_SCOPE}. If the account is only a Viewer, share the Pipeline workbook with it as Editor.`,
        );
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
  const changes: CellChange[] = [];
  const refused: string[] = [];
  const held: { id: string; header: string }[] = [];
  let skippedProtected = 0;
  let appended = 0;
  let unmatched = 0;
  let activitySheetFloor = 0;
  if (selected.includes("stage")) {
    const tables = [];
    for (const tab of stageTabs()) {
      tables.push(await loadTable(token, tab.title, tab.headerRow, [["site id"], ["stage"]]));
    }
    const plan = planStageMirror(tables, rows.stages);
    changes.push(...plan.changes);
    skippedProtected += plan.skippedProtected;
    appended += plan.appended;
    unmatched += plan.unmatched.length;
  }
  if (selected.includes("site")) {
    const tables = [];
    const names = [...new Set(MIRROR_FIELD_HEADERS.flatMap((row) => row.headers))];
    const headers = [["site id"], ...names.map((name) => [name])];
    for (const tab of stageTabs()) {
      tables.push(await loadTable(token, tab.title, tab.headerRow, headers, true));
    }
    const plan = planSiteMirror(tables, rows.sites);
    changes.push(...plan.changes);
    skippedProtected += plan.skippedProtected;
    appended += plan.appended;
    unmatched += plan.unmatched.length;
  }
  if (selected.includes("activity")) {
    const table = await loadTable(token, ACTIVITY_SHEET, ACTIVITY_HEADER_ROW, [
      ["event id"],
      ["date", "when"],
      ["site id", "site_id", "record id"],
      ["type", "kind"],
      ["summary"],
      ["source link", "source_link"],
    ]);
    activitySheetFloor = sheetIdFloor(table, ["event id"], "A-");
    const plan = planActivityMirror(table, rows.activities);
    changes.push(...plan.changes);
    skippedProtected += plan.skippedProtected;
    appended += plan.appended;
    unmatched += plan.unmatched.length;
    refused.push(...plan.refused);
    held.push(...plan.held);
  }
  if (selected.includes("comms")) {
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
    const plan = planCommsMirror(table, rows.comms);
    changes.push(...plan.changes);
    skippedProtected += plan.skippedProtected;
    appended += plan.appended;
    unmatched += plan.unmatched.length;
    refused.push(...plan.refused);
    held.push(...plan.held);
  }
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
  const notes = [
    driftText,
    formatHeld(held),
    counted,
    `activity_sheet_floor ${activitySheetFloor}`,
    `refused ${refused.length}${refused.length ? ` ${refused.join(", ")}` : ""}`,
  ].join("\n");
  console.log(notes);
  console.log(preview);
  if (dryRun) {
    summary(`## Workbook mirror dry run\n\nNothing was written.\n\n${notes}\n\n\`\`\`\n${preview.slice(0, 8000)}\n\`\`\`\n`);
  }
  assertMirrorRefusals(refused);
  if (dryRun) return;
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
  try {
    await withConnectionString(url, (sql) => saveMirrorRun(sql, runId, counts, "writing cells", "running"));
    phase = "writing";
    await writeCells(token, changes);
    phase = "written";
  } catch (error) {
    await finish("failed", "write failed");
    throw error;
  }
  try {
    assertReadBack(changes, await readBack(token, changes));
  } catch (error) {
    const outcome = readBackOutcome(error);
    await finish(outcome.status, outcome.note);
    if (outcome.rethrow) throw error;
    console.log(`Wrote ${counts.cells} cells. Read-back was rate limited after retries.\n${driftText}\n${counted}`);
    summary(`## Workbook mirror\n\nWrote ${counts.cells} cells. Read-back was rate limited after retries. The run is recorded as succeeded.\n\n${driftText}\n\n${counted}\n`);
    return;
  }
  await finish("succeeded", "wrote cells");
  console.log(`Wrote ${counts.cells} cells.\n${driftText}\n${counted}`);
  summary(`## Workbook mirror\n\nWrote ${counts.cells} cells. Protected rows skipped: ${skippedProtected}. Drifted cells were overwritten with the database value.\n\n${driftText}\n\n${counted}\n`);
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary(`## Workbook mirror failed\n\n${publicError(error)}\n`);
  process.exit(1);
});
