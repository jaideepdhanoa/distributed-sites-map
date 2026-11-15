import type { Sql } from "@/lib/actions/db";
import { loadCatalog } from "@/lib/queue/catalog";
import { publicSnippet } from "./compose";
import type { MailItem } from "./compose";
import { EXCLUDED_SITE_ID, isExcludedSite } from "./excluded";
import { discussionHref, proposalHref, reviewHomeHref, siteHref } from "./links";
import type { AlertCategory, AlertPreferences } from "./preferences";

export const CATCHUP_SINCE = "2026-11-09T00:00:00.000Z";
export const CATCHUP_SUBJECT = "Distributed Sites catch-up · since Nov 9";
export const CATCHUP_EMAIL = "jaideep@dhanoa.in";
export const CATCHUP_KEY = "catchup:jaideep:since-2026-11-09";

const LIST_LIMIT = 25;

export type SummaryCounts = {
  recommendations: number;
  proposals: number;
  decisions: number;
  stages: number;
  activity: number;
  comms: number;
  sites: number;
};

export type SummaryResult = { items: MailItem[]; counts: SummaryCounts };

export function emptyCounts(): SummaryCounts {
  return { recommendations: 0, proposals: 0, decisions: 0, stages: 0, activity: 0, comms: 0, sites: 0 };
}

export function emptyBrief(): SummaryResult {
  return { items: [], counts: emptyCounts() };
}

type RecommendationRow = {
  id: string;
  kind: string;
  decision: string;
  draft_text: string;
  model: string;
  site_id: string;
  proposal_id: string | null;
};

type DecisionRow = {
  id: string;
  site_id: string;
  proposal_status: string | null;
  stage: string | null;
  actor: string;
};

type ProposalRow = {
  id: string;
  target_id: string;
  title: string | null;
  proposed_value: string;
  author_id: string;
};

type StageRow = {
  id: string;
  site_id: string;
  payload: unknown;
  actor: string;
};

type CountRow = {
  site_id: string;
  entity_type: string;
  count: number | string;
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

function kept(siteId: string): boolean {
  return Boolean(siteId) && !isExcludedSite(siteId);
}

function shown(prefs: AlertPreferences | null, key: AlertCategory): boolean {
  if (!prefs) return true;
  return prefs[key] !== "off";
}

function line(summary: string, userId: string): MailItem {
  return {
    category: "brief",
    siteId: "",
    siteLabel: "",
    summary,
    authorId: userId,
    href: reviewHomeHref(),
  };
}

function waiting(count: number, plural: string, singular: string): string {
  if (count <= 0) return `No ${plural} are waiting.`;
  if (count === 1) return `1 ${singular} is waiting.`;
  return `${count} ${plural} are waiting.`;
}

function overSpan(count: number, singular: string, plural: string, span: string): string {
  if (count <= 0) return `No ${plural} ${span}.`;
  if (count === 1) return `1 ${singular} ${span}.`;
  return `${count} ${plural} ${span}.`;
}

function agentActor(model: string): string {
  const id = model.trim().toLowerCase();
  return id === "indie" || id === "muse" ? id : "muse";
}

async function labels(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const site of await loadCatalog()) {
      if (isExcludedSite(site.id)) continue;
      const name = site.name?.trim();
      map.set(site.id, name && name !== site.id ? `${name} (${site.id})` : site.id);
    }
  } catch {
    // A missing catalog still leaves the site id on the line.
  }
  return map;
}

function siteLabel(map: Map<string, string>, siteId: string): string {
  return map.get(siteId) || siteId;
}

function cleanItems(items: MailItem[]): MailItem[] {
  return items.filter((item) => {
    const blob = `${item.siteId} ${item.siteLabel} ${item.href} ${item.summary}`.toUpperCase();
    return !blob.includes(EXCLUDED_SITE_ID);
  });
}

