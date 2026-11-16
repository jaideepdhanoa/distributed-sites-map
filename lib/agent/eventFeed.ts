import type { Sql } from "@/lib/actions/db";
import { EVENT_FEED_LIMIT, eventSkipKey } from "@/lib/agent/feedKeys";
import { isExcludedSite } from "@/lib/alerts/excluded";
import { CHECK_FIELDS, PHOTO_FIELDS, SCHEMA_FIELDS } from "@/lib/changes/site";
import { insertFeedRow, type FeedInsert } from "@/lib/agent/inbox";

const DISTANCE_FIELDS = new Set(["miles_to_depot", "service_area_distance_mi"]);
const FAILING = new Set(["fail", "failed", "no", "missing", "blocked"]);

export type FeedRoute = {
  audience: "muse" | "indie";
  kind: "data_change" | "check_failed";
  text: string;
  after: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function changedKeys(previous: Record<string, unknown> | null, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next)]);
  const out: string[] = [];
  for (const key of keys) {
    const before = previous ? String(previous[key] ?? "") : "";
    const after = String(next[key] ?? "");
    if (before !== after && after) out.push(key);
  }
  return out;
}

function names(keys: string[], allowed: Set<string>): string {
  return keys.filter((key) => allowed.has(key)).sort().join(", ");
}

