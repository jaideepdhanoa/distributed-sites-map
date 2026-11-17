import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { listNotes } from "../../lib/actions/notes";
import { InputError } from "../../lib/actions/text";
import { defaultPreferences } from "../../lib/alerts/preferences";
import { loadDigestBrief } from "../../lib/alerts/summary";
import { EXCLUDED_SITE_ID } from "../../lib/alerts/excluded";
import { applyBatch, VersionConflictError } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { brokerQuestionHasForbidden, chipLabel, suggestBrokerQuestion, type CommentAnchor } from "../../lib/comments/anchor";
import { commentLoops } from "../../lib/comments/loops";
import { buildPnlGrid } from "../../lib/pnl/grid";
import { sampleStatement } from "../../lib/pnl/fixture";
import { memorySql } from "../helpers/sql";

const contributor: Actor = { id: "contributor", kind: "human", role: "contributor" };
const reviewer: Actor = { id: "reviewer", kind: "human", role: "reviewer" };
const viewer: Actor = { id: "viewer", kind: "human", role: "viewer" };
const muse: Actor = { id: "muse", kind: "agent" };
const AT = "2026-03-01T15:00:00-07:00";
const LATER = "2026-03-02T16:30:00-07:00";

function comment(partial: Record<string, unknown> = {}, expected = 0, entityId?: string) {
  const payload: Record<string, unknown> = {
    anchor: { type: "pnl_cell", line: "ga", period: "2023" },
    body: "The sample line needs a second look.",
    tag: "investigate",
    at: AT,
  };
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) delete payload[key];
    else payload[key] = value;
  }
  return {
    entity_type: "comment",
    site_id: "PIPE-LAS-9001",
    expected_version: expected,
    ...(entityId ? { entity_id: entityId } : {}),
    source: "Sample notes",
    payload,
  };
}

