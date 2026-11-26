import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { validateBatch, type Actor, type NdaPayload } from "../../lib/changes/schema";
import { ndaQueueAllowed, type NdaAgreement } from "../../lib/nda";
import { overlayNdaRegister } from "../../lib/ndaStore";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const AT = "2026-11-23T18:00:00-08:00";
const LATER = "2026-11-23T18:04:00-08:00";

function change(payload: Record<string, unknown>, expected = 0, source = "email") {
  return {
    changes: [{
      entity_type: "nda",
      site_id: "NDA-901",
      expected_version: expected,
      source,
      payload,
    }],
  };
}

const seed = {
  action: "edit",
  stage: "our_form_sent",
  court: "them",
  court_detail: "signer",
  owner: "sample-owner",
  next_step: "Wait for a reply.",
  next_step_due: "2026-11-30",
  document_url: "https://example.com/sample-doc",
  document_kind: "docusign",
  contact_name: "Sample Person",
  contact_email: "person@example.com",
  contact_phone: "ext 4",
  gmail_thread_ids: ["threadsample01"],
  covered_refs: ["PIPE-PHX-9101"],
  note: "Our form went out.",
  source_ref: "sample-message",
  at: AT,
};

function payloadOf(body: ReturnType<typeof validateBatch>): NdaPayload {
  const payload = body.changes[0]?.payload;
  if (!payload || !("action" in payload)) throw new Error("missing nda payload");
  return payload;
}

async function seeded() {
  const sql = await memorySql();
  await migrate(sql);
  const applied = await applyBatch(sql, muse, "nda-clear-seed", change(seed));
  assert.equal(applied.results[0]?.version, 1);
  return sql;
}

test("an absent dossier field keeps its value", async () => {
  const sql = await seeded();
  const applied = await applyBatch(sql, muse, "nda-clear-absent", change({
    action: "edit",
    next_step: "Send a reminder.",
    source_ref: "sample-message",
    at: LATER,
  }, 1));
  assert.equal(applied.results[0]?.version, 2);
  const row = await sql.query<{ document_url: string; contact_name: string; next_step: string; stage: string; last_action: string }>(
    `SELECT document_url, contact_name, next_step, stage, last_action FROM nda_state WHERE nda_id = 'NDA-901'`,
  );
  assert.equal(row.rows[0]?.document_url, "https://example.com/sample-doc");
  assert.equal(row.rows[0]?.contact_name, "Sample Person");
  assert.equal(row.rows[0]?.next_step, "Send a reminder.");
  assert.equal(row.rows[0]?.stage, "our_form_sent");
  assert.equal(row.rows[0]?.last_action, "Dossier updated");
  const history = await sql.query<{ status: string }>(`SELECT status FROM nda_history WHERE nda_id = 'NDA-901'`);
  assert.equal(history.rows.some((item) => item.status.startsWith("Cleared ")), false);
});

