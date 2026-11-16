import type { Sql } from "@/lib/actions/db";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { appPath, resultUrl } from "@/lib/agent/links";
import { foldKey, type DocType, type Visibility } from "./docs";
import { reciprocalRankFusion, withExactWins } from "./rank";

export type SearchHit = {
  id: string;
  docType: DocType;
  entityId: string;
  siteId: string;
  brokerId: string;
  title: string;
  group: "sites" | "brokers" | "conversations" | "other";
  url: string;
  path: string;
};

type Row = {
  doc_type: DocType;
  entity_id: string;
  site_id: string;
  broker_id: string;
  title: string;
  body: string;
};

const GROUPS: Record<string, SearchHit["group"]> = {
  site: "sites",
  broker: "brokers",
  comms: "conversations",
  note: "conversations",
};

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function rowId(row: { doc_type: string; entity_id: string }): string {
  return `${row.doc_type}:${row.entity_id}`;
}

function isExact(query: string, row: Row): boolean {
  const needle = foldKey(query);
  if (!needle) return false;
  if ([row.title, row.entity_id, row.site_id, row.broker_id].some((value) => foldKey(value) === needle)) return true;
  return foldKey(row.body).split(" ").includes(needle);
}

async function hasExtension(sql: Sql, name: string): Promise<boolean> {
  const rows = await sql.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname = $1`, [name]);
  return rows.rows.length > 0;
}

async function hasEmbedding(sql: Sql): Promise<boolean> {
  const rows = await sql.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'search_docs' AND column_name = 'embedding'`,
  );
  return rows.rows.length > 0;
}

export async function searchDocs(sql: Sql, input: {
  query: string;
  visibility: Visibility[];
  types?: string[];
  siteId?: string;
  embedding?: number[] | null;
  limit?: number;
}): Promise<SearchHit[]> {
  const query = input.query.trim();
  if (query.length < 2) return [];
  const visibility = input.visibility.length ? input.visibility : ["public"];
  const types = (input.types || []).filter((type) => type.trim());
  const siteId = input.siteId?.trim() || "";
  const limit = Math.min(30, Math.max(1, input.limit || 12));
  const filters = [`visibility = ANY($2::text[])`, `upper(site_id) <> 'PIPE-PHX-0006'`, `upper(entity_id) <> 'PIPE-PHX-0006'`];
  const params: unknown[] = [query, visibility];
  if (types.length) {
    params.push(types);
    filters.push(`doc_type = ANY($${params.length}::text[])`);
  }
  if (siteId) {
    params.push(siteId);
    filters.push(`(upper(site_id) = upper($${params.length}) OR upper(entity_id) = upper($${params.length}))`);
  }
  const where = filters.join(" AND ");
  const fts = await sql.query<Row>(
    `SELECT doc_type, entity_id, site_id, broker_id, title, body
     FROM search_docs
     WHERE search_vector @@ plainto_tsquery('simple', $1::text) AND ${where}
     ORDER BY ts_rank_cd(search_vector, plainto_tsquery('simple', $1::text)) DESC, entity_id ASC
     LIMIT 30`,
    params,
  );
  let trigram: Row[] = [];
  if (await hasExtension(sql, "pg_trgm")) {
    trigram = (await sql.query<Row>(
      `SELECT doc_type, entity_id, site_id, broker_id, title, body
       FROM search_docs
       WHERE ${where}
         AND (
           title % $1::text OR entity_id % $1::text OR site_id % $1::text OR body % $1::text
           OR title ILIKE $${params.length + 1}::text ESCAPE '\\'
           OR entity_id ILIKE $${params.length + 1}::text ESCAPE '\\'
           OR site_id ILIKE $${params.length + 1}::text ESCAPE '\\'
         )
       ORDER BY GREATEST(similarity(title, $1::text), similarity(entity_id, $1::text), similarity(site_id, $1::text)) DESC, entity_id ASC
       LIMIT 30`,
      [...params, likePattern(query)],
    )).rows;
  } else {
    trigram = (await sql.query<Row>(
      `SELECT doc_type, entity_id, site_id, broker_id, title, body
       FROM search_docs
       WHERE ${where}
         AND (
           title ILIKE $${params.length + 1}::text ESCAPE '\\'
           OR entity_id ILIKE $${params.length + 1}::text ESCAPE '\\'
           OR site_id ILIKE $${params.length + 1}::text ESCAPE '\\'
           OR body ILIKE $${params.length + 1}::text ESCAPE '\\'
           OR $1::text = $1::text
         )
       ORDER BY entity_id ASC
       LIMIT 30`,
      [...params, likePattern(query)],
    )).rows;
  }
  let vector: Row[] = [];
  if (input.embedding?.length === 1536 && await hasEmbedding(sql)) {
    try {
      const literal = `[${input.embedding.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
      vector = (await sql.query<Row>(
        `SELECT doc_type, entity_id, site_id, broker_id, title, body
         FROM search_docs
         WHERE ${where} AND embedding IS NOT NULL
         ORDER BY embedding <=> $${params.length + 1}::halfvec
         LIMIT 30`,
        [...params, literal],
      )).rows;
    } catch (error) {
      console.error(JSON.stringify({ event: "search_vector_skipped", name: error instanceof Error ? error.name : "error" }));
    }
  }
  const byId = new Map<string, Row>();
  for (const row of [...fts.rows, ...trigram, ...vector]) byId.set(rowId(row), row);
  const fused = withExactWins(
    reciprocalRankFusion([fts.rows.map(rowId), vector.map(rowId), trigram.map(rowId)]),
    [...byId.entries()].filter(([, row]) => isExact(query, row)).map(([id]) => id),
  );
  const hits: SearchHit[] = [];
  for (const ranked of fused) {
    const row = byId.get(ranked.id);
    if (!row || isExcludedSite(row.site_id) || isExcludedSite(row.entity_id)) continue;
    const url = resultUrl(row.doc_type, row.entity_id, row.site_id);
    if (!url) continue;
    hits.push({
      id: ranked.id,
      docType: row.doc_type,
      entityId: row.entity_id,
      siteId: row.site_id,
      brokerId: row.broker_id,
      title: row.title,
      group: GROUPS[row.doc_type] || "other",
      url,
      path: appPath(url),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function groupHits(hits: SearchHit[]) {
  return {
    sites: hits.filter((hit) => hit.group === "sites"),
    brokers: hits.filter((hit) => hit.group === "brokers"),
    conversations: hits.filter((hit) => hit.group === "conversations"),
  };
}

export function gridIds(hits: SearchHit[]): string[] {
  const ids = new Set<string>();
  for (const hit of hits) {
    if (hit.siteId) ids.add(hit.siteId);
    if (hit.docType === "site") ids.add(hit.entityId);
  }
  return [...ids];
}

export async function searchReady(sql: Sql): Promise<boolean> {
  try {
    const rows = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM search_docs`);
    return Number(rows.rows[0]?.n || 0) > 0;
  } catch {
    return false;
  }
}
