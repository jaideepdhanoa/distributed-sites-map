import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isProductionDatabase,
  migrationDecision,
  migrationRefusalMessage,
  ProductionWriteRefused,
  shadowContext,
} from "../changes/guard";
import { databaseUrl, type Sql } from "./db";

const MIGRATION_ID = /^[0-9A-Za-z._-]+$/;

export { ProductionWriteRefused };

export function migrationDir(): string {
  return join(process.cwd(), "db", "migrations");
}

function migrationFiles(): string[] {
  return readdirSync(migrationDir())
    .filter((name) => name.endsWith(".sql") && MIGRATION_ID.test(name))
    .sort();
}

export async function migrate(
  sql: Sql,
  options?: { connectionString?: string | null; onProduction?: "skip"; onPreview?: "skip"; onlyPending?: string },
): Promise<string[]> {
  const url = options && "connectionString" in options ? options.connectionString : databaseUrl();
  let decision = migrationDecision(url);
  // The workbook sync already runs against production. It must not apply new
  // migrations from CI, and it must not fail when those migrations are waiting
  // for the manual workflow.
  if (options?.onProduction === "skip" && isProductionDatabase(url)) decision = "skip";
  // A preview request must not apply a pending file, and it must not fail the
  // request when that file is waiting for the manual workflow.
  if (options?.onPreview === "skip" && shadowContext() === "preview") decision = "skip";
  if (decision === "refuse") throw new ProductionWriteRefused(migrationRefusalMessage());
  if (decision === "skip") {
    try {
      const have = new Set(
        (await sql.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((row) => row.id),
      );
      const pending = migrationFiles().filter((file) => !have.has(file));
      if (pending.length) console.error(JSON.stringify({ event: "production_migration_skipped", count: pending.length }));
    } catch {
      console.error(JSON.stringify({ event: "production_migration_skipped" }));
    }
    return [];
  }
  if (!options?.onlyPending) await sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = migrationFiles();
  const applied = new Set(
    (await sql.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((row) => row.id),
  );
  const pending = files.filter((file) => !applied.has(file));
  const only = options?.onlyPending;
  if (only && (!files.includes(only) || pending.some((file) => file !== only))) {
    throw new Error("Pending migrations differ from the authorized filename. No migration was applied.");
  }
  const ran: string[] = [];
  for (const file of pending) {
    const body = readFileSync(join(migrationDir(), file), "utf8");
    const script = `BEGIN;\n${body}\nINSERT INTO schema_migrations (id) VALUES ('${file}');\nCOMMIT;`;
    try {
      await sql.exec(script);
    } catch (error) {
      const have = await sql.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", [file]);
      if (!have.rows.length) throw error;
    }
    ran.push(file);
  }
  return ran;
}

let readyPromise: Promise<void> | null = null;

export function resetReady(): void {
  readyPromise = null;
}

export function whenReady(run: () => Promise<void>): Promise<void> {
  if (!readyPromise) {
    readyPromise = run().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}
