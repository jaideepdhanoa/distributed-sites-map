import { withConnectionString } from "../lib/actions/db";
import { isProductionDatabase } from "../lib/changes/guard";
import { applyActivityRenumber, formatRenumberPlan, planActivityRenumber } from "../lib/changes/renumber";

/**
 * Re-number the two activity rows that reused workbook ids.
 *
 * Dry run is the default. It prints ids only and writes nothing.
 *
 *   WORKBOOK_ACTIVITY_FLOOR=273 npx tsx scripts/renumber-activity-collisions.ts
 *
 * Take the floor from a workbook-mirror dry run's activity_sheet_floor line.
 * That dry run writes nothing. Apply only after the plan is approved:
 *
 *   CONFIRM=renumber-activity-ids ALLOW_ACTIVITY_RENUMBER=1 \
 *     WORKBOOK_ACTIVITY_FLOOR=273 \
 *     npx tsx scripts/renumber-activity-collisions.ts --apply
 */

function redact(error: unknown): string {
  const text = error instanceof Error ? error.message : "activity renumber failed";
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\b[\w.-]+\.neon\.tech\b/gi, "[redacted-host]")
    .slice(0, 500);
}

function floor(): number {
  const raw = process.env.WORKBOOK_ACTIVITY_FLOOR?.trim() || "0";
  if (!/^\d+$/.test(raw)) throw new Error("WORKBOOK_ACTIVITY_FLOOR must be a whole number.");
  return Number(raw);
}

function assertApplyAllowed(url: string): void {
  if ((process.env.CONFIRM || "").trim() !== "renumber-activity-ids") {
    throw new Error("Refusing to re-number. Dry run is the default. Set CONFIRM=renumber-activity-ids to apply.");
  }
  if (isProductionDatabase(url) && process.env.ALLOW_ACTIVITY_RENUMBER !== "1") {
    throw new Error("Refusing to re-number production. Set ALLOW_ACTIVITY_RENUMBER=1 only after the dry-run plan is approved.");
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEON_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("NEON_DATABASE_URL is not set.");
  const workbookFloor = floor();
  if (apply) assertApplyAllowed(url);
  const plan = await withConnectionString(url, (sql) =>
    apply ? applyActivityRenumber(sql, workbookFloor) : planActivityRenumber(sql, workbookFloor),
  );
  console.log(formatRenumberPlan(plan));
  console.log(apply ? "Applied. The sheet was not written." : "Dry run. Nothing was written.");
}

main().catch((error: unknown) => {
  console.error(redact(error));
  process.exit(1);
});
