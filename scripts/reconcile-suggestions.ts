import { actionsEnabled, getPool, withSql } from "../lib/actions/db";
import { migrate } from "../lib/actions/migrate";
import { reconcileSuggestions } from "../lib/actions/suggestions";
import { primeSnapshot } from "../lib/snapshot/read";

async function main() {
  if (!actionsEnabled()) {
    console.error("DATABASE_URL is not set. The map stays read-only.");
    process.exit(1);
  }
  await primeSnapshot();
  const applied = await withSql(async (sql) => {
    await migrate(sql);
    return reconcileSuggestions(sql);
  });
  console.log(JSON.stringify({ applied }));
  await getPool().end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "reconcile failed");
  process.exit(1);
});