function recommendationItem(row: RecommendationRow, map: Map<string, string>): MailItem | null {
  if (!kept(row.site_id)) return null;
  const decision = row.kind === "decision";
  const proposal = !decision && Boolean(row.proposal_id);
  const snippet = publicSnippet(row.draft_text);
  const lead = decision ? "Decision request." : proposal ? "Proposal." : row.kind === "status_reply" ? "Status reply." : "Recommendation.";
  return {
    category: decision ? "decisions" : proposal ? "proposals" : "recommendations",
    siteId: row.site_id,
    siteLabel: siteLabel(map, row.site_id),
    summary: snippet ? `${lead} ${snippet}` : lead,
    authorId: agentActor(row.model),
    href: decision || proposal ? proposalHref(row.site_id) : discussionHref(row.site_id),
  };
}

async function activityItems(
  sql: Sql,
  since: string,
  map: Map<string, string>,
  userId: string,
  span: string,
): Promise<{ items: MailItem[]; activity: number; comms: number; sites: number }> {
  const rows = await sql.query<CountRow>(
    `SELECT site_id, entity_type, COUNT(*)::int AS count
     FROM events
     WHERE entity_type IN ('activity', 'comms')
       AND created_at >= $1
       AND btrim(site_id) <> ''
       AND upper(site_id) <> $2
     GROUP BY site_id, entity_type
     ORDER BY site_id ASC, entity_type ASC`,
    [since, EXCLUDED_SITE_ID],
  );
  const bySite = new Map<string, { activity: number; comms: number }>();
  let activity = 0;
  let comms = 0;
  for (const row of rows.rows) {
    if (!kept(row.site_id)) continue;
    const count = Number(row.count) || 0;
    const bucket = bySite.get(row.site_id) || { activity: 0, comms: 0 };
    if (row.entity_type === "comms") {
      bucket.comms += count;
      comms += count;
    } else {
      bucket.activity += count;
      activity += count;
    }
    bySite.set(row.site_id, bucket);
  }
  const sites = [...bySite.entries()];
  const items: MailItem[] = [];
  const noun = sites.length === 1 ? "site has" : "sites have";
  items.push(line(
    sites.length === 0
      ? `No new activity or comms ${span}.`
      : `${sites.length} ${noun} new activity or comms ${span}.`,
    userId,
  ));
  for (const [siteId, counts] of sites.slice(0, LIST_LIMIT)) {
    const parts: string[] = [];
    if (counts.activity === 1) parts.push("1 new activity record");
    else if (counts.activity > 1) parts.push(`${counts.activity} new activity records`);
    if (counts.comms === 1) parts.push("1 new comms record");
    else if (counts.comms > 1) parts.push(`${counts.comms} new comms records`);
    items.push({
      category: counts.activity > 0 ? "activity" : "comms",
      siteId,
      siteLabel: siteLabel(map, siteId),
      summary: `${parts.join(" and ")}.`,
      authorId: userId,
      href: siteHref(siteId),
    });
  }
  if (sites.length > LIST_LIMIT) {
    items.push(line(`${LIST_LIMIT} of ${sites.length} sites are listed.`, userId));
  }
  return { items, activity, comms, sites: sites.length };
}

