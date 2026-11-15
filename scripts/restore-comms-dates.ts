import { withConnectionString } from "../lib/actions/db";
import { applyDateRestore, formatDatePlan, loadCommsDates, planDateRestore } from "../lib/changes/dates";
import { isProductionDatabase } from "../lib/changes/guard";
import { MIRROR_SHEETS_SCOPE } from "../lib/changes/mirror";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";
import { readCommsDates } from "../lib/changes/summaries";

/**
 * Put lost Comms Log Date/time text back into the database.
 *
 * The sheet is the source. This reads it with the Sheets client (one batched
 * values read, with backoff). Dry run is the default. It prints ids, character
 * counts, and hashes only. It does not write the sheet.
 *
 *   npx tsx scripts/restore-comms-dates.ts
 *
 * Apply only after that plan is approved:
 *
 *   CONFIRM=restore-comms-dates ALLOW_COMMS_DATE_RESTORE=1 \
 *     npx tsx scripts/restore-comms-dates.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "comms date restore failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .slice(0, 500);
}

function assertApplyAllowed(url: string): void {
  if ((process.env.CONFIRM || "").trim() !== "restore-comms-dates") {
    throw new Error("Refusing to restore dates. Dry run is the default. Set CONFIRM=restore-comms-dates to apply.");
  }
  if (isProductionDatabase(url) && process.env.ALLOW_COMMS_DATE_RESTORE !== "1") {
    throw new Error("Refusing to restore production dates. Set ALLOW_COMMS_DATE_RESTORE=1 only after the dry-run plan is approved.");
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  const sheet = await readCommsDates(await sheetsAccessToken(raw, MIRROR_SHEETS_SCOPE));
  if (!sheet.size) throw new Error("The Comms Log has no date rows.");
  if (apply) assertApplyAllowed(url);
  const written = await withConnectionString(url, async (sql) => {
    const plan = planDateRestore(await loadCommsDates(sql), sheet);
    console.log(formatDatePlan(plan));
    if (!apply) return 0;
    return applyDateRestore(sql, sheet, plan);
  });
  console.log(apply ? `Restored ${written} dates. The sheet was not written.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