function spaceChange() {
  return {
    entity_type: "site_space",
    site_id: "PIPE-LAS-9001",
    expected_version: 0,
    source: "Site aerial",
    payload: {
      center_lng: -115.1391,
      center_lat: 36.1699,
      length_ft: 90,
      width_ft: 60,
      rotation_deg: 15,
      type: "excess_parking",
      layout: "stalls_90",
    },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

test("a comment needs a signed-in writer, a real anchor, and an exact timestamp", () => {
  assert.throws(() => validateBatch(viewer, "k1", { changes: [comment()] }), /permission/);
  assert.throws(
    () => validateBatch(contributor, "k1", { changes: [comment({ at: "2026-03-01" })] }),
    (error: unknown) => error instanceof InputError && error.field === "at",
  );
  assert.throws(
    () => validateBatch(contributor, "k1", { changes: [comment({ at: undefined })] }),
    (error: unknown) => error instanceof InputError && error.field === "at",
  );
  assert.throws(() => validateBatch(contributor, "k1", { changes: [comment({ anchor: { type: "pnl_cell", line: "not-a-line", period: "2023" } })] }), /chart of accounts/);
  assert.doesNotThrow(() => validateBatch(contributor, "k1", { changes: [comment({ anchor: { type: "pnl_line", line: "total-revenue" } })] }));
  assert.doesNotThrow(() => validateBatch(contributor, "k1", { changes: [comment({ anchor: { type: "pnl_line", line: "margin" } })] }));
  assert.throws(() => validateBatch(contributor, "k1", { changes: [comment({ anchor: { type: "pnl_line", line: "ga", period: "2023" } })] }), /does not take a period/);
  assert.throws(() => validateBatch(contributor, "k1", { changes: [{ ...comment(), site_id: EXCLUDED_SITE_ID }] }), /not written here/);
  assert.throws(() => validateBatch(contributor, "k1", { changes: [comment({ resolved: true })] }), /after it exists/);
  assert.doesNotThrow(() => validateBatch(contributor, "k1", { changes: [comment()] }));
  assert.doesNotThrow(() => validateBatch(muse, "k1", { changes: [comment()] }));
});

test("the broker suggestion is a review draft and never uses the blocked wording", () => {
  const anchors: CommentAnchor[] = [
    { type: "pnl_cell", siteId: "PIPE-LAS-9001", line: "ga", period: "2023", spaceId: "", label: "" },
    { type: "pnl_line", siteId: "PIPE-LAS-9001", line: "utilities", period: "", spaceId: "", label: "" },
    { type: "space", siteId: "PIPE-LAS-9001", line: "", period: "", spaceId: "SS-000001", label: "Excess parking" },
    { type: "space", siteId: "PIPE-LAS-9001", line: "", period: "", spaceId: "SS-000001", label: "EV charging walk-away offer" },
  ];
  for (const anchor of anchors) {
    const text = suggestBrokerQuestion(anchor);
    assert.equal(brokerQuestionHasForbidden(text), false);
    assert.equal(/send|gmail|@/.test(text), false);
  }
  assert.equal(chipLabel(anchors[0]), "on P&L, G&A 2023");
  assert.equal(chipLabel(anchors[1]), "on P&L, Utilities");
  assert.equal(chipLabel({ type: "pnl_line", siteId: "PIPE-LAS-9001", line: "total-revenue", period: "", spaceId: "", label: "" }), "on P&L, Total revenue");
  assert.equal(chipLabel({ type: "pnl_cell", siteId: "PIPE-LAS-9001", line: "margin", period: "2024", spaceId: "", label: "" }), "on P&L, EBITDA margin 2024");
  assert.equal(chipLabel(anchors[2]), "on lot, Excess parking");
  assert.equal(chipLabel(anchors[3]), "on lot, marked lot");
});

test("a cell thread is one note, keeps the exact time, and a reply is the same thread", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, contributor, "comment-1", { changes: [comment()] });
  const id = created.results[0]?.entity_id || "";
  assert.match(id, /^NT-\d{6}$/);
  const notes = await listNotes(sql, "deal", "PIPE-LAS-9001");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.body, "The sample line needs a second look.");
  assert.equal(notes[0]?.createdAt, AT);
  assert.equal(notes[0]?.anchor?.type, "pnl_cell");
  assert.equal(notes[0]?.anchor?.line, "ga");
  assert.equal(notes[0]?.tag, "investigate");
  assert.equal(notes[0]?.brokerQuestion, null);
  const also = await listNotes(sql, "site", "PIPE-LAS-9001");
  assert.equal(also.length, 1);
  assert.equal(also[0]?.id, id);

  const reply = await applyBatch(sql, contributor, "comment-reply", {
    changes: [comment({ parent_id: id, body: "Looking at the sample line.", anchor: undefined, tag: undefined }, 0)],
  });
  assert.equal(reply.results[0]?.version, 1);
  const thread = await listNotes(sql, "deal", "PIPE-LAS-9001");
  assert.equal(thread.length, 2);
  assert.equal(thread.filter((note) => note.parentId === id).length, 1);
  assert.equal(thread.filter((note) => !note.parentId).length, 1);

  await assert.rejects(
    () => applyBatch(sql, contributor, "comment-resolve", {
      changes: [comment({ resolved: true, anchor: undefined, body: undefined, tag: undefined, at: LATER }, 1, id)],
    }),
    /reviewer/,
  );
  const resolved = await applyBatch(sql, reviewer, "comment-resolve-ok", {
    changes: [comment({ resolved: true, anchor: undefined, body: undefined, tag: undefined, at: LATER }, 1, id)],
  });
  assert.equal(resolved.results[0]?.version, 2);
  const closed = await listNotes(sql, "deal", "PIPE-LAS-9001");
  assert.equal(closed.find((note) => note.id === id)?.resolvedAt?.startsWith("2026-03-02"), true);

  const reopened = await applyBatch(sql, reviewer, "comment-reopen", {
    changes: [comment({ resolved: false, tag: "ask_broker", anchor: undefined, body: undefined, at: "2026-03-03T12:00:00Z" }, 2, id)],
  });
  assert.equal(reopened.results[0]?.version, 3);
  const open = (await listNotes(sql, "deal", "PIPE-LAS-9001")).find((note) => note.id === id);
  assert.equal(open?.resolvedAt, null);
  assert.equal(open?.tag, "ask_broker");
  assert.equal(open?.brokerQuestion, "Could you confirm how G&A was recorded for 2023?");
  assert.equal(brokerQuestionHasForbidden(open?.brokerQuestion || ""), false);

  const events = await sql.query<{ payload: { at?: string; body?: string; anchor?: { line?: string } } }>(
    `SELECT payload FROM events WHERE entity_type = 'comment' AND entity_id = $1 ORDER BY id`,
    [id],
  );
  assert.equal(events.rows.length, 3);
  assert.equal(events.rows[0]?.payload.at, AT);
  assert.equal(events.rows[0]?.payload.body, undefined);
  assert.equal(events.rows[2]?.payload.at, "2026-03-03T12:00:00Z");

  const comms = await sql.query<{ count: string }>(`SELECT count(*)::text AS count FROM comms_entries`);
  assert.equal(comms.rows[0]?.count, "0");

  await assert.rejects(
    () => applyBatch(sql, contributor, "comment-stale", {
      changes: [comment({ tag: "explained", anchor: undefined, body: undefined, at: LATER }, 1, id)],
    }),
    (error: unknown) => error instanceof VersionConflictError && error.conflicts[0]?.actual_version === 3,
  );
});

