import { actionsEnabled, getPool, withSql } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";
import { backfillInbox } from "../lib/agent/backfill";

// Reads the shared Neon database. --write inserts feed rows into that same database.
// Preview and production use one DATABASE_URL, so --write updates production. Do not run it from CI.

function wantWrite(): boolean {
  const write = process.argv.includes("--write");
  const dryRun = process.argv.includes("--dry-run");
  if (write && dryRun) {
    console.error("Pass either --dry-run or --write.");
    process.exit(2);
  }
  return write;
}

async function main() {
  const write = wantWrite();
  if (!actionsEnabled()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  if (write && process.env.CI) {
    console.error("Refusing to write the agent feed from CI.");
    process.exit(1);
  }
  const report = await withSql(async (sql) => {
    if (write) await migrate(sql);
    return backfillInbox(sql, { dryRun: !write });
  });
  if (!write) console.error("Dry run. Nothing was written. Pass --write to insert.");
  console.log(JSON.stringify(report, null, 2));
  await getPool().end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "backfill failed");
  process.exit(1);
});