test("null clears a dossier field, bumps the version, and records the clear", async () => {
  const parsed = validateBatch(muse, "nda-clear-null-shape", change({
    action: "edit",
    document_url: null,
    source_ref: "sample-message-2",
    at: LATER,
  }, 1));
  assert.deepEqual(payloadOf(parsed).cleared, ["document_url"]);
  const sql = await seeded();
  const applied = await applyBatch(sql, muse, "nda-clear-null", change({
    action: "edit",
    document_url: null,
    source_ref: "sample-message-2",
    at: LATER,
  }, 1));
  assert.equal(applied.results[0]?.version, 2);
  const row = await sql.query<{
    document_url: string;
    document_kind: string;
    contact_name: string;
    stage: string;
    version: number | string;
    source_ref: string;
    last_action: string;
  }>(
    `SELECT document_url, document_kind, contact_name, stage, version, source_ref, last_action
     FROM nda_state WHERE nda_id = 'NDA-901'`,
  );
  assert.equal(row.rows[0]?.document_url, "");
  assert.equal(row.rows[0]?.document_kind, "docusign");
  assert.equal(row.rows[0]?.contact_name, "Sample Person");
  assert.equal(row.rows[0]?.stage, "our_form_sent");
  assert.equal(Number(row.rows[0]?.version), 2);
  assert.equal(row.rows[0]?.source_ref, "sample-message-2");
  assert.equal(row.rows[0]?.last_action, "Cleared document link");
  const history = await sql.query<{ status: string; note: string }>(
    `SELECT status, note FROM nda_history WHERE nda_id = 'NDA-901' AND status LIKE 'Cleared %'`,
  );
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0]?.status, "Cleared document link");
  const event = await sql.query<{ source: string; payload: { clear_note?: string; note?: string; cleared?: string[] } }>(
    `SELECT source, payload FROM events WHERE site_id = 'NDA-901' ORDER BY id DESC LIMIT 1`,
  );
  assert.equal(event.rows[0]?.source, "email");
  assert.equal(event.rows[0]?.payload.clear_note, "Cleared document link");
  assert.equal(event.rows[0]?.payload.note, "Cleared document link");
  assert.deepEqual(event.rows[0]?.payload.cleared, ["document_url"]);
  const due = await applyBatch(sql, muse, "nda-clear-due", change({
    action: "edit",
    next_step_due: null,
    source_ref: "sample-message-2",
    at: LATER,
  }, 2));
  assert.equal(due.results[0]?.version, 3);
  const dates = await sql.query<{ next_step_due: string | null; document_url: string; last_action: string }>(
    `SELECT to_char(next_step_due, 'YYYY-MM-DD') AS next_step_due, document_url, last_action
     FROM nda_state WHERE nda_id = 'NDA-901'`,
  );
  assert.equal(dates.rows[0]?.next_step_due, null);
  assert.equal(dates.rows[0]?.document_url, "");
  assert.equal(dates.rows[0]?.last_action, "Cleared next step due");
});

test("an empty string clears a string field and keeps the others", async () => {
  const parsed = validateBatch(muse, "nda-clear-blank-shape", change({
    action: "edit",
    next_step: "",
    contact_phone: "",
    source_ref: "",
    at: LATER,
  }, 1));
  assert.deepEqual(payloadOf(parsed).cleared, ["next_step", "contact_phone"]);
  const sql = await seeded();
  const applied = await applyBatch(sql, muse, "nda-clear-blank", change({
    action: "edit",
    next_step: "",
    contact_phone: "",
    source_ref: "",
    at: LATER,
  }, 1));
  assert.equal(applied.results[0]?.version, 2);
  const row = await sql.query<{ next_step: string; contact_phone: string; contact_email: string; document_url: string; source_ref: string; last_action: string }>(
    `SELECT next_step, contact_phone, contact_email, document_url, source_ref, last_action FROM nda_state WHERE nda_id = 'NDA-901'`,
  );
  assert.equal(row.rows[0]?.next_step, "");
  assert.equal(row.rows[0]?.contact_phone, "");
  assert.equal(row.rows[0]?.contact_email, "person@example.com");
  assert.equal(row.rows[0]?.document_url, "https://example.com/sample-doc");
  assert.equal(row.rows[0]?.source_ref, "sample-message");
  assert.equal(row.rows[0]?.last_action, "Cleared next step and contact phone");
});

