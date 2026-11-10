import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { seesRecommendations, showSuggestedBlock, RECOMMENDATION_RECIPIENTS, canReadFinancials, FINANCIALS_ROLES } from "../../lib/agent/access";
import { authorizeInbox } from "../../lib/agent/auth";
import { applySuggestedDraft } from "../../lib/agent/draft";
import { ackInbox, ingestDecision, ingestNote, listInbox, toFeedItem, type InboxItem } from "../../lib/agent/inbox";
import { feedOrigin } from "../../lib/agent/links";
import { addRecommendation, listVisibleRecommendations, parseRecommendation, presentRecommendation } from "../../lib/agent/recommend";
import { migrate } from "../../lib/actions/migrate";
import { createNote } from "../../lib/actions/notes";
import type { RecordLookup } from "../../lib/actions/records";
import { createSuggestion, decideSuggestion } from "../../lib/actions/suggestions";
import { PolicyError } from "../../lib/policy/banned";
import { proxy } from "../../proxy";
import { memorySql } from "../helpers/sql";
import { GET as pullInbox } from "../../lib/api/handlers/agent/inbox";
import { POST as ackRoute } from "../../lib/api/handlers/agent/inbox-ack";
import { POST as recommendRoute } from "../../lib/api/handlers/agent/inbox-recommendation";

const lookup: RecordLookup = (kind, id) => {
  if (kind === "deal" && id === "PIPE-PHX-0008") return { deal_id: "PIPE-PHX-0008", name: "Sample deal", stage: "1 Desk screen" };
  if (kind === "site" && id === "PHX-U180") return { site_id: "PHX-U180", name: "Sample site", linked_deal_id: "" };
  return null;
};

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

function blockedWord(): string {
  const file = JSON.parse(readFileSync("config/display-policy.json", "utf8")) as { words: string[] };
  const word = file.words
    .map((item) => Buffer.from(item, "base64").toString("utf8").replace(/^term:/, ""))
    .find((item) => item.length >= 6);
  if (!word) throw new Error("missing term");
  return word;
}

