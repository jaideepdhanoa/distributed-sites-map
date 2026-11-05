import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type Sql = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<void>;
};

let pool: Pool | null = null;

export function databaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url || null;
}

export function actionsEnabled(): boolean {
  return Boolean(databaseUrl());
}

function sslOption(url: string): false | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === "disable" || /sslmode=disable/i.test(url)) return false;
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1") return false;
  } catch {
    return { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}

export function getPool(): Pool {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: sslOption(url),
    });
  }
  return pool;
}

function wrap(client: PoolClient | Pool): Sql {
  return {
    query: async (text, values) => {
      const result = await client.query(text, values as never[]);
      return { rows: result.rows };
    },
    exec: async (text) => {
      await client.query(text);
    },
  };
}

export async function withSql<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(wrap(client));
  } finally {
    client.release();
  }
}
