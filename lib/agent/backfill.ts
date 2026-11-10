import type { Sql } from "@/lib/actions/db";
import { fileLookup, type RecordLookup } from "@/lib/actions/records";
import { permanentSiteId } from "@/lib/actions/suggestions";
import {
  decisionFeed,
  feedKey,
  flagFeed,
  insertFeedRow,
  mentionFeed,
  noteFeed,
  noteThreadContext,
  proposalEventFeed,
  suggestionFeed,
  type FeedInsert,
} from "@/lib/agent/inbox";

export type BackfillCount = { kind: string; actor: string; count: number };

export type BackfillReport = {
  dryRun: boolean;
  planned: number;
  inserted: number;
  alreadyPresent: number;
  superseded: number;
  byKind: Record<string, number>;
  byActor: Record<string, number>;
  counts: BackfillCount[];
};

type NoteRow = {
  id: string;
  target_kind: string;
  target_id: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  created_at: Date | string;
};

type SuggestionRow = {
  id: string;
  target_kind: "site" | "deal";
  target_id: string;
  field_name: string;
  detail: string | null;
  proposed_value: string;
  reason: string;
  status: string;
  author_id: string;
  title: string | null;
  created_at: Date | string;
  decided_by: string | null;
  decided_at: Date | string | null;
  decision_note: string | null;
};

type FlagRow = {
  id: string;
  site_id: string;
  from_user: string;
  to_user: string;
  note: string;
  created_at: Date | string;
};

function isoTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

function tally(events: FeedInsert[]): Pick<BackfillReport, "byKind" | "byActor" | "counts"> {
  const byKind: Record<string, number> = {};
  const byActor: Record<string, number> = {};
  const cross = new Map<string, number>();
  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] || 0) + 1;
    byActor[event.actor] = (byActor[event.actor] || 0) + 1;
    const key = `${event.kind}\0${event.actor}`;
    cross.set(key, (cross.get(key) || 0) + 1);
  }
  const counts = [...cross.entries()]
    .map(([key, count]) => {
      const [kind, actor] = key.split("\0");
      return { kind, actor, count };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.actor.localeCompare(b.actor));
  return { byKind, byActor, counts };
}

async function place(
  sql: Sql,
  lookup: RecordLookup,
  kind: string,
  id: string,
): Promise<{ siteId: string; recordId: string }> {
  if (kind === "suggestion") {
    const found = await sql.query<{ target_kind: "site" | "deal"; target_id: string }>(
      `SELECT target_kind, target_id FROM suggestions WHERE id = $1`,
      [id],
    );
    const row = found.rows[0];
    if (!row) return { siteId: id, recordId: id };
    return { siteId: permanentSiteId(row.target_kind, row.target_id, lookup), recordId: id };
  }
  if (kind === "site" || kind === "deal") {
    return { siteId: permanentSiteId(kind, id, lookup), recordId: id };
  }
  return { siteId: id, recordId: id };
}

function decisionStatus(status: string): "accepted" | "rejected" | "agreed_waiting" | null {
  if (status === "rejected") return "rejected";
  if (status === "accepted" || status === "applied") return "accepted";
  if (status === "agreed_waiting") return "agreed_waiting";
  return null;
}

function later(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time + 1000).toISOString();
}