export async function loadDigestBrief(
  sql: Sql,
  input: { userId: string; since: Date; prefs: AlertPreferences },
): Promise<SummaryResult> {
  const since = input.since.toISOString();
  const map = await labels();
  const items: MailItem[] = [];
  const counts = emptyCounts();
  const recommendationsOn = shown(input.prefs, "recommendations");
  const decisionsOn = shown(input.prefs, "decisions");
  if (recommendationsOn || decisionsOn) {
    const rows = await sql.query<RecommendationRow>(
      `SELECT r.id, r.kind, r.decision, r.draft_text, r.model, i.site_id, i.proposal_id
       FROM agent_recommendations r
       JOIN agent_inbox i ON i.id = r.inbox_id
       WHERE r.dismissed_at IS NULL
         AND r.used_at IS NULL
         AND i.status <> 'superseded'
         AND upper(i.site_id) <> $1
       ORDER BY r.created_at ASC, r.id ASC`,
      [EXCLUDED_SITE_ID],
    );
    const replies = rows.rows.filter((row) => row.kind !== "decision" && kept(row.site_id));
    const requests = rows.rows.filter((row) => row.kind === "decision" && kept(row.site_id));
    if (recommendationsOn) {
      counts.recommendations = replies.length;
      items.push(line(waiting(replies.length, "agent recommendations", "agent recommendation"), input.userId));
      for (const row of replies.slice(0, LIST_LIMIT)) {
        const item = recommendationItem(row, map);
        if (item) items.push(item);
      }
    }
    if (decisionsOn) {
      const gaps = await sql.query<{ id: string; site_id: string; actor: string }>(
        `SELECT id, site_id, actor FROM agent_inbox
         WHERE kind = 'ask_gap' AND status IN ('new', 'picked') AND upper(site_id) <> $1
         ORDER BY created_at ASC, id ASC`,
        [EXCLUDED_SITE_ID],
      );
      const openGaps = gaps.rows.filter((row) => kept(row.site_id) || row.site_id === "portfolio");
      counts.decisions = requests.length + openGaps.length;
      items.push(line(waiting(counts.decisions, "decision requests", "decision request"), input.userId));
      for (const row of requests.slice(0, LIST_LIMIT)) {
        const item = recommendationItem(row, map);
        if (item) items.push(item);
      }
      for (const row of openGaps.slice(0, LIST_LIMIT)) {
        const siteId = row.site_id || "portfolio";
        if (isExcludedSite(siteId)) continue;
        items.push({
          category: "decisions",
          siteId,
          siteLabel: siteId === "portfolio" ? "Portfolio" : siteLabel(map, siteId),
          summary: "Unanswered question.",
          authorId: row.actor,
          href: siteId === "portfolio" ? reviewHomeHref() : siteHref(siteId),
        });
      }
    }
  }
  if (shown(input.prefs, "proposals")) {
    const rows = await sql.query<ProposalRow>(
      `SELECT id, target_id, title, proposed_value, author_id
       FROM suggestions
       WHERE status IN ('open', 'agreed_waiting', 'ready')
       ORDER BY created_at ASC, id ASC`,
    );
    const open = rows.rows.filter((row) => kept(row.target_id));
    counts.proposals = open.length;
    items.push(line(waiting(open.length, "proposals", "proposal"), input.userId));
    for (const row of open.slice(0, LIST_LIMIT)) {
      const title = publicSnippet(row.title || "") || "Proposal.";
      items.push({
        category: "proposals",
        siteId: row.target_id,
        siteLabel: siteLabel(map, row.target_id),
        summary: title,
        authorId: row.author_id,
        href: proposalHref(row.target_id),
      });
    }
  }
  if (shown(input.prefs, "stages")) {
    const rows = await sql.query<StageRow>(
      `SELECT id, site_id, payload, actor FROM events
       WHERE entity_type = 'stage' AND created_at >= $1 AND upper(site_id) <> $2
       ORDER BY created_at ASC, id ASC`,
      [since, EXCLUDED_SITE_ID],
    );
    const stages = rows.rows.filter((row) => kept(row.site_id));
    counts.stages = stages.length;
    items.push(line(overSpan(stages.length, "stage change", "stage changes", "in the last day"), input.userId));
    for (const row of stages.slice(0, LIST_LIMIT)) {
      const stage = publicSnippet(String(asObject(row.payload).stage || ""));
      items.push({
        category: "stages",
        siteId: row.site_id,
        siteLabel: siteLabel(map, row.site_id),
        summary: stage ? `Now at ${stage}.` : "Stage updated.",
        authorId: row.actor,
        href: siteHref(row.site_id),
      });
    }
  }
  const activity = await activityItems(sql, since, map, input.userId, "in the last day");
  counts.activity = activity.activity;
  counts.comms = activity.comms;
  counts.sites = activity.sites;
  items.push(...activity.items);
  return { items: cleanItems(items), counts };
}

