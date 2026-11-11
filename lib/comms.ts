import { ndaQueueAllowed } from "./nda";

const SITE_ID = /^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$/;
const HEX_ID = /^[0-9a-f]{16}$/i;
const SUMMARY_LIMIT = 300;

export const NO_SUMMARY = "No summary recorded";

export type CommsRecord = {
  comms_id: string;
  site_ids: string;
  thread_id: string;
  link: string;
  at: string;
  direction: string;
  person: string;
  firm: string;
  channel: string;
  summary: string;
  asks_made: string;
  asks_answered: string;
  attachments: string;
  state_changes: string;
  source: string;
  message_id: string;
  subject: string;
};

export type CommsSnapshot = {
  source: string;
  as_of: string;
  label: string;
  unexpected_directions: string[];
  rows: CommsRecord[];
  sites: Record<string, string[]>;
};

/** Fields the Activity line is allowed to show. Source prose stays off this object. */
export type CommsLine = {
  commsId: string;
  at: string;
  direction: string;
  person: string;
  firm: string;
  channel: string;
  summary: string;
  href: string;
  citedEventIds: string[];
  messageId: string;
};

export type ActivityInput = {
  date: string;
  type: string;
  summary: string;
  eventId: string;
  sourceLink?: string;
};

export type MergedLine = {
  kind: "activity" | "comms";
  at: string;
  summary: string;
  eventId: string;
  commsId: string;
  type: string;
  direction: string;
  person: string;
  firm: string;
  channel: string;
  href: string;
};

export type CommsBody =
  | { error: string }
  | { rows: CommsLine[]; internal: CommsLine[] };

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

