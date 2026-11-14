import assert from "node:assert/strict";
import test from "node:test";
import { diffFeed, type FeedSite } from "../../lib/queue/diff";
import { buildQueue, queueMembership, type QueueReason } from "../../lib/queue/order";

const at = "2026-11-05T18:00:00.000Z";
const site: FeedSite = {
  id: "PIPE-PHX-0008",
  city: "PHX",
  stage: "1 Desk screen",
  stageGroup: "desk",
  verdict: "MAYBE",
  askingPrice: "$1,000,000",
  askingSource: "Listing",
  active: true,
};

test("the first published build records no change events", () => {
  assert.deepEqual(diffFeed({ previous: null, next: [site], at }), []);
});

test("a build records a new site, the workbook stage, the verdict, and the asking price with its source", () => {
  const events = diffFeed({
    previous: [site],
    next: [{ ...site, id: "PIPE-PHX-0099", stage: "Contacted", verdict: "PASS", askingPrice: "$2,000,000", askingSource: "Listing sheet" }, site],
    at,
  });
  const created = events.find((event) => event.siteId === "PIPE-PHX-0099");
  assert.equal(created?.type, "new_site");
  assert.equal(created?.summary, "New pipeline site.");
  const changed = diffFeed({
    previous: [site],
    next: [{ ...site, stage: "Contacted", verdict: "PASS", askingPrice: "$2,000,000", askingSource: "Listing sheet" }],
    at,
  });
  assert.deepEqual(changed.map((event) => event.type), ["stage", "verdict", "price"]);
  assert.equal(changed[0]?.summary, "Stage is now Contacted.");
  assert.equal(changed[1]?.summary, "Verdict is now Cleared.");
  assert.equal(changed[2]?.summary, "Asking price is $2,000,000, from Listing sheet.");
});

test("activity and materials are ignored unless both builds include them", () => {
  assert.equal(diffFeed({ previous: [site], next: [site], at }).length, 0);
  const events = diffFeed({
    previous: [site],
    next: [site],
    previousActivity: [],
    nextActivity: [{ id: "visit-1", siteId: site.id, summary: "A site visit was logged." }],
    previousMaterials: [{ siteId: site.id, category: "financials", label: "Financials", count: 1 }],
    nextMaterials: [{ siteId: site.id, category: "financials", label: "Financials", count: 3 }],
    at,
  });
  assert.deepEqual(events.map((event) => event.type), ["activity", "materials"]);
  assert.equal(events[1]?.summary, "Financials count is now 3.");
});

function row(id: string, extra: Partial<{ city: string; stageGroup: string; active: boolean }> = {}) {
  return { id, city: extra.city || "PHX", stage: "1 Desk screen", stageGroup: extra.stageGroup || "desk", active: extra.active ?? true };
}

test("queue order is approval, then mentions, then assigned, then the rest", () => {
  const reasons: Record<string, QueueReason[]> = {
    mentioned: [{ at: "2026-11-05T20:00:00.000Z", summary: "Mentioned you.", type: "mention" }],
    flagged: [{ at: "2026-11-05T12:00:00.000Z", summary: "Flagged for you.", type: "flag" }],
    approval: [{ at: "2026-11-05T19:00:00.000Z", summary: "Next step proposed: Ask for the sales package", type: "next_proposed" }],
    assigned: [{ at: "2026-11-05T11:00:00.000Z", summary: "Assigned to you.", type: "assignment" }],
    fresh: [{ at: "2026-11-04T00:00:00.000Z", summary: "New pipeline site.", type: "new_site" }],
    older: [{ at: "2026-11-03T00:00:00.000Z", summary: "New note.", type: "note" }],
    newer: [{ at: "2026-11-05T18:00:00.000Z", summary: "New note.", type: "note" }],
  };
  const rows = buildQueue({
    sites: ["mentioned", "flagged", "approval", "assigned", "fresh", "older", "newer"].map((id) => row(id)),
    reasons,
    reviewedAt: { mentioned: "2026-11-01T00:00:00.000Z", flagged: "2026-11-01T00:00:00.000Z", approval: "2026-11-01T00:00:00.000Z", assigned: "2026-11-01T00:00:00.000Z", older: "2026-11-01T00:00:00.000Z", newer: "2026-11-01T00:00:00.000Z" },
    snoozeUntil: {},
    flagged: new Set(["flagged"]),
    mentioned: new Set(["mentioned"]),
    assigned: new Set(["assigned"]),
    needsApproval: new Set(["approval"]),
    today: "2026-11-05",
    filters: { market: "PHX", viable: true },
  });
  assert.deepEqual(rows.map((item) => item.siteId), ["approval", "mentioned", "assigned", "flagged", "fresh", "newer", "older"]);
});

