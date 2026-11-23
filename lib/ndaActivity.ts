import { directionKind, gmailHref, hexId, normalizeAt, siteTokens, type CommsRecord } from "./comms";
import { stripGmailIds } from "./displayText";
import { formatActivityWhen } from "./actions/time";

export type NdaActivityQuery = {
  sites: string[];
  ndaId: string;
  firm: string;
  person: string;
  threads: string[];
  source: string;
};

export type NdaActivityItem = {
  id: string;
  at: string;
  direction: "in" | "out";
  person: string;
  subject: string;
  summary: string;
  href: string;
  thread: string;
};

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hexes(value: string): string[] {
  return (value.match(/\b[0-9a-f]{16}\b/gi) || []).map((item) => item.toLowerCase());
}

function firmMatch(rowFirm: string, wanted: string): boolean {
  const left = norm(rowFirm);
  const right = norm(wanted);
  if (left.length < 6 || right.length < 6) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function personMatch(rowPerson: string, wanted: string): boolean {
  const person = norm(rowPerson);
  const parts = norm(wanted).split(" ").filter((part) => part.length > 2);
  if (!person || parts.length < 2) return false;
  return parts.every((part) => person.includes(part));
}

export function addressIn(value: string): string {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

/** An email from a comms row whose person is the NDA contact. */
export function emailFromComms(rows: CommsRecord[], personName: string): string {
  for (const row of rows) {
    if (!personMatch(row.person || "", personName)) continue;
    const found = addressIn(`${row.email || ""} ${row.person || ""} ${row.summary || ""} ${row.subject || ""} ${row.source || ""}`);
    if (found) return found;
  }
  return "";
}

function matches(row: CommsRecord, spec: NdaActivityQuery, threads: Set<string>): boolean {
  const sites = new Set(spec.sites.map((id) => id.trim().toUpperCase()).filter(Boolean));
  if (siteTokens(row.site_ids || "").some((id) => sites.has(id))) return true;
  const ndaId = spec.ndaId.trim().toUpperCase();
  const blob = `${row.site_ids || ""} ${row.summary || ""} ${row.subject || ""} ${row.source || ""}`;
  if (ndaId && blob.toUpperCase().includes(ndaId)) return true;
  const thread = (row.thread_id || "").trim().toLowerCase();
  const message = (row.message_id || "").trim().toLowerCase();
  if ((thread && threads.has(thread)) || (message && threads.has(message))) return true;
  if (firmMatch(row.firm || "", spec.firm)) return true;
  if (personMatch(row.person || "", spec.person) && (!norm(row.firm || "") || firmMatch(row.firm || "", spec.firm))) return true;
  return false;
}

function oneLine(value: string): string {
  const clean = stripGmailIds(value).replace(/\s+/g, " ").trim();
  if (clean.length <= 140) return clean;
  const slice = clean.slice(0, 140).replace(/\s+\S*$/, "").trim();
  return `${slice || clean.slice(0, 140).trim()}…`;
}

export function activityClock(at: string): string {
  return formatActivityWhen(at, false).label.replace(/\s+PT$/i, "");
}

/** NDA email only: matched, deduped, newest first, grouped by thread without exposing thread ids. */
export function ndaActivity(rows: CommsRecord[], spec: NdaActivityQuery): { items: NdaActivityItem[]; contact_email: string } {
  const threads = new Set<string>([
    ...spec.threads.map((item) => item.trim().toLowerCase()).filter(Boolean),
    ...hexes(spec.source),
  ]);
  const matched = rows.filter((row) => matches(row, spec, threads));
  const contactEmail = emailFromComms(matched, spec.person);
  const seen = new Set<string>();
  const kept: CommsRecord[] = [];
  const ordered = matched.slice().sort((left, right) => normalizeAt(right.at || "").localeCompare(normalizeAt(left.at || "")));
  for (const row of ordered) {
    const kind = directionKind(row.direction || "");
    if (kind !== "in" && kind !== "out") continue;
    const message = hexId(row.message_id || "");
    const stamp = `${normalizeAt(row.at || "")}|${kind}|${norm(row.person || "")}`;
    if ((message && seen.has(`m:${message}`)) || seen.has(`s:${stamp}`)) continue;
    if (message) seen.add(`m:${message}`);
    seen.add(`s:${stamp}`);
    kept.push(row);
  }
  const alias = new Map<string, string>();
  const items: NdaActivityItem[] = kept.map((row) => {
    const kind = directionKind(row.direction || "") === "out" ? "out" : "in";
    const threadId = (row.thread_id || "").trim().toLowerCase();
    const id = (row.comms_id || "").trim() || `${normalizeAt(row.at || "")}-${kind}`;
    let thread = id;
    if (threadId) {
      const known = alias.get(threadId);
      if (known) thread = known;
      else alias.set(threadId, id);
    }
    return {
      id,
      at: activityClock(row.at || ""),
      direction: kind,
      person: (row.person || "").trim(),
      subject: oneLine(row.subject || "") || "Email",
      summary: oneLine(row.summary || ""),
      href: gmailHref(row.link || "", row.message_id || "", row.thread_id || ""),
      thread,
    };
  });
  return { items, contact_email: contactEmail };
}
