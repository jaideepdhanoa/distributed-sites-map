import { withConnectionString } from "../lib/actions/db";
import { isProductionDatabase } from "../lib/changes/guard";
import { MIRROR_SHEETS_SCOPE } from "../lib/changes/mirror";
import { sheetsAccessToken } from "../lib/changes/sheetsAuth";
import { applySummaryRestore, formatSummaryPlan, loadCommsSummaries, planSummaryRestore, readCommsSummaries } from "../lib/changes/summaries";

/**
 * Put full comms summaries back into the database.
 *
 * The Comms Log tab is the source. This reads it with the Sheets client
 * (one batched values read, with backoff). Dry run is the default. It prints
 * ids and character counts only, and it does not write the database or the sheet.
 *
 *   npx tsx scripts/restore-comms-summaries.ts
 *
 * Apply only after that plan is approved:
 *
 *   CONFIRM=restore-comms-summaries ALLOW_COMMS_SUMMARY_RESTORE=1 \
 *     npx tsx scripts/restore-comms-summaries.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "comms summary restore failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted-key]")
    .replace(/"private_key"\s*:\s*"(?:\\.|[^"\\])*"/g, '"private_key":"[redacted]"')
    .slice(0, 500);
}

function assertApplyAllowed(url: string): void {
  if ((process.env.CONFIRM || "").trim() !== "restore-comms-summaries") {
    throw new Error("Refusing to restore summaries. Dry run is the default. Set CONFIRM=restore-comms-summaries to apply.");
  }
  if (isProductionDatabase(url) && process.env.ALLOW_COMMS_SUMMARY_RESTORE !== "1") {
    throw new Error("Refusing to restore production summaries. Set ALLOW_COMMS_SUMMARY_RESTORE=1 only after the dry-run plan is approved.");
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  const full = await readCommsSummaries(await sheetsAccessToken(raw, MIRROR_SHEETS_SCOPE));
  if (!full.size) throw new Error("The Comms Log has no summary rows.");
  if (apply) assertApplyAllowed(url);
  const written = await withConnectionString(url, async (sql) => {
    const plan = planSummaryRestore(await loadCommsSummaries(sql), full);
    console.log(formatSummaryPlan(plan));
    if (!apply) return 0;
    return applySummaryRestore(sql, full, plan);
  });
  console.log(apply ? `Restored ${written} summaries. The sheet was not written.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
