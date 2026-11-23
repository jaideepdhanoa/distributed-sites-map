import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { applyBatch } from "../../lib/changes/apply";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };
const stranger: Actor = { id: "other", kind: "agent" };
const AT = "2026-11-23T18:00:00-08:00";

function edit(actor: Actor, payload: Record<string, unknown>, id = "NDA-901") {
  return validateBatch(actor, "nda-agent", {
    changes: [{
      entity_type: "nda",
      site_id: id,
      expected_version: 0,
      source: "email",
      payload,
    }],
  });
}

test("an agent can write NDA dossier fields and an unknown field is refused", async () => {
  const payload = {
    action: "edit",
    stage: "our_form_sent",
    court: "them",
    court_detail: "signer",
    court_since: AT,
    owner: "sample-owner",
    next_step: "Wait for a reply.",
    next_step_due: "2026-11-30",
    document_url: "https://example.com/sample-doc",
    document_kind: "docusign",
    contact_name: "Sample Person",
    contact_email: "person@example.com",
    contact_phone: "ext 4",
    gmail_thread_ids: ["threadsample01"],
    covered_refs: ["PIPE-PHX-9101", "Confidential sample listing"],
    note: "Our form went out.",
    source_ref: "sample-message",
    at: AT,
  };
  assert.doesNotThrow(() => edit(muse, payload));
  assert.doesNotThrow(() => edit(indie, payload, "NDA-902"));
  assert.throws(() => edit(stranger, payload), /permission/);
  assert.throws(() => edit(muse, { ...payload, surprise: "no" }), /not accepted/);
  const sql = await memorySql();
  await migrate(sql);
  const applied = await applyBatch(sql, muse, "nda-agent-write", {
    changes: [{
      entity_type: "nda",
      site_id: "NDA-901",
      expected_version: 0,
      source: "email",
      payload,
    }],
  });
  assert.equal(applied.results[0]?.version, 1);
  const row = await sql.query<{ stage: string; court: string; updated_by: string; source_ref: string }>(
    `SELECT stage, court, updated_by, source_ref FROM nda_state WHERE nda_id = 'NDA-901'`,
  );
  assert.equal(row.rows[0]?.stage, "our_form_sent");
  assert.equal(row.rows[0]?.court, "them");
  assert.equal(row.rows[0]?.updated_by, "muse");
  assert.equal(row.rows[0]?.source_ref, "sample-message");
  assert.doesNotThrow(() => validateBatch(muse, "nda-comment", {
    changes: [{
      entity_type: "comment",
      site_id: "NDA-901",
      expected_version: 0,
      source: "email",
      payload: {
        at: AT,
        body: "Sample note on the agreement.",
        tag: "investigate",
        anchor: { type: "nda", line: "NDA-901" },
      },
    }],
  }));
});
