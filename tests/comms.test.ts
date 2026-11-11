import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  commsBody,
  compareLines,
  directionKind,
  linesForSites,
  mergeActivity,
  siteTokens,
  sortStamp,
  summaryText,
  toCommsLine,
  type CommsLine,
  type CommsRecord,
  type CommsSnapshot,
  type MergedLine,
} from "../lib/comms.ts";

const snapshot = JSON.parse(readFileSync("data/generated/comms.json", "utf8")) as CommsSnapshot;
const route = readFileSync("lib/api/handlers/data/comms.ts", "utf8");
const ui = readFileSync("components/timeline/Timeline.tsx", "utf8");

function row(partial: Partial<CommsRecord>): CommsRecord {
  return {
    comms_id: "CM-9000",
    site_ids: "PIPE-PHX-0001",
    thread_id: "",
    link: "",
    at: "2026-11-01",
    direction: "in",
    person: "",
    firm: "",
    channel: "Gmail",
    summary: "",
    asks_made: "",
    asks_answered: "",
    attachments: "",
    state_changes: "",
    source: "",
    message_id: "",
    subject: "",
    ...partial,
  };
}

function newestFirst(lines: MergedLine[]): boolean {
  for (let index = 1; index < lines.length; index += 1) {
    const previous = sortStamp(lines[index - 1].at);
    const next = sortStamp(lines[index].at);
    if (!previous && next) continue;
    if (previous && !next) return false;
    if (previous < next) return false;
    if (previous === next) {
      const left = lines[index - 1].commsId || lines[index - 1].eventId;
      const right = lines[index].commsId || lines[index].eventId;
      if (left < right) return false;
    }
  }
  return true;
}

test("the snapshot is keyed by site id and keeps internal rows", () => {
  assert.equal(snapshot.source, "fixture");
  assert.match(snapshot.label, /Comms Log/);
  assert.match(snapshot.label, /Nov 11, 2026/);
  const byId = new Map(snapshot.rows.map((item) => [item.comms_id, item]));
  assert.equal(byId.has("CM-0002"), false);
  assert.ok(snapshot.sites["LAND-PHX-0059"]?.includes("CM-0377"));
  assert.ok(snapshot.sites["LAND-PHX-0061"]?.includes("CM-0377"));
  assert.ok(snapshot.sites["PIPE-PHX-0001"]?.includes("CM-0021"));
  assert.ok(snapshot.sites["PIPE-PHX-0003"]?.includes("CM-0021"));
  assert.ok(snapshot.sites["LAND-PHX-0050"]?.includes("CM-0388"));
  assert.equal(byId.get("CM-0387")?.direction, "internal");
  assert.equal(byId.get("CM-0385")?.at, "2026-11-11 12:30");
  assert.equal(snapshot.rows.at(-1)?.comms_id, "CM-0389");
  assert.equal(byId.get("CM-0389")?.at, "2026-11-11 12:56");
  assert.equal(byId.get("CM-0021")?.direction, "internal");
  assert.deepEqual(siteTokens(byId.get("CM-0377")?.site_ids || ""), ["LAND-PHX-0059", "LAND-PHX-0061"]);
  for (const [site, ids] of Object.entries(snapshot.sites)) {
    assert.match(site, /^(PIPE|LAND)-[A-Z]{2,4}-\d{4}$/);
    for (const id of ids) {
      const item = byId.get(id);
      assert.ok(item);
      assert.ok(siteTokens(item.site_ids).includes(site));
    }
  }
  const internal = snapshot.rows.filter((item) => directionKind(item.direction) === "internal");
  assert.ok(internal.length > 0);
  assert.equal(snapshot.rows.some((item) => item.summary.length > 300), false);
  assert.deepEqual(snapshot.unexpected_directions, []);
});

test("internal rows stay out of the default timeline", () => {
  const internalSummary = snapshot.rows.find((item) => item.comms_id === "CM-0021")?.summary || "";
  assert.ok(internalSummary);
  const body = commsBody("reviewer", snapshot, ["PIPE-PHX-0001", "PIPE-PHX-0003"]);
  assert.equal("error" in body, false);
  if ("error" in body) return;
  assert.equal(JSON.stringify(body.rows).includes(internalSummary), false);
  assert.equal(body.rows.some((line) => directionKind(line.direction) === "internal"), false);
  assert.ok(body.internal.some((line) => line.commsId === "CM-0021"));
  const hidden = mergeActivity([], [...body.rows, ...body.internal], { includeInternal: false });
  assert.equal(hidden.some((line) => line.commsId === "CM-0021"), false);
  const shown = mergeActivity([], [...body.rows, ...body.internal], { includeInternal: true });
  assert.ok(shown.some((line) => line.commsId === "CM-0021" && line.direction === "internal"));
});

