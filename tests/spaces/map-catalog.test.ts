import assert from "node:assert/strict";
import test from "node:test";
import { mapZones, spacesMapHref } from "@/lib/spaces/mapCatalog";
import { reviewBody } from "@/lib/spaces/optionReview";
import { outlineId } from "@/lib/spaces/outlineAnchor";
import type { Assessment, Point } from "@/lib/spaces/options";

test("analysis footprints keep their source and acquire an edit only from a matching saved outline", () => {
  const site = "PIPE-PHX-9998";
  const original: Point[] = [
    [10, 10],
    [30, 10],
    [30, 20],
    [10, 20],
  ];
  const row: Assessment = {
    status: "reviewed",
    summary: "Example",
    recorded: null,
    baseline: "unconfirmed",
    segment: "",
    cohort: "active",
    zones: [{ kind: "parking", label: "East row", points: original }],
    revision: "aaaaaaaaaaaa",
    image: {
      id: "bbbbbbbbbbbbbbbb",
      source: "Example plan",
      date: "",
      width: 200,
      height: 200,
      src: "/example",
    },
  };
  const changed: Point[] = [[11, 11], ...original.slice(1)];
  const body = reviewBody({
    option: "outdoor",
    disposition: "Adjust outline",
    area: "East row",
    revision: row.revision,
    frame: row.image!.id,
    points: changed,
    reason: "Adjusted corner.",
  });
  const clean = { ...row.zones[0], edited: false };
  assert.deepEqual(mapZones(site, row, []), [clean]);
  assert.deepEqual(mapZones(site, row, [{ target_id: "other", body }]), [clean]);
  assert.deepEqual(
    mapZones(site, row, [{ target_id: site, body: body.replace(row.image!.id, "cccccccccccccccc") }]),
    [clean],
  );
  assert.deepEqual(mapZones(site, row, [{ target_id: site, body }]), [
    { ...clean, points: changed, edited: true },
  ]);
  const decision=reviewBody({option:"outdoor", disposition:"Dismiss option",area:"East row",revision:row.revision,frame:row.image!.id,reason:"Access is unavailable."});
  assert.deepEqual(mapZones(site,row,[{target_id:site,body:decision},{target_id:site,body}])[0].points,changed);
  assert.deepEqual(row.zones[0].points, original);
  const url = new URL(spacesMapHref(site, outlineId(clean)), "http://localhost");
  assert.equal(url.searchParams.get("spaceArea"), outlineId(clean));
});
