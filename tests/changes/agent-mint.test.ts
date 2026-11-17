import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { syncEventFeed } from "../../lib/agent/eventFeed";
import { notifyAppliedChanges } from "../../lib/alerts/agentWrite";
import { loadDigestBrief } from "../../lib/alerts/summary";
import { defaultPreferences } from "../../lib/alerts/preferences";
import { applyBatch, mintSitePair, raiseIdFloor } from "../../lib/changes/apply";
import { rememberSheetIdFloors } from "../../lib/changes/backfill";
import { labeledFloorsFromTable, planCreatedSiteMirror, planUniverseMirror, type SheetTable } from "../../lib/changes/mirror";
import { AGENT_STAGE_DECISION_SOURCE, RECEIPT_ACTIVITY_SUMMARY, validateBatch, type Actor } from "../../lib/changes/schema";
import { emptySiteFields, type SiteRow } from "../../lib/changes/site";
import { InputError } from "../../lib/actions/text";
import { memorySql } from "../helpers/sql";

const muse: Actor = { id: "muse", kind: "agent" };
const indie: Actor = { id: "indie", kind: "agent" };
const reviewer: Actor = { id: "jaideep", kind: "human", role: "reviewer" };
const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };

const RECEIVED = "2026-03-01T15:04:00-07:00";

function receipt(extra: Record<string, string> = {}) {
  return {
    document: "sample-package.pdf",
    received_at: RECEIVED,
    comms_id: "CM-9001",
    ...extra,
  };
}

function stageMove(siteId: string, version: number, body: Record<string, unknown> = {}) {
  return {
    entity_type: "stage",
    site_id: siteId,
    expected_version: version,
    source: "Sample package",
    payload: { stage: "2 Financial screen", market: "PHX", receipt: receipt(), ...body },
  };
}

function createChange(listingId: string, payload: Record<string, unknown> = {}) {
  return {
    entity_type: "site",
    expected_version: 0,
    source: "Sample listing",
    payload: {
      kind: "pipeline",
      market: "PHX",
      listing_id: listingId,
      name: "Sample Wash",
      category: "Car wash",
      broker: "Sample Broker",
      listing_url: "https://example.com/listing/9001",
      sources: {
        name: "Sample listing",
        market: "Sample listing",
        category: "Sample listing",
        broker: "Sample listing",
        listing_url: "Sample listing",
      },
      ...payload,
    },
  };
}

async function ready() {
  const sql = await memorySql();
  await migrate(sql);
  return sql;
}

async function deskSite(sql: Awaited<ReturnType<typeof ready>>, siteId = "PIPE-PHX-0001") {
  await applyBatch(sql, contributor, `desk-${siteId}`, {
    changes: [
      {
        entity_type: "site",
        site_id: siteId,
        expected_version: 0,
        source: "Sample listing",
        payload: { name: "Sample Wash", market: "PHX" },
      },
    ],
  });
}

