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

test("an explicit use-rights decision follows only the same revision and footprint",()=>{
  const id="PIPE-PHX-9998",points:Point[]=[[10,10],[40,10],[40,40],[10,40]];
  const row={revision:"current",image:{id:"aerial"},zones:[{kind:"parking",label:"West",points}]} as Assessment;
  const review={disposition:"Keep for diligence",option:"outdoor",area:"West",frame:"aerial",revision:"current",reason:"Lease exhibit",useRight:{status:"documented",detail:"Signed exhibit includes the drive aisle."}} as const;
  const note=(body:string)=>({target_id:id,body});
  const grant=note(reviewBody(review));
  assert.equal(mapZones(id,row,[grant])[0].useRight?.status,"documented");
  const changed:Point[]=[[11,11],...points.slice(1)];
  const edit=note(reviewBody({...review,useRight:undefined,disposition:"Adjust outline",points:changed}));
  assert.equal(mapZones(id,row,[edit,grant])[0].useRight?.status,"unconfirmed");
  assert.equal(mapZones(id,{...row,revision:"updated"},[grant])[0].useRight,undefined);
  const denied=note(reviewBody({...review,useRight:{status:"unavailable",detail:"Access withdrawn."}}));
  assert.equal(mapZones(id,row,[denied,grant])[0].useRight?.status,"unavailable");
});
