import { appendFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { withConnectionString } from "../lib/actions/db";
import { assertProductionDiff } from "../lib/changes/guard";
import { SITE_MIRROR_FIELDS } from "../lib/changes/site";
import {
  ACTIVITY_HEADER_ROW,
  ACTIVITY_SHEET,
  COMMS_HEADER_ROW,
  COMMS_SHEET,
  MIRROR_SHEETS_SCOPE,
  SPREADSHEET_ID,
  a1,
  assertPlannedWrites,
  assertReadBack,
  assertWorkbookMirrorAllowed,
  entitiesToMirror,
  formatPlan,
  loadMirrorRows,
  mirrorDryRun,
  planActivityMirror,
  planCommsMirror,
  planSiteMirror,
  planStageMirror,
  recordMirrorRun,
  stageTabs,
  type CellChange,
  type SheetTable,
} from "../lib/changes/mirror";

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

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function sheetsToken(raw: string): Promise<string> {
  let info: { client_email?: string; private_key?: string };
  try {
    info = JSON.parse(raw) as { client_email?: string; private_key?: string };
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!info.client_email || !info.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing the account email or key.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: info.client_email,
    scope: MIRROR_SHEETS_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(info.private_key).toString("base64url");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${header}.${claim}.${signature}`,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!response.ok) {
    throw new Error(
      `Google refused a Sheets token (${response.status}). The sync secret is requested as drive.readonly. The mirror requests ${MIRROR_SHEETS_SCOPE}. Share the Pipeline workbook with the service account as Editor.`,
    );
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google did not return an access token.");
  return payload.access_token;
}

async function sheetsValues(token: string, range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Sheets read failed (${response.status}) for a workbook range.`);
  const payload = (await response.json()) as { values?: unknown[][] };
  return (payload.values || []).map((row) => row.map((cell) => String(cell ?? "")));
}

async function loadTable(token: string, title: string, headerRow: number, fieldHeaders: string[][]): Promise<SheetTable> {
  const header = await sheetsValues(token, `${quote(title)}!${headerRow}:${headerRow}`);
  const headers = header[0] || [];
  const wanted = new Set(fieldHeaders.flat().map((name) => name.trim().toLowerCase()));
  const indexes = headers
    .map((name, index) => ({ name, index }))
    .filter((column) => wanted.has(column.name.trim().toLowerCase()))
    .map((column) => column.index);
  const rows = new Map<number, string[]>();
  for (const index of indexes) {
    const column = columnLetter(index + 1);
    const values = await sheetsValues(token, `${quote(title)}!${column}${headerRow + 1}:${column}`);
    values.forEach((line, offset) => {
      const rowNumber = headerRow + 1 + offset;
      const cells = rows.get(rowNumber) || [];
      cells[index] = line[0] || "";
      rows.set(rowNumber, cells);
    });
  }
  return {
    title,
    headerRow,
    headers,
    rows: [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, cells]) => ({ row, cells })),
  };
}

function quote(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

function columnLetter(column: number): string {
  let n = column;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

async function writeCells(token: string, changes: CellChange[]): Promise<void> {
  for (let start = 0; start < changes.length; start += 400) {
    const chunk = changes.slice(start, start + 400);
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "RAW",
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

async function readBack(token: string, changes: CellChange[]): Promise<{ sheet: string; row: number; column: number; value: string }[]> {
  const out: { sheet: string; row: number; column: number; value: string }[] = [];
  for (const change of changes) {
    const values = await sheetsValues(token, a1(change.sheet, change.row, change.column));
    const cell = values[0]?.[0];
    out.push({ sheet: change.sheet, row: change.row, column: change.column, value: cell == null ? "" : cell });
  }
  return out;
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
  let skippedProtected = 0;
  let appended = 0;
  let unmatched = 0;
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
    const headers = SITE_MIRROR_FIELDS.map((field) => field.headers);
    for (const tab of stageTabs()) {
      tables.push(await loadTable(token, tab.title, tab.headerRow, headers));
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
    const plan = planActivityMirror(table, rows.activities);
    changes.push(...plan.changes);
    skippedProtected += plan.skippedProtected;
    appended += plan.appended;
    unmatched += plan.unmatched.length;
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
  }
  assertPlannedWrites(changes);
  const counts = {
    cells: changes.length,
    stage_cells: changes.filter((change) => change.header.trim().toLowerCase() === "stage").length,
    site_cells: changes.filter((change) => change.header.trim().toLowerCase() !== "stage" && (change.sheet === "Pipeline" || change.sheet === "Land Sites")).length,
    activity_cells: changes.filter((change) => change.sheet === ACTIVITY_SHEET).length,
    comms_cells: changes.filter((change) => change.sheet === COMMS_SHEET).length,
    appended,
    unmatched,
    skipped_protected: skippedProtected,
  };
  const preview = formatPlan(changes);
  if (dryRun) {
    console.log(preview);
    summary(`## Workbook mirror dry run\n\n${counts.cells} cells would change. Nothing was written.\n\n\`\`\`\n${preview.slice(0, 8000)}\n\`\`\`\n`);
    return;
  }
  try {
    await writeCells(token, changes);
    assertReadBack(changes, await readBack(token, changes));
  } catch (error) {
    await withConnectionString(url, (sql) => recordMirrorRun(sql, counts, "read-back or write failed", "failed")).catch(() => undefined);
    throw error;
  }
  await withConnectionString(url, (sql) => recordMirrorRun(sql, counts, "wrote cells", "succeeded"));
  console.log(`Wrote ${counts.cells} cells.`);
  summary(`## Workbook mirror\n\nWrote ${counts.cells} cells. Protected rows skipped: ${skippedProtected}.\n`);
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary(`## Workbook mirror failed\n\n${publicError(error)}\n`);
  process.exit(1);
});