test("an agent moves Desk screen to Financial screen only with a package receipt", async () => {
  assert.throws(() => validateBatch(muse, "missing", { changes: [stageMove("PIPE-PHX-0001", 1, { receipt: undefined })] }), /package receipt/);
  assert.throws(
    () => validateBatch(muse, "gmail-doc", { changes: [stageMove("PIPE-PHX-0001", 1, { receipt: receipt({ document: "0123456789abcdef" }) })] }),
    /not a Gmail id/,
  );
  assert.throws(
    () => validateBatch(muse, "bad-time", { changes: [stageMove("PIPE-PHX-0001", 1, { receipt: receipt({ received_at: "2026-03-01" }) })] }),
    /zone offset/,
  );
  assert.throws(
    () =>
      validateBatch(muse, "no-cite", {
        changes: [stageMove("PIPE-PHX-0001", 1, { receipt: { document: "sample-package.pdf", received_at: RECEIVED } })],
      }),
    /comms id or an email date/,
  );
  assert.throws(
    () => validateBatch(muse, "drop", { changes: [stageMove("PIPE-PHX-0001", 1, { stage: "Dropped", reason: "Sample reason" })] }),
    (error: unknown) => {
      assert.equal(error instanceof InputError && error.status, 403);
      assert.match(String(error), /cannot set Stage to Dropped/);
      return true;
    },
  );
  for (const [key, name] of [
    ["desk", "1 Desk screen"],
    ["checks", "3 Site checks"],
    ["offer", "4 Offer and close"],
  ] as const) {
    assert.throws(
      () => validateBatch(muse, `no-${key}`, { changes: [stageMove("PIPE-PHX-0001", 1, { stage: name, receipt: receipt() })] }),
      /only move a site from Desk screen to Financial screen/,
    );
  }
  assert.doesNotThrow(() =>
    validateBatch(muse, "email-date", {
      changes: [stageMove("PIPE-PHX-0001", 1, { receipt: { document: "sample-drive-file", received_at: RECEIVED, email_date: "2026-03-01" } })],
    }),
  );
  assert.doesNotThrow(() => validateBatch(reviewer, "human", { changes: [stageMove("PIPE-PHX-0001", 1, { receipt: undefined, stage: "3 Site checks" })] }));

  const sql = await ready();
  await deskSite(sql);
  await assert.rejects(
    () => applyBatch(sql, muse, "not-desk", { changes: [stageMove("PIPE-PHX-0099", 0)] }),
    /only move a site from Desk screen to Financial screen/,
  );
  await applyBatch(sql, reviewer, "to-checks", {
    changes: [{ ...stageMove("PIPE-PHX-0001", 1, { receipt: undefined, stage: "3 Site checks" }) }],
  });
  await assert.rejects(
    () => applyBatch(sql, muse, "from-checks", { changes: [stageMove("PIPE-PHX-0001", 2)] }),
    /only move a site from Desk screen to Financial screen/,
  );
  const stayed = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = $1", ["PIPE-PHX-0001"]);
  assert.equal(stayed.rows[0]?.stage, "3 Site checks");

  await deskSite(sql, "PIPE-LAS-0002");
  const moved = await applyBatch(sql, muse, "receipt-move", { changes: [stageMove("PIPE-LAS-0002", 1, { market: "LAS" })] });
  assert.equal(moved.replayed, false);
  const stage = await sql.query<{ stage: string; version: number | string }>("SELECT stage, version FROM site_stages WHERE site_id = $1", ["PIPE-LAS-0002"]);
  assert.equal(stage.rows[0]?.stage, "2 Financial screen");
  assert.equal(Number(stage.rows[0]?.version), 2);
  const event = await sql.query<{ source: string; payload: { decision_source?: string; receipt?: { comms_id?: string }; cited_source?: string } }>(
    `SELECT source, payload FROM events WHERE entity_type = 'stage' AND site_id = $1 ORDER BY created_at DESC LIMIT 1`,
    ["PIPE-LAS-0002"],
  );
  assert.equal(event.rows[0]?.source, AGENT_STAGE_DECISION_SOURCE);
  assert.equal(event.rows[0]?.payload.decision_source, "agent");
  assert.equal(event.rows[0]?.payload.receipt?.comms_id, "CM-9001");
  assert.equal(event.rows[0]?.payload.cited_source, "Sample package");
  const activity = await sql.query<{ summary: string; source_link: string; type: string }>(
    `SELECT payload->>'summary' AS summary, payload->>'source_link' AS source_link, payload->>'type' AS type
     FROM activities WHERE site_id = $1 AND payload->>'summary' = $2`,
    ["PIPE-LAS-0002", RECEIPT_ACTIVITY_SUMMARY],
  );
  assert.equal(activity.rows[0]?.summary, RECEIPT_ACTIVITY_SUMMARY);
  assert.equal(activity.rows[0]?.type, "stage");
  assert.match(activity.rows[0]?.source_link || "", /sample-package\.pdf/);
  assert.match(activity.rows[0]?.source_link || "", /CM-9001/);
  assert.equal((activity.rows[0]?.source_link || "").includes("0123456789abcdef"), false);

  const feed = await syncEventFeed(sql);
  assert.equal(feed.projected > 0, true);
  const inbox = await sql.query<{ body: string }>(`SELECT body FROM agent_inbox WHERE site_id = $1`, ["PIPE-LAS-0002"]);
  assert.equal(inbox.rows.some((row) => row.body === "Moved to Financial screen on package receipt."), true);
  const brief = await loadDigestBrief(sql, {
    userId: "jaideep",
    since: new Date(Date.now() - 60_000),
    prefs: defaultPreferences("reviewer"),
  });
  assert.equal(brief.items.some((item) => item.summary === "Moved to Financial screen on package receipt."), true);
  assert.equal(brief.counts.stages >= 1, true);

  const previousUsers = process.env.AUTH_USERS;
  process.env.AUTH_USERS = JSON.stringify([
    { u: "jaideep", h: "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk", role: "user", actionRole: "reviewer", name: "Jaideep", email: "jaideep@example.com" },
  ]);
  try {
    const stageResult = moved.results.find((row) => row.entity_type === "stage" && row.site_id === "PIPE-LAS-0002");
    await notifyAppliedChanges(sql, muse, [{ entity_type: "stage", site_id: "PIPE-LAS-0002", event_id: stageResult?.event_id || "" }]);
    const mail = await sql.query<{ summary: string; user_id: string }>(
      `SELECT summary, user_id FROM alert_outbox WHERE site_id = $1`,
      ["PIPE-LAS-0002"],
    );
    assert.equal(mail.rows.some((row) => row.user_id === "jaideep" && row.summary === "Moved to Financial screen on package receipt."), true);
    assert.equal(mail.rows.some((row) => row.summary.includes("without an approved decision")), false);
  } finally {
    if (previousUsers == null) delete process.env.AUTH_USERS;
    else process.env.AUTH_USERS = previousUsers;
  }
});