test("an empty list or null clears an array and an omitted list stays", async () => {
  const empty = validateBatch(muse, "nda-clear-list-shape", change({
    action: "edit",
    gmail_thread_ids: [],
    source_ref: "sample-message",
    at: LATER,
  }, 1));
  assert.deepEqual(payloadOf(empty).cleared, ["gmail_thread_ids"]);
  const nulled = validateBatch(muse, "nda-clear-null-list-shape", change({
    action: "edit",
    covered_refs: null,
    source_ref: "sample-message",
    at: LATER,
  }, 1));
  assert.deepEqual(payloadOf(nulled).cleared, ["covered_refs"]);
  const sql = await seeded();
  const clearedThreads = await applyBatch(sql, muse, "nda-clear-threads", change({
    action: "edit",
    gmail_thread_ids: [],
    source_ref: "sample-message",
    at: LATER,
  }, 1));
  assert.equal(clearedThreads.results[0]?.version, 2);
  const afterThreads = await sql.query<{ gmail_thread_ids: string[]; covered_refs: string[]; last_action: string }>(
    `SELECT gmail_thread_ids, covered_refs, last_action FROM nda_state WHERE nda_id = 'NDA-901'`,
  );
  assert.deepEqual(afterThreads.rows[0]?.gmail_thread_ids, []);
  assert.deepEqual(afterThreads.rows[0]?.covered_refs, ["PIPE-PHX-9101"]);
  assert.equal(afterThreads.rows[0]?.last_action, "Cleared email threads");
  const clearedRefs = await applyBatch(sql, muse, "nda-clear-refs", change({
    action: "edit",
    covered_refs: null,
    source_ref: "sample-message",
    at: LATER,
  }, 2));
  assert.equal(clearedRefs.results[0]?.version, 3);
  const afterRefs = await sql.query<{ gmail_thread_ids: string[]; covered_refs: string[]; last_action: string }>(
    `SELECT gmail_thread_ids, covered_refs, last_action FROM nda_state WHERE nda_id = 'NDA-901'`,
  );
  assert.deepEqual(afterRefs.rows[0]?.gmail_thread_ids, []);
  assert.deepEqual(afterRefs.rows[0]?.covered_refs, []);
  assert.equal(afterRefs.rows[0]?.last_action, "Cleared covered references");
});

test("a contributor session still sees saved contact after a document clear", async () => {
  assert.equal(ndaQueueAllowed("contributor"), true);
  const sql = await memorySql();
  await migrate(sql);
  const id = "NDA-012";
  const write = (payload: Record<string, unknown>, expected: number, key: string) => ({
    changes: [{ entity_type: "nda", site_id: id, expected_version: expected, source: "email", payload }],
  });
  const seeded = await applyBatch(sql, muse, "nda-012-seed", write({ ...seed, at: AT }, 0, "nda-012-seed"));
  assert.equal(seeded.results[0]?.version, 1);
  const cleared = await applyBatch(sql, muse, "nda-012-clear", write({
    action: "edit",
    document_url: null,
    document_kind: null,
    note: "The link was removed.",
    source_ref: "sample-message",
    at: LATER,
  }, 1, "nda-012-clear"));
  assert.equal(cleared.results[0]?.version, 2);
  const register: NdaAgreement = {
    nda_id: id,
    counterparty_firm: "Sample Firm",
    counterparty_person: "Sample Person",
    scope: "",
    site_ids: "",
    nda_status: "Our form sent",
    nda_form: "",
    nda_waiting_on: "Them",
    nda_opened_date: "2026-11-01",
    nda_sent_date: "",
    nda_last_action_date: "2026-11-01",
    nda_waiting_on_since: "2026-11-01",
    nda_executed_date: "",
    nda_gates: "",
    nda_days_open: null,
    nda_days_in_court: null,
    source: "",
    notes: "",
  };
  const queue = await overlayNdaRegister(sql, [register]);
  const row = queue.find((item) => item.nda_id === id);
  assert.equal(row?.version, 2);
  assert.equal(row?.contact_email, "person@example.com");
  assert.equal(row?.contact_phone, "ext 4");
  assert.equal(row?.document_url, "");
  assert.equal(row?.history.some((item) => item.status === "Cleared document link and document kind"), true);
});

test("stage cannot be cleared and a clear still needs a source", () => {
  assert.throws(() => validateBatch(muse, "nda-clear-stage-null", change({
    action: "edit",
    stage: null,
    document_url: null,
    source_ref: "sample-message",
    at: LATER,
  }, 1)), /Stage cannot be cleared/);
  assert.throws(() => validateBatch(muse, "nda-clear-stage-blank", change({
    action: "edit",
    stage: "",
    source_ref: "sample-message",
    at: LATER,
  }, 1)), /Stage cannot be cleared/);
  assert.throws(() => validateBatch(muse, "nda-clear-no-source", change({
    action: "edit",
    document_url: "",
    source_ref: "sample-message",
    at: LATER,
  }, 1, " ")), /source/);
  const kept = validateBatch(muse, "nda-clear-stage-absent", change({
    action: "edit",
    document_url: null,
    source_ref: "sample-message",
    at: LATER,
  }, 1));
  assert.equal(payloadOf(kept).stage, "");
  assert.equal(payloadOf(kept).cleared?.includes("stage"), false);
});
