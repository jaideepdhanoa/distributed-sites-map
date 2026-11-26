import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "@/lib/actions/migrate";
import { createNote, listNotes } from "@/lib/actions/notes";
import { commentHref } from "@/lib/alerts/links";
import { storeComment } from "@/lib/comments/record";
import { installSnapshotForTests, resetSnapshotForTests } from "@/lib/snapshot/read";
import type { Assessment, Zone } from "@/lib/spaces/options";
import { outlineId } from "@/lib/spaces/outlineAnchor";
import { memorySql } from "../helpers/sql";

test("an assessment without a map pin can keep a review and a discussion on its own outline", async () => {
  const site = "PIPE-PHX-9901";
  const parking: Zone = { kind: "parking", label: "Sample row", points: [[10,10],[40,10],[40,35],[10,35]] };
  const row: Assessment = { status: "reviewed", summary: "Example", recorded: null, baseline: "recorded",
    zones: [parking], segment: "", cohort: "active", revision: "aaaaaaaaaaaa" };
  const file = { version: 1, reviewedOn: "2026-01-01", sites: { [site]: row } };
  const sql = await memorySql();
  await migrate(sql);
  installSnapshotForTests({id:"outline-test",createdAt:"2026-01-01",files:{"space-layouts.json":JSON.stringify(file)}});
  try {
    const note = { targetKind: "deal" as const, targetId: site, body: "Check the driveway.", authorId: "reviewer" };
    await createNote(sql, note, () => null);
    assert.equal((await listNotes(sql,"deal",site))[0].body,note.body);
    await assert.rejects(createNote(sql,{...note,targetId:"PIPE-PHX-9998"},() => null), /not available/);
    const anchor = {type:"space" as const, siteId:site, line:"", period:"", spaceId:outlineId(parking), label:""};
    const write = {siteId:site,parentId:null,anchor,body:"Which driveway?",tag:null,mentions:null,resolved:null,actor:"reviewer",at:"2026-01-01T12:00:00+00:00"};
    const saved = await storeComment(sql,"COM-9001",write,0);
    assert.ok(saved.ok);
    assert.equal(saved.anchor.label,parking.label);
    const link = new URL(commentHref(site,"COM-9001",saved.anchor));
    assert.equal(link.pathname,"/");
    assert.equal(link.searchParams.get("spaceSite"),site);
    assert.equal(link.searchParams.get("discussion"),"1");
    assert.equal(link.searchParams.get("spaceArea"),anchor.spaceId);
    assert.equal(link.searchParams.get("note"),"COM-9001");
    await assert.rejects(storeComment(sql,"COM-9002",{...write,anchor:{...anchor,spaceId:"outline:bays:Sample row"}},0), /not on this assessment/);
  } finally { resetSnapshotForTests(); }
});