test("a hidden c-store stays out of every review section", () => {
  const sites = [row("store", { }), row("open")].map((item) => item.id === "store" ? { ...item, hidden: true } : item);
  const hidden = buildQueue({
    sites,
    reasons: {},
    reviewedAt: {},
    snoozeUntil: {},
    flagged: new Set(),
    mentioned: new Set(),
    assigned: new Set(),
    needsApproval: new Set(),
    today: "2026-11-05",
    filters: { market: "all", viable: true },
  });
  assert.deepEqual(hidden.map((item) => item.siteId), ["open"]);
  const surfaced = buildQueue({
    sites,
    reasons: { store: [{ at: "2026-11-05T12:00:00.000Z", summary: "Next step proposed: Drop from pipeline", type: "next_proposed" }] },
    reviewedAt: { store: "2026-11-06T00:00:00.000Z" },
    snoozeUntil: {},
    flagged: new Set(["store"]),
    mentioned: new Set(["store"]),
    assigned: new Set(["store"]),
    needsApproval: new Set(["store"]),
    today: "2026-11-05",
    filters: { market: "all", viable: true },
  });
  assert.equal(surfaced.some((item) => item.siteId === "store"), false);
  const otherMarket = buildQueue({
    sites: [{ ...row("store", { city: "LAS" }), hidden: true }, row("local")],
    reasons: {},
    reviewedAt: {},
    snoozeUntil: {},
    flagged: new Set(),
    mentioned: new Set(),
    assigned: new Set(),
    needsApproval: new Set(["store"]),
    today: "2026-11-05",
    filters: { market: "PHX", stage: "desk", viable: true },
  });
  assert.equal(otherMarket.some((item) => item.siteId === "store"), false);
  assert.equal(otherMarket[0]?.siteId, "local");
});

test("snooze hides a site until the date, and a later change or a flag brings it back", () => {
  const base = {
    active: true,
    reviewedAt: "2026-11-01T00:00:00.000Z",
    today: "2026-11-05",
    flagged: false,
    mentioned: false,
    reasons: [{ at: "2026-11-02T00:00:00.000Z", summary: "New note.", type: "note" }] as QueueReason[],
  };
  assert.equal(queueMembership({ ...base, snoozeUntil: "2026-11-20" }), false);
  assert.equal(queueMembership({ ...base, snoozeUntil: "2026-11-05" }), true);
  assert.equal(queueMembership({ ...base, snoozeUntil: "2026-11-20", flagged: true }), true);
  assert.equal(queueMembership({ ...base, snoozeUntil: "2026-11-20", mentioned: true }), true);
  assert.equal(queueMembership({ ...base, snoozeUntil: null, reasons: [{ at: "2026-10-01T00:00:00.000Z", summary: "New note.", type: "note" }] }), false);
  assert.equal(queueMembership({ ...base, snoozeUntil: null, reasons: [{ at: "2026-11-06T00:00:00.000Z", summary: "New note.", type: "note" }] }), true);
});

test("an unreviewed active site stays queued, and a dropped site stays out of the viable queue", () => {
  const rows = buildQueue({
    sites: [row("open"), row("dropped", { stageGroup: "dropped", active: false })],
    reasons: {},
    reviewedAt: {},
    snoozeUntil: {},
    flagged: new Set(),
    mentioned: new Set(),
    assigned: new Set(),
    needsApproval: new Set(),
    today: "2026-11-05",
    filters: { viable: true, market: "all" },
  });
  assert.deepEqual(rows.map((item) => item.siteId), ["open"]);
  assert.equal(rows[0]?.reasons.length, 0);
  assert.equal(rows[0]?.firstVisit, true);
  assert.equal(rows[0]?.isNew, true);
});

test("assigned and mention filters keep the matching sites only", () => {
  const shared = {
    sites: [row("mine"), row("other")],
    reasons: {},
    reviewedAt: { mine: at, other: at },
    snoozeUntil: {},
    flagged: new Set<string>(),
    mentioned: new Set(["other"]),
    assigned: new Set(["mine"]),
    needsApproval: new Set<string>(),
    today: "2026-11-05",
  };
  assert.deepEqual(buildQueue({ ...shared, filters: { assignedOnly: true } }).map((item) => item.siteId), ["mine"]);
  assert.deepEqual(buildQueue({ ...shared, filters: { mentionsOnly: true } }).map((item) => item.siteId), ["other"]);
});
