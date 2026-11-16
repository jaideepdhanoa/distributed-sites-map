import { appendFileSync } from "node:fs";
import { MIRROR_SHEETS_SCOPE, SPREADSHEET_ID } from "../lib/changes/mirror";
import {
  formatProtectionPlan,
  planSheetProtection,
  protectionMode,
  protectionRequests,
  type SheetProtection,
} from "../lib/changes/protect";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";
import { sheetsFetch } from "../lib/changes/sheetTable";

/**
 * Protect mirrored tabs and set a read-only note.
 *
 * Dry run is the default and writes nothing. Apply needs all three:
 * WORKBOOK_PROTECT_APPLY=1, WORKBOOK_PROTECT_DRY_RUN=0, and
 * CONFIRM=protect-workbook-readonly. The workflow ships with dry run on.
 * Do not run an apply against the live workbook from a pull request.
 */

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

function publicError(error: unknown): string {
  const text = error instanceof Error ? error.message : "workbook protect failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500);
}

function assertProtectContext(): void {
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to protect the workbook from Vercel.");
  }
  const ref = process.env.GITHUB_REF?.trim();
  if (process.env.GITHUB_ACTIONS === "true" && ref !== "refs/heads/main") {
    throw new Error("Workbook protection runs only on main.");
  }
}

function accountEmail(raw: string): string {
  let info: { client_email?: string };
  try {
    info = JSON.parse(raw) as { client_email?: string };
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  const email = info.client_email?.trim() || "";
  if (!email) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing the account email.");
  return email;
}

function wholeSheet(range: Record<string, unknown> | undefined): boolean {
  if (!range) return false;
  const keys = Object.keys(range).filter((key) => range[key] != null);
  return keys.length === 1 && keys[0] === "sheetId";
}

async function listSheets(token: string): Promise<SheetProtection[]> {
  const response = await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(sheetId,title),protectedRanges(range))`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Sheets protect list failed (${response.status}).`);
  const payload = (await response.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string }; protectedRanges?: { range?: Record<string, unknown> }[] }[];
  };
  return (payload.sheets || []).flatMap((sheet) => {
    const sheetId = sheet.properties?.sheetId;
    const title = String(sheet.properties?.title || "");
    if (typeof sheetId !== "number" || !title) return [];
    return [{
      sheetId,
      title,
      wholeSheet: (sheet.protectedRanges || []).some((range) => wholeSheet(range.range)),
    }];
  });
}

async function main(): Promise<void> {
  assertProtectContext();
  const mode = protectionMode({
    apply: process.env.WORKBOOK_PROTECT_APPLY,
    dry: process.env.WORKBOOK_PROTECT_DRY_RUN,
    confirm: process.env.CONFIRM,
  });
  if (mode === "refuse") {
    throw new Error("Refusing to protect the workbook. Set dry run off, set apply on, and type the confirm phrase.");
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const token = await sheetsAccessToken(raw, MIRROR_SHEETS_SCOPE);
  const plan = planSheetProtection(await listSheets(token));
  const text = formatProtectionPlan(plan, mode === "apply" ? "apply" : "dry-run");
  console.log(text);
  summary(`## Workbook protect\n\n${text}\n`);
  if (mode !== "apply") return;
  const requests = protectionRequests(plan, accountEmail(raw));
  if (!requests.length) {
    console.log("No ranges to add.");
    return;
  }
  const response = await sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!response.ok) {
    throw new Error(
      `Sheets protect failed (${response.status}). GOOGLE_SERVICE_ACCOUNT_JSON is used with ${MIRROR_SHEETS_SCOPE}. The account needs to be an Editor of the Pipeline workbook.`,
    );
  }
  console.log(`Protected ${plan.protect.length} tabs. Notes set on ${plan.note.length} tabs.`);
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  summary(`## Workbook protect failed\n\n${publicError(error)}\n`);
  process.exit(1);
});