export function routesForEvent(input: {
  entityType: string;
  source: string;
  actor: string;
  payload: Record<string, unknown>;
  changed?: string[];
}): FeedRoute[] {
  const source = `${input.source} ${input.actor}`;
  const keys = input.changed || Object.keys(input.payload);
  const routes: FeedRoute[] = [];
  if (input.entityType === "comms") routes.push({ audience: "muse", kind: "data_change", text: "Comms recorded.", after: "direction" });
  if (input.entityType === "activity" && input.payload.type === "capture") {
    routes.push({ audience: "muse", kind: "data_change", text: "Capture recorded.", after: "capture" });
  }
  if (input.entityType === "activity" && input.payload.type === "photos") {
    routes.push({ audience: "indie", kind: "data_change", text: "Photo updated.", after: "photos" });
  }
  if (/mirror/i.test(source)) routes.push({ audience: "indie", kind: "data_change", text: "Mirror updated.", after: "mirror" });
  const schema = names(keys, new Set(SCHEMA_FIELDS));
  const photos = names(keys, new Set(PHOTO_FIELDS));
  const distance = names(keys, DISTANCE_FIELDS);
  const checks = keys.filter((key) => (CHECK_FIELDS as readonly string[]).includes(key));
  const failed = checks.filter((key) => FAILING.has(String(input.payload[key] || "").trim().toLowerCase()));
  if (schema) routes.push({ audience: "indie", kind: "data_change", text: "Schema updated.", after: schema });
  if (photos) routes.push({ audience: "indie", kind: "data_change", text: "Photo updated.", after: photos });
  if (distance) routes.push({ audience: "muse", kind: "data_change", text: "Distance updated.", after: distance });
  if (failed.length) routes.push({ audience: "indie", kind: "check_failed", text: "A check failed.", after: failed.sort().join(", ") });
  if (!routes.length && input.entityType === "stage") {
    routes.push({ audience: "indie", kind: "data_change", text: "Stage updated.", after: "stage" });
  }
  if (!routes.length && input.entityType === "site") {
    routes.push({ audience: "indie", kind: "data_change", text: "Site updated.", after: "site" });
  }
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.audience}:${route.kind}:${route.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function brokerMatchFeed(siteId: string): FeedInsert {
  return {
    kind: "broker_match",
    refId: `pending:${siteId}`,
    siteId,
    actor: "system",
    text: "Broker matching is not available yet.",
    threadKey: `broker:${siteId}`,
    audience: "muse",
  };
}

const UNPROCESSED_EVENT = `NOT EXISTS (
  SELECT 1 FROM agent_inbox i
  WHERE split_part(i.idempotency_key, ':', 1) = 'event'
    AND split_part(i.idempotency_key, ':', 2) = e.id
)`;

export type FeedSyncBatch = { scanned: number; projected: number };

type FeedEvent = {
  id: string;
  entity_type: string;
  entity_id: string;
  site_id: string;
  payload: unknown;
  source: string;
  actor: string;
  run_id: string | null;
  created_at: Date | string;
};

function eventCreatedAt(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Event created_at is not a time.");
  return date.toISOString();
}

function skipSiteId(event: { site_id: string; entity_id: string }): string {
  if (isExcludedSite(event.site_id) || isExcludedSite(event.entity_id)) return "portfolio";
  return event.site_id || event.entity_id || "portfolio";
}

async function markEventSkipped(sql: Sql, event: FeedEvent, createdAt: string): Promise<void> {
  const siteId = skipSiteId(event);
  await insertFeedRow(sql, {
    kind: "data_change",
    subtype: "skip",
    refId: event.id,
    siteId,
    recordId: siteId,
    actor: "system",
    text: "No feed route.",
    threadKey: `event:${event.id}`,
    audience: "muse",
    createdAt,
    idempotencyKey: eventSkipKey(event.id),
  });
}

export async function countUnprocessedEvents(sql: Sql): Promise<number> {
  const rows = await sql.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM events e WHERE ${UNPROCESSED_EVENT}`,
  );
  return Number(rows.rows[0]?.n || 0);
}

/**
 * Project one page of events that have no feed key yet.
 * Rows keep the event's created_at. An event with no route, and the quarantined
 * site, get a skip key so they leave this window. A feed read does not call this.
 */
export async function syncEventFeed(sql: Sql, limit = EVENT_FEED_LIMIT): Promise<FeedSyncBatch> {
  const size = Math.max(1, Math.min(EVENT_FEED_LIMIT, Math.floor(limit) || EVENT_FEED_LIMIT));
  const events = await sql.query<FeedEvent>(
    `SELECT id, entity_type, entity_id, site_id, payload, source, actor, run_id, created_at
     FROM events e
     WHERE ${UNPROCESSED_EVENT}
     ORDER BY created_at ASC, id ASC
     LIMIT $1`,
    [size],
  );
  let projected = 0;
  for (const event of events.rows) {
    const createdAt = eventCreatedAt(event.created_at);
    if (isExcludedSite(event.site_id) || isExcludedSite(event.entity_id)) {
      await markEventSkipped(sql, event, createdAt);
      continue;
    }
    const payload = asObject(event.payload);
    const prior = await sql.query<{ payload: unknown }>(
      `SELECT payload FROM events
       WHERE entity_type = $1 AND entity_id = $2 AND id <> $3 AND created_at <= $4
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [event.entity_type, event.entity_id, event.id, event.created_at],
    );
    const routes = routesForEvent({
      entityType: event.entity_type,
      source: event.source,
      actor: event.actor,
      payload,
      changed: changedKeys(prior.rows[0] ? asObject(prior.rows[0].payload) : null, payload),
    });
    if (!routes.length) {
      await markEventSkipped(sql, event, createdAt);
      continue;
    }
    for (const route of routes) {
      const key = route.kind === "check_failed" ? `event:${event.id}:indie:check` : `event:${event.id}:${route.audience}`;
      const saved = await insertFeedRow(sql, {
        kind: route.kind,
        subtype: event.entity_type,
        refId: event.entity_id,
        siteId: event.site_id || event.entity_id,
        actor: event.actor,
        text: route.text,
        threadKey: `event:${event.id}`,
        audience: route.audience,
        before: "",
        after: route.after,
        runId: event.run_id || "",
        idempotencyKey: key,
        createdAt,
      });
      if (saved) projected += 1;
    }
  }
  return { scanned: events.rows.length, projected };
}

const STALE_DAYS = 14;

export async function sweepStale(sql: Sql, now = new Date()): Promise<number> {
  const rows = await sql.query<{ site_id: string }>(
    `SELECT site_id FROM (
       SELECT site_id, updated_at AS touched FROM sites
       UNION ALL
       SELECT site_id, updated_at FROM site_stages
     ) s
     GROUP BY site_id
     HAVING max(touched) < $1::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.site_id = s.site_id AND e.created_at > $1::timestamptz
        )`,
    [new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()],
  );
  const day = now.toISOString().slice(0, 10);
  let wrote = 0;
  for (const row of rows.rows) {
    if (isExcludedSite(row.site_id)) continue;
    const saved = await insertFeedRow(sql, {
      kind: "stale",
      refId: `${row.site_id}:${day}`,
      siteId: row.site_id,
      actor: "system",
      text: "No change recorded in 14 days.",
      threadKey: `stale:${row.site_id}:${day}`,
      audience: "both",
      idempotencyKey: `stale:${row.site_id}:${day}`,
    });
    if (saved) wrote += 1;
  }
  return wrote;
}
