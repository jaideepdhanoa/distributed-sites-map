import { createHash } from "node:crypto";
import type { Sql } from "./db";
import { InputError } from "./text";

/** Store the creation and its replay receipt in the same transaction. */
export async function createWithReceipt<T>(
  sql: Sql, request: Request, actor: string, body: unknown, create: (tx: Sql) => Promise<T>,
): Promise<T> {
  const token = request.headers.get("Idempotency-Key");
  if (!token) return create(sql);
  if (!/^[a-f0-9-]{36}$/i.test(token)) throw new InputError("Invalid save reference.");
  const route = new URL(request.url).pathname;
  const key = `workspace:${actor}:${route}:${token}`;
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const effects: (() => Promise<void>)[] = [];
  const tx: Sql = { ...sql, afterCommit: effect => { effects.push(effect); } };
  let result: T;
  await sql.exec("BEGIN");
  try {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const { rows } = await sql.query<{ request_hash: string; response: T }>(
      "SELECT request_hash, response FROM change_receipts WHERE idempotency_key = $1", [key],
    );
    if (rows[0] && rows[0].request_hash !== hash) throw new InputError("This draft changed. Start a new save.", 409);
    result = rows[0] ? rows[0].response : await create(tx);
    if (!rows[0]) {
      await sql.query("INSERT INTO change_receipts (idempotency_key, request_hash, response, actor) VALUES ($1, $2, $3::jsonb, $4)", [key, hash, JSON.stringify(result), actor]);
    }
    await sql.exec("COMMIT");
  } catch (error) {
    await sql.exec("ROLLBACK");
    throw error;
  }
  for (const effect of effects) await effect();
  return result;
}
