import { withConnectionString } from "../lib/actions/db";
import {
  applyTagBackfill,
  assertTagBackfillApply,
  formatTagBackfill,
  loadTagBackfill,
  readTagBackfillCounts,
} from "../lib/tags/backfill";

/**
 * Map today's stage, blocker, package, NDA, photo, listing, and note cells
 * onto chip codes. Dry run is the default. It prints counts and hashed ids.
 * It does not change legacy cells. It refuses the production database.
 * The quarantined pipeline row is skipped.
 *
 *   npx tsx scripts/backfill-tags.ts
 *
 *   CONFIRM=backfill-tags npx tsx scripts/backfill-tags.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "tag backfill failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  if (apply) assertTagBackfillApply(url, process.env.CONFIRM);
  await withConnectionString(url, async (sql) => {
    const plan = await loadTagBackfill(sql);
    console.log(formatTagBackfill(plan));
    if (!apply) {
      console.log("Dry run. Nothing was written.");
      return;
    }
    const written = await applyTagBackfill(sql, plan);
    const readBack = await readTagBackfillCounts(sql);
    console.log(`Wrote ${written} tags.`);
    for (const row of readBack) console.log(`read ${row.family} ${row.code} ${row.n}`);
  });
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