export async function loadCatchUp(sql: Sql): Promise<SummaryResult> {
  const map = await labels();
  const items: MailItem[] = [];
  const counts = emptyCounts();
  const userId = "jaideep";
  const recommendations = await sql.query<RecommendationRow>(
    `SELECT r.id, r.kind, r.decision, r.draft_text, r.model, i.site_id, i.proposal_id
     FROM agent_recommendations r
     JOIN agent_inbox i ON i.id = r.inbox_id
     WHERE r.created_at >= $1 AND upper(i.site_id) <> $2
     ORDER BY r.created_at ASC, r.id ASC`,
    [CATCHUP_SINCE, EXCLUDED_SITE_ID],
  );
  const recommendationRows = recommendations.rows.filter((row) => kept(row.site_id));
  counts.recommendations = recommendationRows.length;
  items.push(line(overSpan(counts.recommendations, "agent recommendation", "agent recommendations", "since Nov 9"), userId));
  for (const row of recommendationRows.slice(0, LIST_LIMIT)) {
    const item = recommendationItem(row, map);
    if (item) items.push({ ...item, category: "recommendations" });
  }
  const decisions = await sql.query<DecisionRow>(
    `SELECT id, site_id, proposal_status, stage, actor FROM agent_inbox
     WHERE kind = 'decision' AND created_at >= $1 AND upper(site_id) <> $2
     ORDER BY created_at ASC, id ASC`,
    [CATCHUP_SINCE, EXCLUDED_SITE_ID],
  );
  const decisionRows = decisions.rows.filter((row) => kept(row.site_id));
  counts.decisions = decisionRows.length;
  items.push(line(overSpan(counts.decisions, "decision", "decisions", "since Nov 9"), userId));
  for (const row of decisionRows.slice(0, LIST_LIMIT)) {
    const status = publicSnippet(row.proposal_status || "");
    const stage = publicSnippet(row.stage || "");
    const summary = [status ? `Recorded decision: ${status}.` : "Recorded decision.", stage ? `Stage ${stage}.` : ""].filter(Boolean).join(" ");
    items.push({
      category: "decisions",
      siteId: row.site_id,
      siteLabel: siteLabel(map, row.site_id),
      summary,
      authorId: row.actor,
      href: proposalHref(row.site_id),
    });
  }
  const stages = await sql.query<StageRow>(
    `SELECT id, site_id, payload, actor FROM events
     WHERE entity_type = 'stage' AND created_at >= $1 AND upper(site_id) <> $2
     ORDER BY created_at ASC, id ASC`,
    [CATCHUP_SINCE, EXCLUDED_SITE_ID],
  );
  const stageRows = stages.rows.filter((row) => kept(row.site_id));
  counts.stages = stageRows.length;
  items.push(line(overSpan(counts.stages, "stage change", "stage changes", "since Nov 9"), userId));
  for (const row of stageRows.slice(0, LIST_LIMIT)) {
    const stage = publicSnippet(String(asObject(row.payload).stage || ""));
    items.push({
      category: "stages",
      siteId: row.site_id,
      siteLabel: siteLabel(map, row.site_id),
      summary: stage ? `Now at ${stage}.` : "Stage updated.",
      authorId: row.actor,
      href: siteHref(row.site_id),
    });
  }
  const activity = await activityItems(sql, CATCHUP_SINCE, map, userId, "since Nov 9");
  counts.activity = activity.activity;
  counts.comms = activity.comms;
  counts.sites = activity.sites;
  items.push(...activity.items);
  return { items: cleanItems(items), counts };
}
