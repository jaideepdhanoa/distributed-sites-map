import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../../lib/actions/db";

export async function memorySql(): Promise<Sql> {
  const db = new PGlite();
  return {
    async query(text, values) {
      const result = await db.query(text, values as never[] | undefined);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    async exec(text) {
      await db.exec(text);
    },
  } as Sql;
}
