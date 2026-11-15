import { readFileSync } from "node:fs";
import { withConnectionString } from "../lib/actions/db";
import { isProductionDatabase } from "../lib/changes/guard";
import { applySummaryRestore, formatSummaryPlan, fullSummaries, loadCommsSummaries, planSummaryRestore } from "../lib/changes/summaries";

/**
 * Put full comms summaries back into the database.
 *
 * The public snapshot stays clipped at 300 characters. This reads the private
 * file written when COMMS_FULL_PATH is set, for example by the Shadow diff
 * build. Dry run is the default. It prints ids and character counts only.
 *
 *   COMMS_FULL_PATH=/tmp/comms_full.json npx tsx scripts/restore-comms-summaries.ts
 *
 * Apply only after that plan is approved. This writes the production database
 * and does not write the sheet:
 *
 *   CONFIRM=restore-comms-summaries ALLOW_COMMS_SUMMARY_RESTORE=1 \
 *     COMMS_FULL_PATH=/tmp/comms_full.json \
 *     npx tsx scripts/restore-comms-summaries.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "comms summary restore failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
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
  const path = process.env.COMMS_FULL_PATH?.trim() || "";
  if (!path) throw new Error("COMMS_FULL_PATH is not set.");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  const full = fullSummaries(readFileSync(path, "utf8"));
  if (!full.size) throw new Error("The private comms file has no rows.");
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
