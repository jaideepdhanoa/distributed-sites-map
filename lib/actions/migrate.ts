import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./db";

const MIGRATION_ID = /^[0-9A-Za-z._-]+$/;

export function migrationDir(): string {
  return join(process.cwd(), "db", "migrations");
}

export async function migrate(sql: Sql): Promise<string[]> {
  await sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = readdirSync(migrationDir())
    .filter((name) => name.endsWith(".sql") && MIGRATION_ID.test(name))
    .sort();
  const applied = new Set(
    (await sql.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((row) => row.id),
  );
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
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