test("server mint sequences above stored ids and the workbook counter, and a listing retry is stable", async () => {
  const sql = await ready();
  const first = await applyBatch(sql, muse, "create-1", { changes: [createChange("L-9001")] });
  const created = first.results.find((row) => row.entity_type === "site");
  assert.equal(created?.site_id, "PIPE-PHX-0001");
  assert.equal(created?.universe_id, "WB-PHX-0001");
  assert.equal(created?.listing_id, "L-9001");
  const replay = await applyBatch(sql, muse, "create-1", { changes: [createChange("L-9001")] });
  assert.equal(replay.replayed, true);
  assert.equal(replay.results.find((row) => row.entity_type === "site")?.site_id, "PIPE-PHX-0001");

  const again = await applyBatch(sql, muse, "create-1b", { changes: [createChange("L-9001")] });
  assert.equal(again.results.find((row) => row.entity_type === "site")?.site_id, "PIPE-PHX-0001");
  assert.equal(again.results.find((row) => row.entity_type === "site")?.universe_id, "WB-PHX-0001");
  const rows = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM sites");
  assert.equal(Number(rows.rows[0]?.n), 1);
  const added = await sql.query<{ n: number | string }>(
    `SELECT count(*)::int AS n FROM activities WHERE payload->>'summary' = 'Site added'`,
  );
  assert.equal(Number(added.rows[0]?.n), 1);
  await assert.rejects(
    () => applyBatch(sql, muse, "create-other", { changes: [createChange("L-9001", { name: "Other Sample" })] }),
    /already used for a different site/,
  );

  const second = await applyBatch(sql, muse, "create-2", { changes: [createChange("L-9002")] });
  assert.equal(second.results.find((row) => row.entity_type === "site")?.site_id, "PIPE-PHX-0002");
  assert.equal(second.results.find((row) => row.entity_type === "site")?.universe_id, "WB-PHX-0002");

  await raiseIdFloor(sql, "PIPE:PHX", 40);
  await raiseIdFloor(sql, "WB:PHX", 12);
  const jumped = await applyBatch(sql, indie, "create-3", { changes: [createChange("L-9003", { kind: "pipeline" })] });
  assert.equal(jumped.results.find((row) => row.entity_type === "site")?.site_id, "PIPE-PHX-0041");
  assert.equal(jumped.results.find((row) => row.entity_type === "site")?.universe_id, "WB-PHX-0013");

  const land = await applyBatch(sql, muse, "create-land", {
    changes: [createChange("L-9100", { kind: "land", market: "LAS", sources: { market: "Sample listing", name: "Sample listing", category: "Sample listing", broker: "Sample listing", listing_url: "Sample listing" } })],
  });
  assert.equal(land.results.find((row) => row.entity_type === "site")?.site_id, "LAND-LAS-0001");
  assert.equal(land.results.find((row) => row.entity_type === "site")?.universe_id, "WB-LAS-0001");

  const desk = await sql.query<{ stage: string }>("SELECT stage FROM site_stages WHERE site_id = 'PIPE-PHX-0001'");
  assert.equal(desk.rows[0]?.stage, "1 Desk screen");
  const stored = await sql.query<{ name: string; universe_id: string; fact_sources: { name?: string } }>(
    "SELECT name, universe_id, fact_sources FROM sites WHERE site_id = 'PIPE-PHX-0001'",
  );
  assert.equal(stored.rows[0]?.name, "Sample Wash");
  assert.equal(stored.rows[0]?.universe_id, "WB-PHX-0001");
  assert.equal(stored.rows[0]?.fact_sources.name, "Sample listing");
  const universe = await sql.query<{ counted: string; site_id: string }>("SELECT counted, site_id FROM universe_rows WHERE universe_id = 'WB-PHX-0001'");
  assert.equal(universe.rows[0]?.counted, "Yes");
  assert.equal(universe.rows[0]?.site_id, "PIPE-PHX-0001");

  await assert.rejects(
    () =>
      applyBatch(sql, muse, "locked-name", {
        changes: [
          {
            entity_type: "site",
            site_id: "PIPE-PHX-0001",
            expected_version: 1,
            source: "Sample listing",
            payload: { name: "Renamed Sample" },
          },
        ],
      }),
    /cannot write that field/,
  );
});

