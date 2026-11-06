import assert from "node:assert/strict";
import test from "node:test";
import { publicDeal } from "../lib/keyNumbers.ts";
import {
  cardPhotos,
  galleryModel,
  imageCandidates,
  isDirectImageUrl,
  photoStatusLine,
  streetViewEmbedSrc,
} from "../lib/photos.ts";
import type { SitePhoto } from "../lib/types.ts";

const FILE = "1Ut6cymlK5at0_Cte8awd109tRnBBzcOM";
const PANO = "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=33.306,-111.841";
const THUMB = `https://drive.google.com/thumbnail?id=${FILE}&sz=w1600`;
const STILL = "https://maps.googleapis.com/maps/api/streetview?size=600x400&location=33.3,-111.8";

function photo(partial: SitePhoto): SitePhoto {
  return { visibility: "map", ...partial };
}

test("image candidates use the cached site path and skip Drive hosts", () => {
  assert.equal(isDirectImageUrl(STILL), false);
  assert.equal(isDirectImageUrl("https://drive.google.com/drive/folders/abc"), false);
  assert.equal(isDirectImageUrl("https://drive.google.com/uc?export=view&id=" + FILE), false);
  const local = "/api/data/photos/25a9a143d91c73b53d28.jpg";
  assert.deepEqual(imageCandidates(photo({ role: "lot_aerial", file_id: FILE, view_url: local }), "thumb"), [local]);
  assert.deepEqual(imageCandidates(photo({ role: "lot_aerial", file_id: FILE, view_url: THUMB }), "full"), []);
  assert.deepEqual(imageCandidates(photo({ role: "lot_aerial", view_url: "https://lh3.googleusercontent.com/d/" + FILE }), "full"), []);
  assert.deepEqual(imageCandidates(photo({ role: "listing", view_url: "https://cdn.example/lot.jpg" }), "thumb"), ["https://cdn.example/lot.jpg"]);
  assert.deepEqual(imageCandidates(photo({ role: "street_frontage", view_url: PANO }), "full"), []);
  assert.deepEqual(imageCandidates(photo({ role: "listing", view_url: THUMB, visibility: "drive_only" }), "full"), []);
});

function local(name: string) {
  return `/api/data/photos/${name}.jpg`;
}

test("gallery order, listing cap, deferred, and frontage embed", () => {
  const photos = [
    photo({ role: "listing", view_url: local("aaaaaaaaaaaaaaaaaaaa") }),
    photo({ role: "listing", view_url: local("bbbbbbbbbbbbbbbbbbbb") }),
    photo({ role: "listing", view_url: local("cccccccccccccccccccc") }),
    photo({ role: "listing", view_url: local("dddddddddddddddddddd") }),
    photo({ role: "listing", view_url: local("eeeeeeeeeeeeeeeeeeee") }),
    photo({ role: "listing", view_url: local("ffffffffffffffffffff") }),
    photo({ role: "listing", view_url: local("11111111111111111111") }),
    photo({ role: "street_level", view_url: local("66666666666666666666") }),
    photo({ role: "building", view_url: local("77777777777777777777") }),
    photo({ role: "electrical", view_url: local("22222222222222222222") }),
    photo({ role: "street_frontage", view_url: PANO, source: "google_street_view" }),
    photo({ role: "lot_aerial", view_url: local("33333333333333333333"), source: "esri_world_imagery", attribution: "Esri, Maxar" }),
    photo({ role: "spare_land_annotated", view_url: local("44444444444444444444") }),
    photo({ role: "listing", view_url: local("55555555555555555555"), visibility: "drive_only" }),
  ];
  const card = cardPhotos({ photos, photo_status: "Partial", photo_diligence_count: 2, photo_listing_count: 4 });
  const model = galleryModel(card);
  assert.equal(model.statusLine, "Partial / 2 diligence · 4 listing");
  assert.deepEqual(model.slides.map((item) => item.role), [
    "spare_land_annotated",
    "lot_aerial",
    "building",
    "street_level",
    "electrical",
    "listing",
    "listing",
    "listing",
    "listing",
    "listing",
    "listing",
    "listing",
  ]);
  assert.equal(model.listingThumbs.length, 6);
  assert.equal(model.hiddenListing, 1);
  assert.equal(model.frontageUrl, PANO);
  assert.match(streetViewEmbedSrc(PANO), /output=svembed/);
  assert.equal(streetViewEmbedSrc(STILL), "");
  assert.equal(galleryModel(cardPhotos({ photos, photo_status: "Deferred" })).showGallery, false);
  assert.equal(galleryModel(cardPhotos({ photos, photo_status: "Deferred" })).statusLine, "Deferred");
  assert.equal(galleryModel(cardPhotos({ photos, photo_status: "Deferred" })).frontageUrl, "");
  assert.equal(galleryModel(cardPhotos({})).visible, false);
  assert.equal(photoStatusLine("", 0, 0), "");
  const pin = publicDeal({ photos, name: "A", cap_a_line_ft: 12 });
  assert.equal("photos" in pin, false);
  assert.equal(pin.name, "A");
});
