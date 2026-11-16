import { actionsEnabled, databaseUrl, getPool, withSql } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";
import { backfillDecision, backfillSearch } from "../lib/search/backfill";

async function main() {
  if (!actionsEnabled()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const write = process.argv.includes("--write");
  const confirm = process.env.CONFIRM === "1";
  const decision = backfillDecision(databaseUrl(), confirm);
  if (!decision.ok) {
    console.error(decision.reason);
    process.exit(1);
  }
  const counts = await withSql(async (sql) => {
    await migrate(sql);
    return backfillSearch(sql, { write, embed: write });
  });
  console.log(JSON.stringify(counts));
  await getPool().end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "backfill failed");
  process.exit(1);
});
