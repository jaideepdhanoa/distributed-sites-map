import { withConnectionString } from "../lib/actions/db";
import { applyCaptureImport, assertCaptureImportApply, formatCapturePlan, loadCapturePlan, readCaptureRows } from "../lib/changes/captureImport";
import { MIRROR_SHEETS_SCOPE } from "../lib/changes/mirror";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";

/**
 * Copy workbook Activity rows of type capture into the database.
 *
 * The existing A- id is kept. A date with no clock is stored with
 * at_approximate. Dry run is the default. The log is counts and hashed ids.
 * Production writes are refused. The sheet is not written.
 *
 *   npx tsx scripts/import-capture-activity.ts
 *
 *   CONFIRM=import-capture-activity npx tsx scripts/import-capture-activity.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "capture import failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .slice(0, 500);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  if (apply) assertCaptureImportApply(url, process.env.CONFIRM);
  const rows = await readCaptureRows(await sheetsAccessToken(raw, MIRROR_SHEETS_SCOPE));
  const written = await withConnectionString(url, async (sql) => {
    const plan = await loadCapturePlan(sql, rows);
    console.log(formatCapturePlan(plan));
    if (!apply) return 0;
    return applyCaptureImport(sql, plan);
  });
  console.log(apply ? `Wrote ${written} capture rows. The sheet was not written.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
