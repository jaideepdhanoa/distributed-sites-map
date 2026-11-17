import type { Sql } from "@/lib/actions/db";
import { countOpenThreads } from "@/lib/comments/record";
import { countOpenConflicts } from "@/lib/conflicts/record";
import { loadCatalog } from "@/lib/queue/catalog";
import { publicSnippet, type MailItem } from "./compose";
import { EXCLUDED_SITE_ID, isExcludedSite } from "./excluded";
import { proposalHref, reviewHomeHref, siteHref } from "./links";
import type { AlertCategory, AlertPreferences } from "./preferences";

/** Stage, listing, and comms rows in the one-time catch-up. Open items are not cut off by this date. */
export const CATCHUP_SINCE = "2026-11-08T00:00:00.000Z";
export const CATCHUP_SUBJECT = "Distributed Sites catch-up · since Nov 8";
export const CATCHUP_EMAIL = "jaideep@dhanoa.in";
export const CATCHUP_KEY = "catchup:jaideep:since-2026-11-08";

const TOP_SITES = 5;
const PROPOSAL_LIST = 25;

export type SummaryCounts = {
  recommendations: number;
  proposals: number;
  decisions: number;
  stages: number;
  activity: number;
  comms: number;
  sites: number;
  asks: number;
  conflicts: number;
  threads: number;
};

export type SummaryResult = { items: MailItem[]; counts: SummaryCounts };

export function emptyCounts(): SummaryCounts {
  return { recommendations: 0, proposals: 0, decisions: 0, stages: 0, activity: 0, comms: 0, sites: 0, asks: 0, conflicts: 0, threads: 0 };
}

export function emptyBrief(): SummaryResult {
  return { items: [], counts: emptyCounts() };
}

