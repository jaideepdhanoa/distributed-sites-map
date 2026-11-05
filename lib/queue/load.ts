import { randomUUID } from "node:crypto";
import { assertClean, safeSnapshot } from "@/lib/policy/banned";
import type { Sql } from "@/lib/actions/db";
import { clearMentionsForSite, openMentions } from "@/lib/actions/mentions";
import { permanentSiteId } from "@/lib/actions/suggestions";
import { InputError, parseDate, stamp } from "@/lib/actions/text";
import { getUsers } from "@/lib/users";
import { loadCatalog, readBuildEvents } from "./catalog";
import { listAppEvents } from "./events";
import { buildQueue, type QueueFilters, type QueueReason } from "./order";
import { pacificToday } from "./today";

export function pacificDay(now = new Date()): string {
  return pacificToday(now);
}

export async function markReviewed(sql: Sql, userId: string, siteId: string): Promise<void> {
  await sql.query(
    `INSERT INTO queue_reviews (user_id, site_id, reviewed_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id, site_id) DO UPDATE SET reviewed_at = now()`,
    [userId, siteId],
  );
  await sql.query(
    `UPDATE queue_flags SET cleared_at = now() WHERE to_user = $1 AND site_id = $2 AND cleared_at IS NULL`,
    [userId, siteId],
  );
  await clearMentionsForSite(sql, userId, siteId);
}

export async function markAllReviewed(sql: Sql, userId: string, siteIds: string[]): Promise<number> {
  let count = 0;
  for (const siteId of siteIds) {
    await markReviewed(sql, userId, siteId);
    count += 1;
  }
  return count;
}

export async function snoozeSite(sql: Sql, userId: string, siteId: string, until: string): Promise<void> {
  const day = parseDate(until);
  if (!day) throw new InputError("Choose a date.");
  await sql.query(
    `INSERT INTO queue_snoozes (user_id, site_id, until_date) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, site_id) DO UPDATE SET until_date = EXCLUDED.until_date`,
    [userId, siteId, day],
  );
}

export async function flagSite(sql: Sql, input: { fromUser: string; toUser: string; siteId: string; note: string }): Promise<void> {
  const toUser = input.toUser.trim().toLowerCase();
  if (!getUsers().some((user) => user.u === toUser)) throw new InputError("Choose an account from the list.");
  const note = input.note.trim() ? safeSnapshot(input.note, 200) : "";
  if (input.note.trim() && !note) throw new InputError("That text is not allowed on the map. Rephrase it and try again.");
  if (note) assertClean(note);
  await sql.query(
    `INSERT INTO queue_flags (id, site_id, from_user, to_user, note) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), input.siteId, input.fromUser, toUser, note],
  );
}

export async function setFollow(sql: Sql, userId: string, siteId: string, follow: boolean): Promise<void> {
  if (follow) {
    await sql.query(
      `INSERT INTO queue_follows (user_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, siteId],
    );
    return;
  }
  await sql.query(`DELETE FROM queue_follows WHERE user_id = $1 AND site_id = $2`, [userId, siteId]);
}

function dayOf(value: Date | string | null): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

