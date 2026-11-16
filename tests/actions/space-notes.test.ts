import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { createNote } from "../../lib/actions/notes";
import { applyBatch, type Actor } from "../../lib/changes/apply";
import { mailLink } from "../../lib/alerts/links";
import { loadCatalogFromDisk } from "../../lib/queue/catalog";
import { loadQueue, markAllReviewed } from "../../lib/queue/load";
import { memorySql } from "../helpers/sql";

const active = loadCatalogFromDisk().find((item) => item.active && !item.isCStore);
if (!active) throw new Error("expected an active pipeline deal");

const viewer: Actor = { id: "viewer", kind: "human", role: "viewer" };
const hash = "$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk";

async function ready() {
  process.env.AUTH_USERS = JSON.stringify([
    { u: "viewer", h: hash, role: "user", actionRole: "viewer", name: "Viewer", email: "viewer@example.com" },
    { u: "reviewer", h: hash, role: "admin", actionRole: "reviewer", name: "Reviewer", email: "reviewer@example.com" },
  ]);
  process.env.ALERT_EMAILS = JSON.stringify({ reviewer: "reviewer@example.com" });
  const sql = await memorySql();
  await migrate(sql);
  const queue = await loadQueue(sql, "reviewer", { market: "all", viable: true }, true);
  await markAllReviewed(sql, "reviewer", queue.items.map((item) => item.siteId));
  return sql;
}

test("a mention on a marked space is instant and lands in Review", async () => {
  const sql = await ready();
  const created = await applyBatch(sql, viewer, "space-note", {
    changes: [{
      entity_type: "site_space",
      site_id: active.id,
      expected_version: 0,
      source: "Site aerial",
      payload: {
        center_lng: -112.07,
        center_lat: 33.45,
        length_ft: 90,
        width_ft: 60,
        rotation_deg: 0,
        type: "unused_pad",
        layout: "stalls_90",
      },
    }],
  });
  const spaceId = created.results[0]?.entity_id || "";
  const note = await createNote(sql, {
    targetKind: "site_space",
    targetId: spaceId,
    body: "The east row could take a charger bay.",
    authorId: "viewer",
    mentions: ["reviewer"],
  });
  assert.equal(note.targetKind, "site_space");
  assert.equal(note.mentions[0]?.id, "reviewer");

  const reviewer = await loadQueue(sql, "reviewer", { market: "all", viable: true }, true);
  const hit = reviewer.items.find((item) => item.siteId === active.id);
  assert.equal(hit?.mentioned, true);
  assert.equal(hit?.reasons.some((reason) => reason.summary === "Mentioned you."), true);

  const outbox = await sql.query<{ channel: string; category: string; href: string }>(
    `SELECT channel, category, href FROM alert_outbox WHERE user_id = 'reviewer' AND ref_id = $1`,
    [note.id],
  );
  assert.equal(outbox.rows[0]?.category, "mentions");
  assert.equal(outbox.rows[0]?.channel, "instant");
  assert.match(outbox.rows[0]?.href || "", new RegExp(`space=${spaceId}`));
  const linked = mailLink({ category: "mentions", siteId: active.id, href: outbox.rows[0]?.href });
  assert.match(linked, new RegExp(`space=${spaceId}`));
});