type EventRow = {
  id: string;
  entity_type: string;
  site_id: string;
  payload: unknown;
  actor: string;
  source: string;
  created_at: Date | string;
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

/** Workbook copy and import rows are app history, not mail. */
export function isWorkbookWrite(source: string, actor: string): boolean {
  if (actor.trim().toLowerCase() === "workbook-sync") return true;
  const blob = `${source}\n${actor}`.toLowerCase();
  return blob.includes("workbook") || blob.includes("import") || blob.includes("workbook-copy");
}

const BEARER_AGENTS = new Set(["indie", "muse"]);

export function isRealStageChange(payload: Record<string, unknown>, source: string, actor: string): boolean {
  if (isWorkbookWrite(source, actor)) return false;
  const next = String(payload.stage || "");
  if ("previous_stage" in payload) {
    const previous = payload.previous_stage;
    if (previous == null || String(previous).trim() === "") return false;
    if (String(previous) === next) return false;
  }
  return true;
}

function inboundComms(payload: Record<string, unknown>, source: string, actor: string, userId: string): boolean {
  if (isWorkbookWrite(source, actor)) return false;
  if (actor.trim().toLowerCase() === userId.trim().toLowerCase()) return false;
  return String(payload.direction || "").trim().toLowerCase() === "in";
}

function ownAction(authorId: string, userId: string): boolean {
  const author = authorId.trim().toLowerCase();
  const user = userId.trim().toLowerCase();
  return Boolean(author && user && author === user);
}

function shown(prefs: AlertPreferences | null, key: AlertCategory): boolean {
  if (!prefs) return true;
  return prefs[key] !== "off";
}

function line(summary: string, userId: string, category: MailItem["category"] = "brief"): MailItem {
  return {
    category,
    siteId: "",
    siteLabel: "",
    summary,
    authorId: userId,
    href: reviewHomeHref(),
  };
}

function countLine(count: number, singular: string, plural: string): string {
  if (count === 1) return `1 ${singular}.`;
  return `${count} ${plural}.`;
}

function waitingForYou(count: number, singular: string, plural: string): string {
  if (count === 1) return `1 ${singular} is waiting for you.`;
  return `${count} ${plural} are waiting for you.`;
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

async function approvedSites(sql: Sql): Promise<Set<string>> {
  const rows = await sql.query<{ target_id: string; proposed_value: string; detail: string | null }>(
    `SELECT target_id, proposed_value, detail FROM suggestions WHERE status = 'accepted'`,
  );
  const approved = new Set<string>();
  for (const row of rows.rows) {
    if (row.detail === "knock_off") approved.add(`${row.target_id}\nDropped`);
    if (row.proposed_value) approved.add(`${row.target_id}\n${row.proposed_value}`);
  }
  return approved;
}

function agentStageIsApproved(actor: string, siteId: string, stage: string, approved: Set<string>): boolean {
  if (!BEARER_AGENTS.has(actor.trim().toLowerCase())) return true;
  return approved.has(`${siteId}\n${stage}`) || (stage === "Dropped" && approved.has(`${siteId}\nDropped`));
}

type ProposalRow = {
  id: string;
  target_id: string;
  title: string | null;
  author_id: string;
};

async function collect(
  sql: Sql,
  input: {
    userId: string;
    eventSince: string | null;
    rowSince: string | null;
    prefs: AlertPreferences | null;
    listProposals?: boolean;
  },
): Promise<SummaryResult> {
  const map = await labels();
  const items: MailItem[] = [];
  const counts = emptyCounts();
  const since = input.rowSince;
  const approved = await approvedSites(sql);

  if (shown(input.prefs, "recommendations") || shown(input.prefs, "decisions")) {
    const rows = await sql.query<{ id: string; kind: string; site_id: string }>(
      `SELECT r.id, r.kind, i.site_id
       FROM agent_recommendations r
       JOIN agent_inbox i ON i.id = r.inbox_id
       LEFT JOIN suggestions s ON s.id = i.proposal_id
       WHERE r.dismissed_at IS NULL
         AND r.used_at IS NULL
         AND i.status <> 'superseded'
         AND upper(i.site_id) <> $1
         AND ($2::timestamptz IS NULL OR r.created_at >= $2::timestamptz)
         AND (
           r.kind <> 'decision'
           OR i.proposal_id IS NULL
           OR s.status IN ('open', 'agreed_waiting', 'ready')
         )
       ORDER BY r.created_at ASC, r.id ASC`,
      [EXCLUDED_SITE_ID, since],
    );
    const replies = rows.rows.filter((row) => row.kind !== "decision" && kept(row.site_id));
    const requests = rows.rows.filter((row) => row.kind === "decision" && kept(row.site_id));
    if (shown(input.prefs, "recommendations") && replies.length) {
      counts.recommendations = replies.length;
      items.push(line(waitingForYou(replies.length, "agent draft reply", "agent draft replies"), input.userId, "recommendations"));
    }
    if (shown(input.prefs, "decisions") && requests.length) {
      counts.decisions = requests.length;
      items.push(line(countLine(requests.length, "open decision request", "open decision requests"), input.userId, "decisions"));
    }
  }

  if (shown(input.prefs, "proposals")) {
    const rows = await sql.query<ProposalRow>(
      `SELECT id, target_id, title, author_id FROM suggestions
       WHERE status IN ('open', 'agreed_waiting', 'ready')
         AND upper(target_id) <> $2
         AND ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
       ORDER BY created_at ASC, id ASC`,
      [since, EXCLUDED_SITE_ID],
    );
    const open = rows.rows.filter((row) => kept(row.target_id) && !ownAction(row.author_id, input.userId));
    if (open.length) {
      counts.proposals = open.length;
      items.push(line(countLine(open.length, "open proposal", "open proposals"), input.userId, "proposals"));
      if (input.listProposals) {
        for (const row of open.slice(0, PROPOSAL_LIST)) {
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
        if (open.length > PROPOSAL_LIST) {
          items.push(line(`${PROPOSAL_LIST} of ${open.length} open proposals are listed.`, input.userId, "proposals"));
        }
      }
    }
  }

  if (shown(input.prefs, "asks")) {
    const rows = await sql.query<{ site_id: string }>(
      `SELECT site_id FROM agent_inbox
       WHERE kind = 'ask_gap' AND status IN ('new', 'picked')
         AND upper(site_id) <> $1
         AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)`,
      [EXCLUDED_SITE_ID, since],
    );
    const gaps = rows.rows.filter((row) => !row.site_id || row.site_id === "portfolio" || kept(row.site_id));
    if (gaps.length) {
      counts.asks = gaps.length;
      items.push(line(countLine(gaps.length, "open ask gap", "open ask gaps"), input.userId, "asks"));
    }
  }

  const events = await sql.query<EventRow>(
    `SELECT id, entity_type, site_id, payload, actor, source, created_at
     FROM events
     WHERE entity_type IN ('stage', 'comms')
       AND upper(site_id) <> $1
       AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
     ORDER BY created_at ASC, id ASC`,
    [EXCLUDED_SITE_ID, input.eventSince],
  );

  const stages = events.rows.filter((row) => {
    if (row.entity_type !== "stage" || !kept(row.site_id)) return false;
    const payload = asObject(row.payload);
    if (!isRealStageChange(payload, row.source, row.actor)) return false;
    return agentStageIsApproved(row.actor, row.site_id, String(payload.stage || ""), approved);
  });
  if (shown(input.prefs, "stages") && stages.length) {
    counts.stages = stages.length;
    items.push(line(countLine(stages.length, "stage change from an approved decision", "stage changes from approved decisions"), input.userId, "stages"));
    for (const row of stages.slice(0, TOP_SITES)) {
      items.push({
        category: "stages",
        siteId: row.site_id,
        siteLabel: siteLabel(map, row.site_id),
        summary: "Stage updated.",
        authorId: row.actor,
        href: siteHref(row.site_id),
      });
    }
  }

  const commsBySite = new Map<string, number>();
  for (const row of events.rows) {
    if (row.entity_type !== "comms" || !kept(row.site_id)) continue;
    const payload = asObject(row.payload);
    if (!inboundComms(payload, row.source, row.actor, input.userId)) continue;
    commsBySite.set(row.site_id, (commsBySite.get(row.site_id) || 0) + 1);
  }
  const commsSites = [...commsBySite.entries()];
  counts.comms = commsSites.reduce((sum, [, count]) => sum + count, 0);
  for (const [siteId, count] of commsSites) {
    items.push({
      category: "comms",
      siteId,
      siteLabel: siteLabel(map, siteId),
      summary: count === 1 ? "1 inbound reply." : `${count} inbound replies.`,
      authorId: input.userId,
      href: siteHref(siteId),
    });
  }

  const sites = await sql.query<EventRow>(
    `SELECT id, entity_type, site_id, payload, actor, source, created_at
     FROM events
     WHERE entity_type = 'site'
       AND upper(site_id) <> $1
       AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
     ORDER BY created_at DESC, id DESC`,
    [EXCLUDED_SITE_ID, input.eventSince],
  );
  const fresh = sites.rows.filter((row) => kept(row.site_id) && !isWorkbookWrite(row.source, row.actor));
  const seen = new Set<string>();
  const unique = fresh.filter((row) => {
    if (seen.has(row.site_id)) return false;
    seen.add(row.site_id);
    return true;
  });
  counts.sites = unique.length;
  const openConflicts = await countOpenConflicts(sql);
  counts.conflicts = openConflicts;
  if (openConflicts) {
    items.push(line(countLine(openConflicts, "open data conflict", "open data conflicts"), input.userId, "brief"));
  }
  const openThreads = await countOpenThreads(sql);
  counts.threads = openThreads;
  if (openThreads) {
    items.push(line(countLine(openThreads, "open comment thread", "open comment threads"), input.userId, "brief"));
  }
  if (unique.length) {
    const byMarket = new Map<string, number>();
    for (const row of unique) {
      const market = String(asObject(row.payload).market || "").trim().toUpperCase() || "Other";
      byMarket.set(market, (byMarket.get(market) || 0) + 1);
    }
    const markets = [...byMarket.entries()].map(([market, count]) => `${market} ${count}`).join(", ");
    items.push(line(`New listings: ${markets}.`, input.userId, "sites"));
    for (const row of unique.slice(0, TOP_SITES)) {
      items.push({
        category: "sites",
        siteId: row.site_id,
        siteLabel: siteLabel(map, row.site_id),
        summary: "New listing.",
        authorId: row.actor,
        href: siteHref(row.site_id),
        market: String(asObject(row.payload).market || ""),
      });
    }
  }

  return { items: cleanItems(items), counts };
}

export async function loadDigestBrief(
  sql: Sql,
  input: { userId: string; since: Date; prefs: AlertPreferences },
): Promise<SummaryResult> {
  return collect(sql, { userId: input.userId, eventSince: input.since.toISOString(), rowSince: null, prefs: input.prefs });
}

export async function loadCatchUp(sql: Sql): Promise<SummaryResult> {
  return collect(sql, {
    userId: "jaideep",
    eventSince: CATCHUP_SINCE,
    rowSince: null,
    prefs: null,
    listProposals: true,
  });
}
