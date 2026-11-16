import { withConnectionString } from "../lib/actions/db";
import { applyStageBackfill, assertStageBackfillApply, formatStageBackfill, loadStageBackfill } from "../lib/changes/stageBackfill";

/**
 * Backfill a Desk screen stage for sites with no stage row, and number legacy
 * stage labels. Dry run is the default. It prints counts and hashed ids only.
 * It refuses to write the production database.
 *
 *   npx tsx scripts/backfill-stages.ts
 *
 *   CONFIRM=backfill-stages npx tsx scripts/backfill-stages.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "stage backfill failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  if (apply) assertStageBackfillApply(url, process.env.CONFIRM);
  const written = await withConnectionString(url, async (sql) => {
    const plan = await loadStageBackfill(sql);
    console.log(formatStageBackfill(plan));
    if (!apply) return 0;
    return applyStageBackfill(sql, plan);
  });
  console.log(apply ? `Wrote ${written} stages.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