test("signed-out and unauthorized responses contain no comms content", () => {
  const summary = snapshot.rows.find((item) => item.comms_id === "CM-0004")?.summary || "";
  const firm = snapshot.rows.find((item) => item.comms_id === "CM-0004")?.firm || "";
  assert.ok(summary);
  assert.ok(firm);
  for (const role of ["guest", ""]) {
    const denied = commsBody(role, snapshot, ["PIPE-MIA-0082", "PIPE-PHX-0001", "LAND-PHX-0059"]);
    const text = JSON.stringify(denied);
    assert.equal(text.includes(summary), false);
    assert.equal(text.includes(firm), false);
    assert.equal(text.includes("mail.google.com"), false);
    assert.equal(text.includes("counterparty"), false);
    assert.deepEqual(denied, { error: "You do not have permission for that." });
  }
  assert.match(route, /requireUser\(/);
  assert.match(route, /ndaQueueAllowed\(session\.actionRole\)/);
  assert.equal(route.includes("asks_made"), false);
  assert.equal(route.includes("subject"), false);
});

test("an authorized merge is newest first and includes an in or out summary", () => {
  const body = commsBody("viewer", snapshot, ["PIPE-MIA-0082"]);
  assert.equal("error" in body, false);
  if ("error" in body) return;
  const activity = [{ date: "2026-11-06", type: "stage", summary: "Stage set to Dropped", eventId: "A-000271" }];
  const merged = mergeActivity(activity, body.rows, { includeInternal: false });
  assert.equal(newestFirst(merged), true);
  assert.ok(merged.some((line) => line.kind === "comms" && (line.direction === "in" || line.direction === "out") && line.summary.trim()));
  const ids = merged.filter((line) => line.kind === "comms").map((line) => line.commsId);
  assert.ok(ids.includes("CM-0011"));
  assert.ok(ids.includes("CM-0004"));
  assert.ok(ids.indexOf("CM-0011") < ids.indexOf("CM-0004"));
  const sameDay = merged.filter((line) => line.at.startsWith("2026-11-06"));
  const sorted = [...sameDay].sort(compareLines);
  assert.deepEqual(sameDay.map((line) => line.commsId || line.eventId), sorted.map((line) => line.commsId || line.eventId));
});

test("a comms row that cites an activity event already on the card is one line", () => {
  const source = snapshot.rows.find((item) => item.comms_id === "CM-0001");
  assert.ok(source);
  const line = toCommsLine(source);
  assert.deepEqual(line.citedEventIds, ["A-000088"]);
  const activity = [{ date: "2026-10-19", type: "doc", summary: "Document on file", eventId: "A-000088" }];
  const merged = mergeActivity(activity, [line], { includeInternal: false });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.kind, "comms");
  assert.equal(merged[0]?.summary, source.summary);
  const sparse = toCommsLine({ ...source, summary: "", link: "", thread_id: "", message_id: "" });
  const kept = mergeActivity(activity, [sparse], { includeInternal: false });
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.kind, "activity");
  const linked = mergeActivity(
    [{ ...activity[0], sourceLink: "https://mail.google.com/mail/u/0/#inbox/abcdef0123456789" }],
    [toCommsLine({ ...source, source: "", summary: "A later note", link: "", message_id: "abcdef0123456789" })],
    { includeInternal: false },
  );
  assert.equal(linked.length, 1);
  assert.equal(linked[0]?.kind, "comms");
  assert.equal(linked[0]?.href, "https://mail.google.com/mail/u/0/#inbox/abcdef0123456789");
});

test("a blank summary still appears, without a fabricated body or a gmail link", () => {
  const seed = snapshot.rows.find((item) => item.comms_id === "CM-0016");
  assert.ok(seed);
  const line = linesForSites(snapshot, ["LAND-PHX-0049"]).find((item) => item.commsId === "CM-0016");
  assert.ok(line);
  assert.equal(line.summary, "");
  assert.equal(line.href, "");
  assert.equal(summaryText(line.summary), "No summary recorded");
  const merged = mergeActivity([], [line], { includeInternal: false });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.summary, "");
  assert.equal(merged[0]?.href, "");
  assert.equal(seed.summary, "");
});

test("no mailbox or raw body is added beyond the summary and counterparty columns", () => {
  const line = toCommsLine(row({
    summary: "Called the listing broker.",
    person: "Art Rullo",
    firm: "Marcus & Millichap",
    source: "note hidden.person@example.com Activity A-000001",
    asks_made: "send the file to other.person@example.com",
    subject: "Mailbox other.person@example.com",
    link: "https://mail.google.com/mail/u/0/#inbox/abcdef0123456789?authuser=hidden.person@example.com",
    message_id: "abcdef0123456789",
  }));
  const text = JSON.stringify(line);
  assert.equal(text.includes("hidden.person@example.com"), false);
  assert.equal(text.includes("other.person@example.com"), false);
  assert.equal(text.includes("authuser"), false);
  assert.equal(line.href, "https://mail.google.com/mail/u/0/#inbox/abcdef0123456789");
  assert.equal("source" in line, false);
  assert.equal("subject" in line, false);
  assert.equal("asks_made" in line, false);
  assert.equal("body" in line, false);
  const kept = toCommsLine(row({ summary: "Reply to broker@example.com" }));
  assert.match(kept.summary, /broker@example.com/);
  const shared = linesForSites(snapshot, ["LAND-PHX-0059"]).find((item) => item.commsId === "CM-0377");
  assert.equal(shared?.href, "https://mail.google.com/mail/u/0/#inbox/1a1cb8944d8350a0");
  assert.equal(shared?.href.includes("@"), false);
  const other = toCommsLine(row({ direction: "Broker", summary: "Unexpected direction" }));
  assert.equal(mergeActivity([], [other], { includeInternal: false }).length, 0);
  assert.equal(mergeActivity([], [other], { includeInternal: true }).length, 0);
});

test("the activity screen keeps the heading and hides internal rows until asked", () => {
  assert.match(ui, /data-testid="activity"/);
  assert.match(ui, /<h3>Activity<\/h3>/);
  assert.match(ui, /Show internal/);
  assert.match(ui, /useState\(false\)/);
  assert.match(ui, /tl-internal/);
  assert.equal(ui.includes("377"), false);
  const lines = linesForSites(snapshot, ["PIPE-MIA-0082"]) as CommsLine[];
  assert.ok(lines.length >= 4);
});