export async function loadQueue(sql: Sql, userId: string, filters: QueueFilters, reviewer: boolean) {
  const catalog = loadCatalog();
  const reviews = await sql.query<{ site_id: string; reviewed_at: Date | string }>(
    `SELECT site_id, reviewed_at FROM queue_reviews WHERE user_id = $1`,
    [userId],
  );
  const snoozes = await sql.query<{ site_id: string; until_date: Date | string }>(
    `SELECT site_id, until_date FROM queue_snoozes WHERE user_id = $1`,
    [userId],
  );
  const flags = await sql.query<{ site_id: string; note: string }>(
    `SELECT site_id, note FROM queue_flags WHERE to_user = $1 AND cleared_at IS NULL`,
    [userId],
  );
  const follows = await sql.query<{ site_id: string }>(
    `SELECT site_id FROM queue_follows WHERE user_id = $1`,
    [userId],
  );
  const mentionRows = await openMentions(sql, userId);
  const assignmentRows = await sql.query<{
    id: string;
    target_kind: "site" | "deal";
    target_id: string;
    title: string | null;
    proposed_value: string;
    target_on: Date | string | null;
    status: string;
  }>(
    `SELECT id, target_kind, target_id, title, proposed_value, target_on, status
     FROM suggestions
     WHERE field_name = 'proposed_next_step' AND owner_id = $1 AND status IN ('open', 'accepted') AND done_at IS NULL
     ORDER BY target_on ASC, created_at ASC`,
    [userId],
  );
  const openSteps = reviewer
    ? await sql.query<{ target_kind: "site" | "deal"; target_id: string }>(
      `SELECT target_kind, target_id FROM suggestions WHERE field_name = 'proposed_next_step' AND status = 'open'`,
      [],
    )
    : { rows: [] as { target_kind: "site" | "deal"; target_id: string }[] };
  const accepted = await sql.query<{ target_kind: "site" | "deal"; target_id: string; title: string | null; proposed_value: string; target_on: Date | string | null; decided_at: Date | string | null }>(
    `SELECT target_kind, target_id, title, proposed_value, target_on, decided_at
     FROM suggestions WHERE field_name = 'proposed_next_step' AND status = 'accepted'
     ORDER BY decided_at DESC`,
  );
  const threads = await sql.query<{ target_id: string; count: string }>(
    `SELECT target_id, COUNT(*)::text AS count FROM notes
     WHERE parent_id IS NULL AND deleted_at IS NULL AND resolved_at IS NULL AND target_kind = 'deal'
     GROUP BY target_id`,
  );
  const reviewedAt: Record<string, string> = {};
  for (const row of reviews.rows) reviewedAt[row.site_id] = stamp(row.reviewed_at);
  const snoozeUntil: Record<string, string> = {};
  for (const row of snoozes.rows) snoozeUntil[row.site_id] = dayOf(row.until_date);
  const flagged = new Set(flags.rows.map((row) => row.site_id));
  const mentioned = new Set(mentionRows.map((row) => row.siteId));
  const followed = new Set(follows.rows.map((row) => row.site_id));
  const assignments = new Map<string, { id: string; title: string; date: string; status: string }[]>();
  for (const row of assignmentRows.rows) {
    const siteId = permanentSiteId(row.target_kind, row.target_id);
    const title = safeSnapshot(row.title || row.proposed_value, 120);
    if (!title) continue;
    const list = assignments.get(siteId) || [];
    list.push({ id: row.id, title, date: dayOf(row.target_on), status: row.status === "accepted" ? "approved" : "open" });
    assignments.set(siteId, list);
  }
  const assigned = new Set(assignments.keys());
  const needsApproval = new Set(openSteps.rows.map((row) => permanentSiteId(row.target_kind, row.target_id)));
  const reasons: Record<string, QueueReason[]> = {};
  const push = (siteId: string, reason: QueueReason) => {
    if (!siteId) return;
    reasons[siteId] = reasons[siteId] || [];
    reasons[siteId].push(reason);
  };
  for (const event of readBuildEvents()) {
    push(event.siteId, { at: event.at, summary: event.summary, type: event.type });
  }
  for (const event of await listAppEvents(sql)) {
    push(event.siteId, { at: event.at, summary: event.summary, type: event.type });
  }
  for (const row of flags.rows) {
    const note = safeSnapshot(row.note, 200);
    push(row.site_id, { at: pacificDay(), summary: note ? `Flagged for you. ${note}` : "Flagged for you.", type: "flag" });
  }
  for (const row of mentionRows) {
    push(row.siteId, { at: stamp(row.at), summary: "Mentioned you.", type: "mention" });
  }
  const nextStep = new Map<string, { title: string; date: string }>();
  for (const row of accepted.rows) {
    const siteId = permanentSiteId(row.target_kind, row.target_id);
    if (nextStep.has(siteId)) continue;
    const title = safeSnapshot(row.title || row.proposed_value, 120);
    if (title) nextStep.set(siteId, { title, date: dayOf(row.target_on) });
  }
  const openThreads = new Map(threads.rows.map((row) => [row.target_id, Number(row.count)]));
  const firstTime = reviews.rows.length === 0;
  const items = buildQueue({
    sites: catalog.map((site) => ({
      id: site.id,
      city: site.city,
      stage: site.stage,
      stageGroup: site.stageGroup,
      active: site.active,
    })),
    reasons,
    reviewedAt,
    snoozeUntil,
    flagged,
    mentioned,
    assigned,
    needsApproval,
    today: pacificDay(),
    filters,
  }).map((row) => {
    const site = catalog.find((item) => item.id === row.siteId);
    return {
      ...row,
      followed: followed.has(row.siteId),
      snapshot: site ? {
        name: site.name,
        address: site.address,
        city: site.city,
        stage: site.stage,
        verdict: site.verdict,
        askingPrice: site.askingPrice,
        askingSource: site.askingSource,
        leadSource: site.leadSource,
        activity: site.activity,
        materials: site.materials,
        folderUrl: site.folderUrl,
        openThreads: openThreads.get(row.siteId) || 0,
        nextStep: nextStep.get(row.siteId) || null,
        assignments: assignments.get(row.siteId) || [],
        lng: site.lng,
        lat: site.lat,
      } : null,
    };
  });
  return { firstTime, items };
}
