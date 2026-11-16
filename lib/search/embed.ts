import { actionsEnabled, withSql, type Sql } from "@/lib/actions/db";
import type { DocType } from "./docs";

const MODEL = "openai/text-embedding-3-small";

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
}

/** Embed one string. Returns null when the gateway is unset or the call fails. Never throws. */
export async function embedText(value: string): Promise<number[] | null> {
  const text = value.trim();
  if (!text || !embeddingsConfigured()) return null;
  try {
    const { createGateway, embed } = await import("ai");
    const gateway = createGateway();
    const result = await embed({
      model: gateway.embeddingModel(MODEL),
      value: text.slice(0, 8000),
    });
    const vector = result.embedding;
    if (!Array.isArray(vector) || vector.length !== 1536) return null;
    return vector;
  } catch (error) {
    console.error(JSON.stringify({ event: "embedding_error", name: error instanceof Error ? error.name : "error" }));
    return null;
  }
}

async function hasEmbeddingColumn(sql: Sql): Promise<boolean> {
  const rows = await sql.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'search_docs' AND column_name = 'embedding'`,
  );
  return rows.rows.length > 0;
}

export async function embedPending(sql: Sql, limit = 25): Promise<{ embedded: number; skipped: number; reason?: string }> {
  if (!embeddingsConfigured()) return { embedded: 0, skipped: 0, reason: "unavailable" };
  if (!(await hasEmbeddingColumn(sql))) return { embedded: 0, skipped: 0, reason: "no_vector_column" };
  const rows = await sql.query<{ doc_type: DocType; entity_id: string; title: string; body: string }>(
    `SELECT doc_type, entity_id, title, body
     FROM search_docs
     WHERE embedded_at IS NULL
     ORDER BY updated_at ASC
     LIMIT $1`,
    [Math.min(50, Math.max(1, limit))],
  );
  let embedded = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    const vector = await embedText(`${row.title}\n${row.body}`.trim());
    if (!vector) {
      skipped += 1;
      continue;
    }
    const literal = `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
    await sql.query(
      `UPDATE search_docs
       SET embedding = $1::halfvec, embedded_at = clock_timestamp()
       WHERE doc_type = $2 AND entity_id = $3`,
      [literal, row.doc_type, row.entity_id],
    );
    embedded += 1;
  }
  return { embedded, skipped };
}

export function scheduleEmbed(): void {
  if (!embeddingsConfigured() || !actionsEnabled()) return;
  const timer = setTimeout(() => {
    void withSql((sql) => embedPending(sql)).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "embedding_error", name: error instanceof Error ? error.name : "error" }));
    });
  }, 25);
  timer.unref?.();
}
