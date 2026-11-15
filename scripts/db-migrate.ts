import { databaseUrl, getPool, withSql, actionsEnabled } from "../lib/actions/db";
import { migrate, ProductionWriteRefused } from "../lib/actions/migrate";

async function main() {
  if (!actionsEnabled()) {
    console.error("DATABASE_URL is not set. The map stays read-only.");
    process.exit(1);
  }
  const applied = await withSql((sql) => migrate(sql, { connectionString: databaseUrl() }));
  console.log(JSON.stringify({ applied }));
  await getPool().end();
}

main().catch((error: unknown) => {
  if (error instanceof ProductionWriteRefused) console.error(error.message);
  else console.error(error instanceof Error ? error.name : "migrate failed");
  process.exit(1);
});