function draft(over: Record<string, unknown> = {}) {
  return {
    kind: "reply",
    draft_text: "The driveway is the tight part.",
    decision: "none",
    rationale: "It answers the note about the frontage.",
    sources: [{ label: "Discussion", url: "/?site=PIPE-PHX-0008&panel=discussion" }],
    confidence: "medium",
    model: "muse",
    ...over,
  };
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("an inbox event is stored once and a later reply supersedes the open row", async () => {
  const sql = await ready();
  await ingestNote(sql, {
    noteId: "note-1",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    body: "The frontage needs another look.",
    authorId: "cindel",
    parentId: null,
    mentionIds: ["jaideep"],
  });
  await ingestNote(sql, {
    noteId: "note-1",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    body: "The frontage needs another look.",
    authorId: "cindel",
    parentId: null,
    mentionIds: ["jaideep"],
  });
  const first = await listInbox(sql, {});
  assert.equal(first.items.length, 2);
  assert.deepEqual(first.items.map((item) => item.kind).sort(), ["mention", "note"]);
  assert.equal(first.items.every((item) => item.status === "new"), true);
  const keys = await sql.query<{ idempotency_key: string }>(`SELECT idempotency_key FROM agent_inbox ORDER BY idempotency_key`);
  assert.deepEqual(keys.rows.map((row) => row.idempotency_key), ["mention:note-1", "note:note-1"]);

  await ingestNote(sql, {
    noteId: "note-2",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    body: "The driveway is the tight part.",
    authorId: "ming",
    parentId: "note-1",
    mentionIds: [],
  });
  const second = await listInbox(sql, { limit: 10 });
  const note = second.items.find((item) => item.kind === "note");
  const reply = second.items.find((item) => item.kind === "reply");
  assert.equal(note?.status, "superseded");
  assert.equal(reply?.status, "new");
  assert.equal(reply?.text, "The driveway is the tight part.");
  assert.equal(reply?.threadKey, "note:note-1");
  const page = await listInbox(sql, { limit: 1 });
  assert.equal(page.items.length, 1);
  const rest = await listInbox(sql, { after: page.next, limit: 10 });
  assert.equal(rest.items.length, 2);
  assert.equal(rest.items.some((item) => item.id === page.items[0].id), false);
});

test("ack moves new rows to picked or done and leaves superseded rows", async () => {
  const sql = await ready();
  await ingestNote(sql, {
    noteId: "note-1", siteId: "PIPE-PHX-0008", body: "A note.", authorId: "cindel", parentId: null, mentionIds: [],
  });
  const open = await listInbox(sql, {});
  assert.equal(await ackInbox(sql, { ids: [open.items[0].id], status: "picked" }), 1);
  assert.equal((await listInbox(sql, {})).items[0].status, "picked");
  assert.equal(await ackInbox(sql, { ids: [open.items[0].id], status: "done" }), 1);
  await sql.query(`UPDATE agent_inbox SET status = 'superseded' WHERE id = $1`, [open.items[0].id]);
  assert.equal(await ackInbox(sql, { ids: [open.items[0].id], status: "picked" }), 0);
  assert.equal((await listInbox(sql, {})).items[0].status, "superseded");
});

test("bearer auth is the agent secret on every agent route", async () => {
  const previousAgent = process.env.AGENT_INBOX_SECRET;
  const previousCron = process.env.CRON_SECRET;
  process.env.AGENT_INBOX_SECRET = "";
  process.env.CRON_SECRET = "cron-secret";
  try {
    assert.equal(authorizeInbox(new Request("http://local/api/agent/inbox")), false);
    assert.equal((await pullInbox(new Request("http://local/api/agent/inbox"))).status, 401);
    assert.equal((await ackRoute(new Request("http://local/api/agent/inbox/ack", { method: "POST", body: "{}" }))).status, 401);
    assert.equal((await recommendRoute(new Request("http://local/api/agent/inbox/x/recommendation", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "inbox-row-1" }) })).status, 401);

    process.env.AGENT_INBOX_SECRET = "agent-secret";
    const cron = { authorization: "Bearer cron-secret" };
    assert.equal(authorizeInbox(new Request("http://local/api/agent/inbox", { headers: cron })), false);
    assert.equal((await pullInbox(new Request("http://local/api/agent/inbox", { headers: cron }))).status, 401);
    assert.equal((await ackRoute(new Request("http://local/api/agent/inbox/ack", { method: "POST", headers: { ...cron, "content-type": "application/json" }, body: JSON.stringify({ ids: ["a"], status: "picked" }) }))).status, 401);
    assert.equal((await recommendRoute(
      new Request("http://local/api/agent/inbox/inbox-row-1/recommendation", { method: "POST", headers: { ...cron, "content-type": "application/json" }, body: JSON.stringify(draft()) }),
      { params: Promise.resolve({ id: "inbox-row-1" }) },
    )).status, 401);
    assert.equal(authorizeInbox(new Request("http://local/api/agent/inbox", { headers: { authorization: "Bearer agent-secret" } })), true);
  } finally {
    if (previousAgent === undefined) delete process.env.AGENT_INBOX_SECRET;
    else process.env.AGENT_INBOX_SECRET = previousAgent;
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  }
});

test("the session proxy lets the bearer reach the agent routes", async () => {
  const response = await proxy(new NextRequest("http://local/api/agent/inbox", { headers: { authorization: "Bearer agent-secret" } }));
  assert.notEqual(response.status, 401);
});

test("a recommendation is rejected once the proposal is closed", async () => {
  const sql = await ready();
  const suggestion = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    detail: "work_item",
    title: "Order the survey",
    proposedValue: "Order the survey",
    reason: "",
    authorId: "writer",
  }, lookup);
  const inbox = await listInbox(sql, {});
  const row = inbox.items.find((item) => item.kind === "suggestion");
  assert.ok(row);
  await sql.query(`UPDATE suggestions SET status = 'rejected' WHERE id = $1`, [suggestion.id]);
  await assert.rejects(() => addRecommendation(sql, row.id, parseRecommendation(draft({ kind: "decision", decision: "approve" }))), /no longer open/);
});

test("a superseded inbox row rejects a new recommendation", async () => {
  const sql = await ready();
  await ingestNote(sql, {
    noteId: "note-1", siteId: "PIPE-PHX-0008", body: "A note.", authorId: "cindel", parentId: null, mentionIds: [],
  });
  const row = (await listInbox(sql, {})).items[0];
  await sql.query(`UPDATE agent_inbox SET status = 'superseded' WHERE id = $1`, [row.id]);
  await assert.rejects(() => addRecommendation(sql, row.id, parseRecommendation(draft())), /superseded/);
  await assert.rejects(async () => parseRecommendation(draft({ draft_text: `See ${blockedWord()}` })), PolicyError);
  await assert.rejects(async () => parseRecommendation(draft({ sources: [] })), /source/);
});

