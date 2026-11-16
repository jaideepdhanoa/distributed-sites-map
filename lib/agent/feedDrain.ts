import type { Sql } from "@/lib/actions/db";
import { countUnprocessedEvents, syncEventFeed } from "@/lib/agent/eventFeed";
import { isProductionDatabase } from "@/lib/changes/guard";

export const DRAIN_AGENT_FEED_CONFIRM = "drain-agent-feed";

/** Actors on the rows inserted 2026-11-16 19:00:37–48Z. */
export const FLOOD_ACTORS = ["workbook-sync", "muse", "indie", "workbook-mirror", "jaideep"] as const;

/** Inclusive start of that stamp. */
export const FLOOD_FROM = "2026-11-16T19:00:37.000Z";

/** Exclusive end, so 19:00:48.999Z is inside and 19:00:49Z is not. */
export const FLOOD_UNTIL = "2026-11-16T19:00:49.000Z";

const FLOOD_WHERE = `
  i.idempotency_key LIKE 'event:%'
  AND split_part(i.idempotency_key, ':', 3) <> 'skip'
  AND i.actor = ANY($1::text[])
  AND i.created_at >= $2::timestamptz
  AND i.created_at < $3::timestamptz
`;

export type FeedDrainPlan = {
  mode: "dry-run" | "apply";
  unprocessed: number;
  unprocessedAfter: number;
  floodRows: number;
  timestampsToReset: number;
  timestampsReset: number;
  scanned: number;
  projected: number;
};

function floodParams(): unknown[] {
  return [[...FLOOD_ACTORS], FLOOD_FROM, FLOOD_UNTIL];
}

export function formatFeedDrain(plan: FeedDrainPlan): string {
  return JSON.stringify({
    mode: plan.mode,
    unprocessed: plan.unprocessed,
    unprocessed_after: plan.unprocessedAfter,
    flood_rows: plan.floodRows,
    timestamps_to_reset: plan.timestampsToReset,
    timestamps_reset: plan.timestampsReset,
    scanned: plan.scanned,
    projected: plan.projected,
  });
}

export async function countFloodRows(sql: Sql): Promise<{ floodRows: number; toReset: number }> {
  const rows = await sql.query<{ flood_rows: string; to_reset: string }>(
    `SELECT count(*)::text AS flood_rows,
            count(*) FILTER (WHERE i.created_at IS DISTINCT FROM e.created_at)::text AS to_reset
     FROM agent_inbox i
     JOIN events e ON e.id = split_part(i.idempotency_key, ':', 2)
     WHERE ${FLOOD_WHERE}`,
    floodParams(),
  );
  return {
    floodRows: Number(rows.rows[0]?.flood_rows || 0),
    toReset: Number(rows.rows[0]?.to_reset || 0),
  };
}

export async function resetFloodTimestamps(sql: Sql): Promise<number> {
  const updated = await sql.query<{ id: string }>(
    `UPDATE agent_inbox AS i
     SET created_at = e.created_at
     FROM events AS e
     WHERE e.id = split_part(i.idempotency_key, ':', 2)
       AND i.created_at IS DISTINCT FROM e.created_at
       AND ${FLOOD_WHERE}
     RETURNING i.id`,
    floodParams(),
  );
  return updated.rows.length;
}

/**
 * Dry run counts and writes nothing. Apply resets flood timestamps, then
 * projects until no unprocessed event remains. Skip markers are not feed rows.
 */
export async function runFeedDrain(
  sql: Sql,
  input: { apply: boolean; confirm?: string },
): Promise<FeedDrainPlan> {
  if (input.apply && (input.confirm || "").trim() !== DRAIN_AGENT_FEED_CONFIRM) {
    throw new Error("Refusing to drain the agent feed. Dry run is the default. Set CONFIRM=drain-agent-feed to apply.");
  }
  const unprocessed = await countUnprocessedEvents(sql);
  const flood = await countFloodRows(sql);
  if (!input.apply) {
    return {
      mode: "dry-run",
      unprocessed,
      unprocessedAfter: unprocessed,
      floodRows: flood.floodRows,
      timestampsToReset: flood.toReset,
      timestampsReset: 0,
      scanned: 0,
      projected: 0,
    };
  }
  const timestampsReset = await resetFloodTimestamps(sql);
  let scanned = 0;
  let projected = 0;
  let remaining = await countUnprocessedEvents(sql);
  let guard = 0;
  while (remaining > 0) {
    const batch = await syncEventFeed(sql);
    guard += 1;
    scanned += batch.scanned;
    projected += batch.projected;
    if (batch.scanned === 0 || guard > 10000) {
      throw new Error("Feed drain stopped before the backlog was empty.");
    }
    const next = await countUnprocessedEvents(sql);
    if (next >= remaining) throw new Error("Feed drain made no progress.");
    remaining = next;
  }
  return {
    mode: "apply",
    unprocessed,
    unprocessedAfter: remaining,
    floodRows: flood.floodRows,
    timestampsToReset: flood.toReset,
    timestampsReset,
    scanned,
    projected,
  };
}

/** Preview, CI, and an unconfirmed production write are refused. A dry run does not call this. */
export function assertFeedDrainApply(url: string, confirm: string | undefined): void {
  if ((confirm || "").trim() !== DRAIN_AGENT_FEED_CONFIRM) {
    throw new Error("Refusing to drain the agent feed. Dry run is the default. Set CONFIRM=drain-agent-feed to apply.");
  }
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to drain the agent feed from Vercel. Previews share the production database.");
  }
  const ci = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && process.env.ALLOW_DRAIN_AGENT_FEED === "1"
    && process.env.GITHUB_REF === "refs/heads/main";
  if (ci && !manual) {
    throw new Error("Refusing to drain the agent feed from CI. Run the workflow by hand on main with the confirm phrase.");
  }
  if (isProductionDatabase(url) && process.env.ALLOW_DRAIN_AGENT_FEED !== "1") {
    throw new Error("Refusing to drain the agent feed on the production database. Set ALLOW_DRAIN_AGENT_FEED=1 only after the dry-run counts are approved.");
  }
}
