import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "../../lib/actions/migrate";
import { aerialTile, streetViewHref } from "../../lib/aerial";
import { isPanoUrl, streetViewEmbedSrc } from "../../lib/photos";
import { applyBatch } from "../../lib/changes/apply";
import { planSiteMirror, type SheetTable } from "../../lib/changes/mirror";
import { validateBatch, type Actor } from "../../lib/changes/schema";
import { paintUniverseMedia } from "../../lib/universeMedia";
import { memorySql } from "../helpers/sql";

const contributor: Actor = { id: "cindel", kind: "human", role: "contributor" };

test("an aerial image is centered on the site and a street link is only a link", () => {
  const tile = aerialTile(36.17, -115.14);
  assert.ok(tile);
  const url = new URL(tile.url);
  assert.equal(url.origin + url.pathname, "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export");
  assert.equal(url.searchParams.get("size"), "640,320");
  assert.equal(url.searchParams.get("f"), "image");
  assert.equal(tile.width / tile.height, 2);
  const box = (url.searchParams.get("bbox") || "").split(",").map(Number);
  assert.equal(box.length, 4);
  const midX = (box[0] + box[2]) / 2;
  const midY = (box[1] + box[3]) / 2;
  const earth = 20037508.342789244;
  const expectedX = (-115.14 * earth) / 180;
  const rad = (36.17 * Math.PI) / 180;
  const expectedY = Math.log(Math.tan(Math.PI / 4 + rad / 2)) * (earth / Math.PI);
  assert.ok(Math.abs(midX - expectedX) < 0.02);
  assert.ok(Math.abs(midY - expectedY) < 0.02);
  assert.equal(aerialTile(null, null), null);
  const href = streetViewHref(36.17, -115.14);
  assert.equal(href, "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=36.17,-115.14");
  assert.equal(href.includes("output=svembed"), false);
  assert.equal(streetViewHref(null, -115.14), "");
  assert.equal(isPanoUrl(href), true);
  const embed = streetViewEmbedSrc(href);
  assert.match(embed, /^https:\/\/www\.google\.com\/maps\?layer=c&cbll=36\.17,-115\.14&cbp=12,0,0,0,0&output=svembed$/);
  assert.equal(embed.includes("streetviewpixels"), false);
  assert.equal(streetViewEmbedSrc("https://example.com/still.jpg"), "");
});

test("a universe card accepts photo and evidence fields", async () => {
  const sql = await memorySql();
  await migrate(sql);
  assert.throws(() => validateBatch(contributor, "pipe-photos", {
    changes: [{
      entity_type: "site",
      site_id: "PIPE-PHX-9101",
      expected_version: 0,
      source: "desk",
      payload: { photo_refs: [{ role: "lot_aerial", view_url: "https://example.com/lot.jpg" }] },
    }],
  }));
  const applied = await applyBatch(sql, contributor, "wb-photos", {
    changes: [{
      entity_type: "site",
      site_id: "WB-LAS-9101",
      expected_version: 0,
      source: "desk",
      payload: {
        photo_refs: [{ role: "lot_aerial", source: "site_visit", view_url: "https://example.com/lot.jpg", caption: "Sample lot" }],
        photo_status: "Partial",
        evidence: "Sample note from a visit.",
      },
    }],
  });
  assert.equal(applied.results[0]?.site_id, "WB-LAS-9101");
  const row = await sql.query<{ photo_refs: unknown; facts: { evidence?: string } }>(
    `SELECT photo_refs, facts FROM sites WHERE site_id = 'WB-LAS-9101'`,
  );
  const photos = typeof row.rows[0]?.photo_refs === "string" ? JSON.parse(row.rows[0].photo_refs) : row.rows[0]?.photo_refs;
  assert.equal(photos[0].view_url, "https://example.com/lot.jpg");
  assert.equal(row.rows[0]?.facts.evidence, "Sample note from a visit.");
  const sheet: SheetTable = { title: "Pipeline", headerRow: 4, headers: ["Site ID"], rows: [] };
  const plan = planSiteMirror([sheet], [{ site_id: "WB-LAS-9101", writes: { Name: "Sample" } }]);
  assert.equal(plan.unmatched.includes("WB-LAS-9101"), false);
});

test("saved universe photos paint onto the card", () => {
  const painted = paintUniverseMedia({
    features: [{ properties: { site_id: "WB-LAS-9101", name: "Sample site" } }, { properties: { site_id: "WB-LAS-9102" } }],
  }, [{
    site_id: "WB-LAS-9101",
    photo_refs: JSON.stringify([{ role: "lot_aerial", view_url: "https://example.com/lot.jpg" }]),
    photo_status: "Partial",
    photo_diligence_count: "1",
    photo_listing_count: "",
    photos_checked: "",
    photo_notes: "",
    facts: { evidence: "Sample evidence." },
  }]);
  const props = painted.features?.[0]?.properties as { photos?: { view_url?: string }[]; evidence?: string; photo_diligence_count?: number };
  assert.equal(props.photos?.[0]?.view_url, "https://example.com/lot.jpg");
  assert.equal(props.evidence, "Sample evidence.");
  assert.equal(props.photo_diligence_count, 1);
  assert.equal((painted.features?.[1]?.properties as { photos?: unknown }).photos, undefined);
});
