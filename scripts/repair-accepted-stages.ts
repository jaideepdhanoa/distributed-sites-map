import { withConnectionString } from "../lib/actions/db";
import { assertStageRepairApply, applyStageRepair, formatStageRepair, planStageRepair } from "../lib/changes/stageRepair";

/**
 * Write the stage for accepted proposals whose site stage never changed.
 *
 * Dry run is the default and writes nothing. It prints site id, proposal id,
 * accepted at, accepted by, target stage, and current stage.
 *
 *   npx tsx scripts/repair-accepted-stages.ts
 *
 * Apply needs the confirm phrase.
 *
 *   CONFIRM=repair-accepted-stages npx tsx scripts/repair-accepted-stages.ts --apply
 *
 * A production write also needs ALLOW_REPAIR_ACCEPTED_STAGES=1. Previews and
 * pull-request jobs cannot write. Do not run an apply against production
 * from a pull request.
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "stage repair failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  if (apply) assertStageRepairApply(url, process.env.CONFIRM);
  const result = await withConnectionString(url, async (sql) => {
    const rows = await planStageRepair(sql);
    const written = apply ? await applyStageRepair(sql, rows) : 0;
    return { rows, written };
  });
  console.log(formatStageRepair(result.rows));
  console.log(apply ? `Wrote ${result.written} stages.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