test("only jaideep is offered a suggested block, and use this does not post", async () => {
  assert.deepEqual(RECOMMENDATION_RECIPIENTS, ["jaideep"]);
  assert.equal(seesRecommendations("jaideep"), true);
  assert.equal(seesRecommendations("Jaideep"), true);
  assert.equal(seesRecommendations("cindel"), false);
  const row = { id: "rec-1", draftText: "The driveway is the tight part." };
  assert.deepEqual(showSuggestedBlock("cindel", [row]), []);
  assert.equal(showSuggestedBlock("jaideep", [row]).length, 1);

  const sql = await ready();
  await ingestNote(sql, {
    noteId: "note-1", siteId: "PIPE-PHX-0008", recordId: "PIPE-PHX-0008", body: "A note.", authorId: "cindel", parentId: null, mentionIds: [],
  });
  const inboxId = (await listInbox(sql, {})).items[0].id;
  const recommendationId = await addRecommendation(sql, inboxId, parseRecommendation(draft()));
  assert.deepEqual(await listVisibleRecommendations(sql, "cindel", "PIPE-PHX-0008"), []);
  const visible = await listVisibleRecommendations(sql, "jaideep", "PIPE-PHX-0008");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].draftText, "The driveway is the tight part.");
  const linked = presentRecommendation(visible[0], "https://distributedsites.com");
  assert.equal(linked.siteId, "PIPE-PHX-0008");
  assert.equal(linked.siteUrl, "https://distributedsites.com/?site=PIPE-PHX-0008&panel=discussion");

  const filled = applySuggestedDraft(visible[0].draftText);
  assert.equal(filled.posted, false);
  assert.equal(filled.composer, visible[0].draftText);
  const block = readFileSync("components/agent/SuggestedBlock.tsx", "utf8");
  assert.match(block, /applySuggestedDraft/);
  assert.match(block, /data-testid="suggested-site"/);
  assert.equal(block.includes("/api/actions/notes"), false);
  assert.equal(block.includes("decideSuggestion"), false);

  const root = await createNote(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    body: "The frontage needs another look.",
    authorId: "cindel",
  }, lookup);
  const replyInbox = (await listInbox(sql, {})).items.find((item) => item.kind === "note" && item.refId === root.id);
  assert.ok(replyInbox);
  const replyRecommendation = await addRecommendation(sql, replyInbox.id, parseRecommendation(draft()));
  const asJaideep = await createNote(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    parentId: root.id,
    body: filled.composer,
    authorId: "jaideep",
    recommendationId: replyRecommendation,
  }, lookup);
  const stored = await sql.query<{ recommendation_id: string | null; drafted_by_agent: string | null }>(
    `SELECT recommendation_id, drafted_by_agent FROM notes WHERE id = $1`,
    [asJaideep.id],
  );
  assert.equal(stored.rows[0].recommendation_id, replyRecommendation);
  assert.equal(stored.rows[0].drafted_by_agent, "muse");
  const asOther = await createNote(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    body: "A separate note.",
    authorId: "cindel",
    recommendationId,
  }, lookup);
  const other = await sql.query<{ recommendation_id: string | null; drafted_by_agent: string | null }>(
    `SELECT recommendation_id, drafted_by_agent FROM notes WHERE id = $1`,
    [asOther.id],
  );
  assert.equal(other.rows[0].recommendation_id, null);
  assert.equal(other.rows[0].drafted_by_agent, null);
});

test("Jaideep approving a stage move emits a workbook decision", async () => {
  const sql = await ready();
  const suggestion = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    detail: "stage_move",
    proposedValue: "financial",
    reason: "",
    authorId: "writer",
  }, lookup);
  await decideSuggestion(sql, { id: suggestion.id, status: "accepted", actorId: "jaideep", note: "Move it forward." });
  const items = await listInbox(sql, {});
  const decision = items.items.find((item) => item.kind === "decision");
  const proposal = items.items.find((item) => item.kind === "suggestion");
  assert.equal(proposal?.status, "superseded");
  assert.equal(decision?.status, "new");
  assert.equal(decision?.workbookStage, true);
  assert.equal(decision?.stage, "financial");
  assert.match(decision?.text || "", /Financial screen/);
  assert.match(decision?.text || "", /workbook Stage/);

  const other = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    field: "proposed_next_step",
    detail: "stage_move",
    proposedValue: "checks",
    reason: "",
    authorId: "writer",
  }, lookup);
  await decideSuggestion(sql, { id: other.id, status: "accepted", actorId: "editor" });
  const again = await listInbox(sql, {});
  const editorDecision = again.items.find((item) => item.refId === other.id && item.kind === "decision");
  assert.equal(editorDecision?.workbookStage, false);
  assert.equal(editorDecision?.stage, null);
});