test("mint skips the quarantined id and ids already on the sheet counter", async () => {
  const sql = await ready();
  await sql.query(
    `INSERT INTO sites (site_id, market, version, updated_by) VALUES ('PIPE-PHX-0005', 'PHX', 1, 'test')`,
  );
  await sql.query(
    `UPDATE sites SET universe_id = 'WB-PHX-0020' WHERE site_id = 'PIPE-PHX-0005'`,
  );
  const minted = await applyBatch(sql, muse, "above-row", { changes: [createChange("L-9200")] });
  assert.equal(minted.results.find((row) => row.entity_type === "site")?.site_id, "PIPE-PHX-0007");
  assert.equal(minted.results.find((row) => row.entity_type === "site")?.universe_id, "WB-PHX-0021");

  const row: SiteRow = {
    site_id: "PIPE-MIA-0033",
    ...emptySiteFields(),
    universe_id: "WB-MIA-0008",
    market: "MIA",
    coord_status: "",
    sheet: "{}",
    facts: {},
  };
  await rememberSheetIdFloors(sql, { stages: [], activities: [], comms: [], sites: [row] });
  const fromSheet = await mintSitePair(sql, "pipeline", "MIA");
  assert.equal(fromSheet.siteId, "PIPE-MIA-0034");
  assert.equal(fromSheet.universeId, "WB-MIA-0009");

  await sql.exec("BEGIN");
  const firstPair = await mintSitePair(sql, "land", "LAS");
  const secondPair = await mintSitePair(sql, "land", "LAS");
  await sql.exec("COMMIT");
  assert.deepEqual([firstPair.siteId, secondPair.siteId], ["LAND-LAS-0001", "LAND-LAS-0002"]);
  assert.deepEqual([firstPair.universeId, secondPair.universeId], ["WB-LAS-0001", "WB-LAS-0002"]);
});

test("a new site ignores folder, photos, land evidence, typed power, checks, and financial claims", async () => {
  const sql = await ready();
  for (const extra of [
    { folder_url: "https://example.com/folder/sample" },
    { photo_notes: "copied" },
    { cap_c_amps: 1 },
    { checked_live: "2026-03-01" },
    { stated_revenue: 1 },
    { photos: [] },
  ]) {
    assert.throws(
      () => validateBatch(muse, "guard", { changes: [createChange("L-9300", extra)] }),
      /does not copy Folder, photos, land evidence, typed power, check statuses, or financial claims/,
    );
  }
  const count = await sql.query<{ n: number | string }>("SELECT count(*)::int AS n FROM sites");
  assert.equal(Number(count.rows[0]?.n), 0);
  assert.throws(() => validateBatch(muse, "no-source", { changes: [createChange("L-9301", { sources: { market: "Sample listing" } })] }), /name needs a source/);
  assert.throws(() => validateBatch(muse, "picked-id", { changes: [{ ...createChange("L-9302"), site_id: "PIPE-PHX-0001" }] }), /server assigns site ids/);
});

