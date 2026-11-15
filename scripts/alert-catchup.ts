import { actionsEnabled, getPool, withSql } from "../lib/actions/db";
import { printCatchUp, runCatchUp } from "../lib/alerts/catchup";

// One catch-up email for jaideep@dhanoa.in. Dry run is the default.
// A dry run prints counts only. A real run (DRY_RUN=false) sends once.

function sendRequested(): boolean {
  return process.env.DRY_RUN === "false";
}

async function main() {
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
    console.error("Catch-up runs only on main.");
    process.exit(1);
  }
  if (!actionsEnabled()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const dryRun = !sendRequested();
  const result = await withSql((sql) => runCatchUp(sql, { dryRun }));
  printCatchUp(result);
  await getPool().end();
  if (!dryRun && result.status !== "sent") process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "catch-up failed");
  process.exit(1);
});
