import { withConnectionString } from "../lib/actions/db";
import { applyUniverseFolds, assertUniverseRepairApply, formatUniverseFolds, planUniverseFolds } from "../lib/changes/universeRepair";

/**
 * Fold a duplicate Universe row into the census row a Pipeline site should use.
 *
 * Dry run is the default and writes nothing. It prints site id, the duplicate
 * Universe id, and the census id.
 *
 *   npx tsx scripts/repair-universe-duplicates.ts
 *
 * Apply needs the confirm phrase. Do not run it from a pull request.
 *
 *   CONFIRM=repair-universe-duplicates npx tsx scripts/repair-universe-duplicates.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "universe repair failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  if (apply) assertUniverseRepairApply(url, process.env.CONFIRM);
  const result = await withConnectionString(url, async (sql) => {
    const folds = await planUniverseFolds(sql);
    const written = apply ? await applyUniverseFolds(sql, folds) : 0;
    return { folds, written };
  });
  console.log(formatUniverseFolds(result.folds));
  console.log(apply ? `Folded ${result.written} rows.` : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