test("open threads mark the cell, the lot, the open loops, and the brief count", async () => {
  const sql = await ready();
  await applyBatch(sql, contributor, "space-1", { changes: [spaceChange()] });
  await applyBatch(sql, contributor, "comment-cell", { changes: [comment({ anchor: { type: "pnl_cell", line: "labor", period: "2024" } })] });
  await applyBatch(sql, contributor, "comment-line", {
    changes: [comment({ anchor: { type: "pnl_line", line: "chemicals" }, body: "The sample chemicals line is thin." })],
  });
  await applyBatch(sql, contributor, "comment-lot", {
    changes: [comment({
      anchor: { type: "space", space_id: "SS-000001" },
      body: "The east row needs a second look.",
    })],
  });

  const grid = buildPnlGrid(sampleStatement(), "years", 2024, [], [
    { type: "pnl_cell", line: "labor", period: "2024" },
    { type: "pnl_line", line: "chemicals", period: "" },
  ]);
  const labor = grid.rows.find((row) => row.id === "labor");
  assert.equal(labor?.cells.some((cell) => cell.commentOpen), true);
  assert.equal(grid.rows.find((row) => row.id === "chemicals")?.commentOpen, true);
  assert.equal(grid.rows.find((row) => row.id === "addback_owner_pay")?.cells.some((cell) => cell.commentOpen), false);

  const loops = await commentLoops(sql);
  assert.equal(loops.length, 3);
  assert.equal(loops.some((loop) => loop.detail.includes("The sample")), false);
  assert.equal(loops.some((loop) => loop.detail.includes("on P&L, Labor 2024")), true);
  assert.equal(loops.some((loop) => loop.detail.includes("on lot, Excess parking")), true);
  assert.equal(loops.some((loop) => /[0-9a-f]{16}/i.test(loop.detail)), false);

  const brief = await loadDigestBrief(sql, {
    userId: "reviewer",
    since: new Date("2026-01-01T00:00:00.000Z"),
    prefs: defaultPreferences("reviewer"),
  });
  assert.equal(brief.counts.threads, 3);
  const line = brief.items.find((item) => item.summary.includes("comment thread"));
  assert.equal(line?.summary, "3 open comment threads.");
  assert.equal(brief.items.some((item) => item.summary.includes("sample line")), false);

  const lot = await sql.query<{ anchor_label: string }>(
    `SELECT anchor_label FROM notes WHERE anchor_type = 'space'`,
  );
  assert.equal(lot.rows[0]?.anchor_label, "Excess parking");
});