test("an agent relinks a blank or listing comms row onto the new site", async () => {
  const sql = await ready();
  const listed = await applyBatch(sql, muse, "comms-l", {
    changes: [
      {
        entity_type: "comms",
        site_id: "L-9400",
        expected_version: 0,
        source: "Sample listing",
        payload: { direction: "in", summary: "Sample note" },
      },
    ],
  });
  const blank = await applyBatch(sql, muse, "comms-blank", {
    changes: [
      {
        entity_type: "comms",
        site_id: "",
        expected_version: 0,
        source: "Sample listing",
        payload: { direction: "in", summary: "Sample note" },
      },
    ],
  });
  const created = await applyBatch(sql, muse, "site-for-relink", { changes: [createChange("L-9400")] });
  const siteId = created.results.find((row) => row.entity_type === "site")?.site_id || "";
  assert.match(siteId, /^PIPE-PHX-\d{4}$/);
  const commsId = listed.results[0]?.entity_id || "";
  const blankId = blank.results[0]?.entity_id || "";
  await applyBatch(sql, muse, "relink-l", {
    changes: [
      {
        entity_type: "comms",
        site_id: siteId,
        entity_id: commsId,
        expected_version: 1,
        source: "Sample listing",
        payload: { direction: "in", relink_from: "L-9400" },
      },
    ],
  });
  await applyBatch(sql, muse, "relink-blank", {
    changes: [
      {
        entity_type: "comms",
        site_id: siteId,
        entity_id: blankId,
        expected_version: 1,
        source: "Sample listing",
        payload: { direction: "in", relink_from: "" },
      },
    ],
  });
  const rows = await sql.query<{ entity_id: string; site_id: string; payload: { relinked_from?: string; relinked_by?: string; site_ids?: string } }>(
    "SELECT entity_id, site_id, payload FROM comms_entries ORDER BY entity_id",
  );
  assert.equal(rows.rows.every((row) => row.site_id === siteId), true);
  const fromListing = rows.rows.find((row) => row.entity_id === commsId);
  assert.equal(fromListing?.payload.relinked_from, "L-9400");
  assert.equal(fromListing?.payload.relinked_by, "muse");
  assert.equal(fromListing?.payload.site_ids, siteId);
  const fromBlank = rows.rows.find((row) => row.entity_id === blankId);
  assert.equal(fromBlank?.payload.relinked_from, "");
  assert.equal(fromBlank?.payload.relinked_by, "muse");

  await assert.rejects(
    () =>
      applyBatch(sql, muse, "relink-locked", {
        changes: [
          {
            entity_type: "comms",
            site_id: "PIPE-LAS-0008",
            entity_id: commsId,
            expected_version: 2,
            source: "Sample listing",
            payload: { direction: "in", relink_from: "L-9400" },
          },
        ],
      }),
    /only attach a comms row that has no site or a listing id/,
  );
});

test("the mirror appends the minted site and universe row and not the guarded columns", () => {
  const pipeline: SheetTable = {
    title: "Pipeline",
    headerRow: 4,
    headers: ["Site ID", "Stage", "Name", "Market", "Broker", "Listing link", "Universe ID", "Asking price ($)"],
    rows: [{ row: 5, cells: ["PIPE-PHX-0040", "1 Desk screen", "", "", "", "", "", ""] }],
  };
  const plan = planCreatedSiteMirror(
    [pipeline],
    [
      {
        site_id: "PIPE-PHX-0041",
        kind: "pipeline",
        values: {
          stage: "1 Desk screen",
          name: "Sample Wash",
          market: "PHX",
          broker: "Sample Broker",
          listing_url: "https://example.com/listing/9001",
          universe_id: "WB-PHX-0013",
        },
      },
    ],
  );
  assert.equal(plan.appended, 1);
  assert.equal(plan.changes.some((change) => change.header === "Name" && change.after === "Sample Wash"), true);
  assert.equal(plan.changes.some((change) => change.header === "Universe ID" && change.after === "WB-PHX-0013"), true);
  assert.equal(plan.changes.some((change) => change.header === "Stage" && change.after === "1 Desk screen"), true);
  assert.equal(plan.changes.some((change) => /asking|folder|photo|power/i.test(change.header)), false);
  assert.equal(plan.changes.every((change) => change.row !== 10), true);
  const before: SheetTable = {
    title: "Pipeline",
    headerRow: 4,
    headers: ["Site ID", "Stage", "Name"],
    rows: [{ row: 5, cells: ["PIPE-PHX-0040", "1 Desk screen", ""] }],
  };
  assert.deepEqual(labeledFloorsFromTable(before, ["site id"]), [{ name: "PIPE:PHX", value: 40 }]);

  const universe: SheetTable = {
    title: "Universe",
    headerRow: 1,
    headers: ["Universe ID", "Business name", "Market", "Counted in funnel"],
    rows: [{ row: 2, cells: ["WB-PHX-0012", "", "PHX", "Yes"] }],
  };
  assert.deepEqual(labeledFloorsFromTable(universe, ["universe id"]), [{ name: "WB:PHX", value: 12 }]);
  const universePlan = planUniverseMirror(universe, [
    {
      universe_id: "WB-PHX-0013",
      values: { name: "Sample Wash", market: "PHX", counted: "Yes" },
    },
  ]);
  assert.equal(universePlan.appended, 1);
  assert.equal(universePlan.changes.some((change) => change.after === "WB-PHX-0013"), true);
  assert.equal(universePlan.changes.some((change) => change.header === "Counted in funnel" && change.after === "Yes"), true);
});