test("agent routes never post, approve, reject, resolve, or assign", () => {
  const source = filesUnder("lib/api/handlers/agent").map((path) => readFileSync(path, "utf8")).join("\n");
  assert.equal(/createNote|decideSuggestion|resolveNote|flagSite|completeSuggestion/.test(source), false);
});

test("financials access is an explicit role list that still includes every signed-in role", () => {
  assert.deepEqual(FINANCIALS_ROLES, ["viewer", "contributor", "reviewer"]);
  assert.equal(canReadFinancials("viewer"), true);
  assert.equal(canReadFinancials("contributor"), true);
  assert.equal(canReadFinancials("reviewer"), true);
  assert.equal(canReadFinancials("guest"), false);
  const route = readFileSync("lib/api/handlers/data/financials-id.ts", "utf8");
  assert.match(route, /canReadFinancials\(session\.actionRole\)/);
});

test("a feed item links to the site and panel for that kind", () => {
  const previous = process.env.APP_URL;
  delete process.env.APP_URL;
  try {
    const note = {
      id: "row-1",
      kind: "note",
      subtype: null,
      refId: "note-1",
      siteId: "PIPE-PHX-0008",
      recordId: "PIPE-PHX-0008",
      actor: "cindel",
      text: "The frontage needs another look.",
      threadKey: "note:note-1",
      threadContext: "",
      proposalId: null,
      proposalStatus: null,
      stage: null,
      workbookStage: false,
      status: "new",
      createdAt: "2026-01-02T15:00:00.000Z",
      cursor: "opaque",
    } satisfies InboxItem;
    assert.equal(toFeedItem(note).site_url, "https://distributedsites.com/?site=PIPE-PHX-0008&panel=discussion");
    assert.equal(toFeedItem({ ...note, kind: "reply" }).site_url, "https://distributedsites.com/?site=PIPE-PHX-0008&panel=discussion");
    assert.equal(toFeedItem({ ...note, kind: "mention" }).site_url, "https://distributedsites.com/?site=PIPE-PHX-0008&panel=discussion");
    assert.equal(toFeedItem({ ...note, kind: "suggestion" }).site_url, "https://distributedsites.com/?site=PIPE-PHX-0008&panel=proposal");
    assert.equal(toFeedItem({ ...note, kind: "decision" }).site_url, "https://distributedsites.com/?site=PIPE-PHX-0008&panel=proposal");
    assert.equal(toFeedItem({ ...note, kind: "flag" }).site_url, "https://distributedsites.com/?view=review&site=PIPE-PHX-0008");
    assert.equal(toFeedItem({ ...note, kind: "ask_gap", siteId: "portfolio" }).site_url, "https://distributedsites.com/");
    assert.equal(
      toFeedItem(note, feedOrigin(new Request("http://internal/api/agent/inbox", {
        headers: { "x-forwarded-host": "preview.distributedsites.com", "x-forwarded-proto": "https" },
      }))).site_url,
      "https://preview.distributedsites.com/?site=PIPE-PHX-0008&panel=discussion",
    );
    process.env.APP_URL = "https://configured.example/";
    assert.equal(feedOrigin(), "https://configured.example");
    assert.equal(
      feedOrigin(new Request("https://distributedsites.com/api/agent/inbox")),
      "https://distributedsites.com",
    );
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});

test("ingestDecision is callable for a rejected proposal", async () => {
  const sql = await ready();
  const suggestion = await createSuggestion(sql, {
    targetKind: "deal",
    targetId: "PIPE-PHX-0008",
    field: "flag",
    proposedValue: "aside",
    reason: "Needs another look.",
    authorId: "writer",
  }, lookup);
  await decideSuggestion(sql, { id: suggestion.id, status: "rejected", actorId: "jaideep", note: "Not now." });
  const decision = (await listInbox(sql, {})).items.find((item) => item.kind === "decision");
  assert.equal(decision?.proposalStatus, "rejected");
  assert.equal(decision?.workbookStage, false);
  await ingestDecision(sql, {
    id: suggestion.id,
    status: "rejected",
    actorId: "jaideep",
    note: "Not now.",
    siteId: "PIPE-PHX-0008",
    recordId: "PIPE-PHX-0008",
    field: "flag",
    detail: null,
    title: null,
    proposedValue: "aside",
    reason: "Needs another look.",
  });
  const rows = await sql.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_inbox WHERE kind = 'decision' AND ref_id = $1`, [suggestion.id]);
  assert.equal(Number(rows.rows[0].n), 1);
});