export function siteTokens(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(";")) {
    const token = part.trim().toUpperCase();
    if (!SITE_ID.test(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function directionKind(value: string): "in" | "out" | "internal" | "other" {
  const folded = value.trim().toLowerCase();
  if (folded === "in" || folded === "out" || folded === "internal") return folded;
  return "other";
}

export function clipSummary(value: string): string {
  const summary = text(value).replace(/\s+/g, " ");
  return summary.length > SUMMARY_LIMIT ? summary.slice(0, SUMMARY_LIMIT) : summary;
}

export function normalizeAt(value: string): string {
  const raw = text(value).replace(/\s+PT$/i, "");
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?/.exec(raw);
  if (!match) return "";
  return match[2] ? `${match[1]} ${match[2]}` : match[1];
}

/** Empty stamps sort as newest, matching undated bring-back lines. */
export function sortStamp(at: string): string {
  const when = normalizeAt(at);
  const match = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/.exec(when);
  if (!match) return "";
  return `${match[1]}T${match[2] || "00:00"}`;
}

export function whenParts(at: string): { date: string; time: string } {
  const when = normalizeAt(at);
  const match = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/.exec(when);
  if (!match) return { date: "", time: "" };
  return { date: match[1], time: match[2] || "" };
}

export function hexId(value: string): string {
  const token = text(value);
  return HEX_ID.test(token) ? token.toLowerCase() : "";
}

export function hexFromGmail(value: string): string {
  const labeled = value.match(/#(?:inbox|all|sent|search)\/([0-9a-f]{16})\b/i);
  if (labeled) return labeled[1].toLowerCase();
  const tail = value.match(/([0-9a-f]{16})(?:[?#]|$)/i);
  return tail ? tail[1].toLowerCase() : "";
}

/** A Gmail URL with no mailbox. A link that carries one is rebuilt without it. */
export function safeGmailLink(value: unknown): string {
  const link = text(value);
  if (!link.startsWith("https://mail.google.com/")) return "";
  const id = hexFromGmail(link);
  if (link.includes("@") || /authuser=/i.test(link)) {
    return id ? `https://mail.google.com/mail/u/0/#inbox/${id}` : "";
  }
  return link;
}

export function gmailHref(link: string, messageId: string, threadId: string): string {
  const safe = safeGmailLink(link);
  if (safe) return safe;
  const id = hexId(messageId) || hexId(threadId);
  if (!id) return "";
  return `https://mail.google.com/mail/u/0/#inbox/${id}`;
}

export function eventIds(source: string): string[] {
  const found = source.match(/\bA-\d+\b/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of found) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function toCommsLine(row: Partial<CommsRecord>): CommsLine {
  const messageId = hexId(text(row.message_id));
  const threadId = hexId(text(row.thread_id));
  return {
    commsId: text(row.comms_id),
    at: normalizeAt(text(row.at)),
    direction: text(row.direction),
    person: text(row.person),
    firm: text(row.firm),
    channel: text(row.channel),
    summary: clipSummary(text(row.summary)),
    href: gmailHref(text(row.link), messageId, threadId),
    citedEventIds: eventIds(text(row.source)),
    messageId,
  };
}

export function summaryText(summary: string): string {
  return summary.trim() ? summary.trim() : NO_SUMMARY;
}

export function counterparty(line: { person: string; firm: string }): string {
  return [line.person.trim(), line.firm.trim()].filter(Boolean).join(" · ");
}

export function linesForSites(snapshot: CommsSnapshot, ids: string[]): CommsLine[] {
  const wanted = new Set(ids.map((id) => id.trim().toUpperCase()).filter(Boolean));
  const out: CommsLine[] = [];
  const seen = new Set<string>();
  for (const row of snapshot.rows || []) {
    const tokens = siteTokens(text(row.site_ids));
    if (!tokens.some((id) => wanted.has(id))) continue;
    const line = toCommsLine(row);
    if (!line.commsId || seen.has(line.commsId)) continue;
    seen.add(line.commsId);
    out.push(line);
  }
  return out;
}

export function splitLines(lines: CommsLine[]): { rows: CommsLine[]; internal: CommsLine[] } {
  const rows: CommsLine[] = [];
  const internal: CommsLine[] = [];
  for (const line of lines) {
    const kind = directionKind(line.direction);
    if (kind === "internal") internal.push(line);
    else if (kind === "in" || kind === "out") rows.push(line);
  }
  return { rows, internal };
}

export function commsBody(role: string, snapshot: CommsSnapshot, ids: string[]): CommsBody {
  if (!ndaQueueAllowed(role)) return { error: "You do not have permission for that." };
  return splitLines(linesForSites(snapshot, ids));
}

function messageKey(href: string, messageId: string): string {
  return hexFromGmail(href) || hexId(messageId);
}

function lineId(line: MergedLine): string {
  return line.commsId || line.eventId;
}

export function compareLines(a: MergedLine, b: MergedLine): number {
  const left = sortStamp(a.at);
  const right = sortStamp(b.at);
  if (left !== right) {
    if (!left) return -1;
    if (!right) return 1;
    return right.localeCompare(left);
  }
  return lineId(b).localeCompare(lineId(a));
}

function activityLine(item: ActivityInput): MergedLine {
  return {
    kind: "activity",
    at: item.date,
    summary: item.summary,
    eventId: item.eventId,
    commsId: "",
    type: item.type,
    direction: "",
    person: "",
    firm: "",
    channel: "",
    href: "",
  };
}

function commsMerged(line: CommsLine): MergedLine {
  return {
    kind: "comms",
    at: line.at,
    summary: line.summary,
    eventId: "",
    commsId: line.commsId,
    type: "comms",
    direction: line.direction,
    person: line.person,
    firm: line.firm,
    channel: line.channel,
    href: line.href,
  };
}

/**
 * Newest first. A Comms row that cites an Activity event already on the card,
 * or that points at the same Gmail message, becomes one line. Prefer the Comms
 * row when it has a summary or a Gmail link.
 */
export function mergeActivity(
  activity: ActivityInput[],
  comms: CommsLine[],
  options: { includeInternal: boolean },
): MergedLine[] {
  const visible = comms.filter((line) => {
    const kind = directionKind(line.direction);
    if (kind === "other") return false;
    if (kind === "internal") return options.includeInternal;
    return true;
  });
  const activityById = new Map(activity.filter((item) => item.eventId).map((item) => [item.eventId, item]));
  const hide = new Set<string>();
  const kept: CommsLine[] = [];
  const seenMessages = new Set<string>();
  for (const line of visible) {
    const gmail = messageKey(line.href, line.messageId);
    if (gmail && seenMessages.has(gmail)) continue;
    const cited = line.citedEventIds.filter((id) => activityById.has(id));
    const gmailHit = gmail
      ? activity
          .filter((item) => item.eventId && messageKey(item.sourceLink || "", "") === gmail)
          .map((item) => item.eventId)
      : [];
    const overlap = [...new Set([...cited, ...gmailHit])];
    if (overlap.length && !line.summary.trim() && !line.href) continue;
    if (gmail) seenMessages.add(gmail);
    if (overlap.length) {
      for (const id of overlap) hide.add(id);
    }
    kept.push(line);
  }
  const activityLines = activity.filter((item) => !item.eventId || !hide.has(item.eventId)).map(activityLine);
  const commsLines = kept.map(commsMerged);
  if (!commsLines.length && hide.size === 0) return activityLines;
  const merged = [...activityLines, ...commsLines];
  merged.sort(compareLines);
  return merged;
}