/** Feed rows the live ingest would have written for notes, mentions, flags, proposals, and decisions. */
export async function planInboxBackfill(sql: Sql, lookup: RecordLookup = fileLookup()): Promise<FeedInsert[]> {
  const notes = await sql.query<NoteRow>(
    `SELECT id, target_kind, target_id, parent_id, body, author_id, created_at
     FROM notes ORDER BY created_at ASC, id ASC`,
  );
  const mentionRows = await sql.query<{ source_id: string }>(
    `SELECT DISTINCT source_id FROM mentions WHERE source_kind = 'note'`,
  );
  const mentioned = new Set(mentionRows.rows.map((row) => row.source_id));
  const suggestions = await sql.query<SuggestionRow>(
    `SELECT id, target_kind, target_id, field_name, detail, proposed_value, reason, status, author_id,
            title, created_at, decided_by, decided_at, decision_note
     FROM suggestions ORDER BY created_at ASC, id ASC`,
  );
  const flags = await sql.query<FlagRow>(
    `SELECT id, site_id, from_user, to_user, note, created_at FROM queue_flags ORDER BY created_at ASC, id ASC`,
  );

  const events: FeedInsert[] = [];
  for (const note of notes.rows) {
    if (!note.author_id) continue;
    const where = await place(sql, lookup, note.target_kind, note.target_id);
    const createdAt = isoTime(note.created_at);
    const payload = noteFeed({
      noteId: note.id,
      siteId: where.siteId,
      recordId: where.recordId,
      body: note.body,
      authorId: note.author_id,
      parentId: note.parent_id,
      context: await noteThreadContext(sql, note.parent_id),
      createdAt,
    });
    events.push(payload);
    if (mentioned.has(note.id)) events.push(mentionFeed(payload));
  }
  for (const row of suggestions.rows) {
    if (!row.author_id) continue;
    const siteId = permanentSiteId(row.target_kind, row.target_id, lookup);
    events.push(suggestionFeed({
      id: row.id,
      siteId,
      recordId: row.target_id,
      authorId: row.author_id,
      field: row.field_name,
      detail: row.detail,
      title: row.title,
      proposedValue: row.proposed_value,
      reason: row.reason,
      status: "open",
      stored: true,
      createdAt: isoTime(row.created_at),
    }));
    const actor = (row.decided_by || "").trim();
    const when = isoTime(row.decided_at) || isoTime(row.created_at);
    const status = decisionStatus(row.status);
    if (status && actor) {
      events.push(decisionFeed({
        id: row.id,
        refId: status === "agreed_waiting" ? `${row.id}:waiting` : row.id,
        status,
        actorId: actor,
        note: row.decision_note || "",
        siteId,
        recordId: row.target_id,
        field: row.field_name,
        detail: row.detail,
        title: row.title,
        proposedValue: row.proposed_value,
        reason: row.reason,
        createdAt: when,
      }));
    }
    if (row.status === "ready" || row.status === "overtaken") {
      events.push(proposalEventFeed({
        kind: row.status === "ready" ? "proposal_ready" : "proposal_overtaken",
        id: row.id,
        actorId: row.status === "ready" ? "system" : (actor || row.author_id),
        note: row.decision_note || "",
        siteId,
        recordId: row.target_id,
        field: row.field_name,
        detail: row.detail,
        title: row.title,
        proposedValue: row.proposed_value,
        reason: row.reason,
        createdAt: row.status === "ready" ? later(when) : when,
      }));
    }
  }
  for (const flag of flags.rows) {
    if (!flag.from_user || !flag.site_id) continue;
    events.push(flagFeed({
      id: flag.id,
      siteId: flag.site_id,
      fromUser: flag.from_user,
      toUser: flag.to_user,
      note: flag.note,
      createdAt: isoTime(flag.created_at),
    }));
  }
  events.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || feedKey(a.kind, a.refId).localeCompare(feedKey(b.kind, b.refId)));
  return events;
}

/** Newer rows on a thread supersede older new or picked rows, the same way a live ingest would. */
export async function reconcileInboxThreads(sql: Sql): Promise<number> {
  const saved = await sql.query<{ id: string }>(
    `WITH keep AS (
      SELECT row.id
      FROM agent_inbox row
      JOIN (
        SELECT thread_key, MAX(created_at) AS created_at
        FROM agent_inbox
        GROUP BY thread_key
      ) latest ON latest.thread_key = row.thread_key AND latest.created_at = row.created_at
      WHERE row.kind IN ('proposal_ready', 'proposal_overtaken')
         OR (
           row.kind = 'decision'
           AND NOT EXISTS (
             SELECT 1 FROM agent_inbox ready
             WHERE ready.thread_key = row.thread_key
               AND ready.created_at = row.created_at
               AND ready.kind IN ('proposal_ready', 'proposal_overtaken')
           )
         )
         OR NOT EXISTS (
           SELECT 1 FROM agent_inbox other
           WHERE other.thread_key = row.thread_key
             AND other.created_at = row.created_at
             AND other.kind IN ('decision', 'proposal_ready', 'proposal_overtaken')
         )
    )
    UPDATE agent_inbox SET status = 'superseded'
    WHERE status IN ('new', 'picked')
      AND NOT EXISTS (SELECT 1 FROM keep WHERE keep.id = agent_inbox.id)
    RETURNING id`,
  );
  return saved.rows.length;
}

export async function backfillInbox(
  sql: Sql,
  options: { dryRun: boolean; lookup?: RecordLookup },
): Promise<BackfillReport> {
  const planned = await planInboxBackfill(sql, options.lookup);
  const existing = await sql.query<{ idempotency_key: string }>(`SELECT idempotency_key FROM agent_inbox`);
  const have = new Set(existing.rows.map((row) => row.idempotency_key));
  const missing = planned.filter((event) => !have.has(feedKey(event.kind, event.refId)));
  if (options.dryRun) {
    return {
      dryRun: true,
      planned: missing.length,
      inserted: 0,
      alreadyPresent: planned.length - missing.length,
      superseded: 0,
      ...tally(missing),
    };
  }
  const inserted: FeedInsert[] = [];
  for (const event of missing) {
    const id = await insertFeedRow(sql, event);
    if (id) inserted.push(event);
  }
  const superseded = await reconcileInboxThreads(sql);
  return {
    dryRun: false,
    planned: missing.length,
    inserted: inserted.length,
    alreadyPresent: planned.length - missing.length,
    superseded,
    ...tally(inserted),
  };
}
