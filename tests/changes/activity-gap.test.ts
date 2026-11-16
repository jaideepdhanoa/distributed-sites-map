import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXCLUDED_SITE_ID, isExcludedSite } from "../../lib/alerts/excluded";
import { activityGapHashes, formatActivityGaps } from "../../lib/changes/activityGap";
import { buildReport, renderReport } from "../../lib/changes/diff";
import { emptySiteFields, shortHash } from "../../lib/changes/site";
import { linesForSites, type CommsRecord, type CommsSnapshot } from "../../lib/comms";
import { ACTIVITY_TIMEOUT_MS, activityView } from "../../lib/timeline/load";

const QUIET = "PIPE-LAS-0004";
const COVERED = "PIPE-PHX-0001";
const EXCLUDED = EXCLUDED_SITE_ID;

function row(partial: Partial<CommsRecord>): CommsRecord {
  return {
    comms_id: "CM-1000",
    site_ids: COVERED,
    thread_id: "",
    link: "",
    at: "2026-11-01",
    direction: "in",
    person: "",
    firm: "",
    channel: "",
    summary: "Noted",
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

test("a site with no activity and no comms is flagged by count and hash", () => {
  assert.equal(isExcludedSite(EXCLUDED), true);
  const hashes = activityGapHashes({
    sites: [{ site_id: COVERED }, { site_id: QUIET }, { site_id: EXCLUDED }, { site_id: "PIPE-MIA-0004" }],
    activities: [{ site_id: COVERED }],
    comms: [{ site_id: "PIPE-SNA-0002", site_ids: "PIPE-SNA-0002;PIPE-MIA-0004" }],
  });
  assert.deepEqual(hashes, [shortHash(QUIET)]);
  const printed = formatActivityGaps(hashes);
  assert.match(printed, /Activity gaps: 1/);
  assert.match(printed, new RegExp(`#${shortHash(QUIET)}`));
  assert.equal(printed.includes(QUIET), false);
  assert.equal(printed.includes(EXCLUDED), false);
  assert.equal(printed.includes(shortHash(EXCLUDED)), false);

  const site = { site_id: QUIET, ...emptySiteFields(), coord_status: "", sheet: "{}", facts: {}, market: "LAS", photo_refs: "[]" };
  const report = buildReport(
    { stages: [], activities: [], comms: [], sites: [site] },
    { stages: [], activities: [], comms: [], sites: [site] },
    "files",
  );
  assert.equal(report.clean, true);
  assert.deepEqual(report.activity_gaps.hashes, [shortHash(QUIET)]);
  const rendered = renderReport(report);
  assert.match(rendered, /Activity gaps: 1/);
  assert.equal(rendered.includes(QUIET), false);
});

test("the activity tab keeps the part that loaded", () => {
  assert.equal(ACTIVITY_TIMEOUT_MS, 15000);
  const timeline = { items: [{ date: "2026-11-01", type: "stage", summary: "Site added", eventId: "A-000001" }] };
  const comms = { rows: [{ commsId: "CM-1001", at: "2026-11-01", direction: "in", person: "", firm: "", channel: "", summary: "Noted", approximate: false, citedEventIds: [], messageId: "" }], internal: [] };
  const commsFailed = activityView({ timeline: { ok: true, value: timeline }, comms: { ok: false } });
  assert.equal(commsFailed.timelineError, false);
  assert.equal(commsFailed.commsError, true);
  assert.equal(commsFailed.timeline?.items.length, 1);
  assert.equal(commsFailed.comms, null);
  const timelineFailed = activityView({ timeline: { ok: false }, comms: { ok: true, value: comms } });
  assert.equal(timelineFailed.timelineError, true);
  assert.equal(timelineFailed.commsError, false);
  assert.equal(timelineFailed.comms?.rows[0]?.commsId, "CM-1001");
  const ui = readFileSync("components/timeline/Timeline.tsx", "utf8");
  assert.match(ui, /Promise\.allSettled/);
  assert.match(ui, /activity-timeline-error/);
  assert.match(ui, /activity-comms-error/);
});

test("comms for one site do not require reading every other row", () => {
  const snapshot = {
    source: "test",
    as_of: "2026-11-16",
    label: "Comms",
    unexpected_directions: [],
    rows: [
      row({ comms_id: "CM-1001", site_ids: COVERED, summary: "Noted" }),
      row({ comms_id: "CM-1002", site_ids: QUIET, summary: "Other note" }),
    ],
    sites: { [COVERED]: ["CM-1001"], [QUIET]: ["CM-1002"] },
  } as CommsSnapshot;
  const lines = linesForSites(snapshot, [COVERED]);
  assert.deepEqual(lines.map((line) => line.commsId), ["CM-1001"]);
});
