import { columnLetters, SPREADSHEET_ID } from "../lib/changes/mirror";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";
import { readSheetRanges, sheetsFetch } from "../lib/changes/sheetTable";
import { POWER_HEADER_ROW, sheetsFailureText, type SheetGrid } from "../lib/score/power-sheet";

export const SITE_TABS = ["Pipeline", "Land Sites"] as const;

export function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "power points script failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500);
}

export function assertSheetScript(): void {
  if (process.env.VERCEL_ENV) throw new Error("Refusing to touch the workbook from Vercel.");
  if (process.env.GITHUB_EVENT_NAME === "pull_request") throw new Error("Refusing to touch the workbook from a pull request.");
  const ref = process.env.GITHUB_REF?.trim();
  if (process.env.GITHUB_ACTIONS === "true" && ref && ref !== "refs/heads/main") {
    throw new Error("This workbook script runs only on main.");
  }
}

export async function sheetToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  return sheetsAccessToken(raw, "https://www.googleapis.com/auth/spreadsheets");
}

function quote(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

export async function readHeaders(token: string, title: string): Promise<string[]> {
  const range = `${quote(title)}!${POWER_HEADER_ROW}:${POWER_HEADER_ROW}`;
  const grids = await readSheetRanges(token, SPREADSHEET_ID, [range], "formatted");
  return grids[0]?.[0] || [];
}

export async function readColumn(token: string, title: string, column: number, kind: "formulas" | "unformatted"): Promise<string[]> {
  const letter = columnLetters(column);
  const range = `${quote(title)}!${letter}${POWER_HEADER_ROW + 1}:${letter}`;
  const grids = await readSheetRanges(token, SPREADSHEET_ID, [range], kind);
  return (grids[0] || []).map((row) => String(row[0] ?? ""));
}

export async function readGrids(token: string): Promise<SheetGrid[]> {
  const response = await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(sheetsFailureText(response.status, body));
  const payload = JSON.parse(body) as {
    sheets?: { properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
  };
  return (payload.sheets || []).flatMap((sheet) => {
    const title = String(sheet.properties?.title || "");
    const sheetId = sheet.properties?.sheetId;
    const rowCount = sheet.properties?.gridProperties?.rowCount;
    const columnCount = sheet.properties?.gridProperties?.columnCount;
    if (!title || typeof sheetId !== "number" || typeof rowCount !== "number" || typeof columnCount !== "number") return [];
    return [{ title, sheetId, rowCount, columnCount }];
  });
}

/** One spreadsheets.batchUpdate. It grows the grid and writes the cells together. */
export async function writeFormulaBatch(token: string, requests: object[]): Promise<void> {
  if (!requests.length) return;
  const response = await sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!response.ok) throw new Error(sheetsFailureText(response.status, await response.text()));
}
