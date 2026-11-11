import { cashTile, packageLine, spareLandSqft } from "@/lib/keyNumbers";
import { cardPhotos, galleryModel, type PhotoCarrier } from "@/lib/photos";
import type { DealProps } from "@/lib/types";

export type SiteCardFacts = Record<string, string | number>;

function joinSpare(value: string, note: string) {
  if (!value || value === "Not measured") return "";
  return note ? `${value} · ${note}` : value;
}

/** The same figures the site card already shows. No stage change, no invented timeline. */
export function dealCardFacts(deal: Record<string, unknown>, universe?: Record<string, unknown> | null): SiteCardFacts {
  const typed = deal as unknown as DealProps;
  const censusAcres = typeof universe?.spare_ac_own === "number" ? universe.spare_ac_own : null;
  const cash = cashTile(typed);
  const spare = spareLandSqft(typed.open_land_sqft, censusAcres);
  const photos = galleryModel(cardPhotos(typed, (universe || null) as PhotoCarrier | null));
  const pack = packageLine(typed);
  const out: SiteCardFacts = {};
  if (typed.asking_price_display) out.askingPrice = typed.asking_price_display;
  if (typeof typed.land_acres === "number") out.acres = typed.land_acres;
  const spareText = joinSpare(spare.value, spare.note);
  if (spareText) out.spareLand = spareText;
  if (typed.bays_that_fit != null) out.baysThatFit = Math.round(typed.bays_that_fit);
  if (!cash.hidden) {
    out.cashFlow = cash.value;
    const note = [cash.note, cash.basis].filter(Boolean).join(" · ");
    if (note && note !== pack) out.cashFlowNote = note;
  }
  if (pack) out.packageStatus = pack;
  if (photos.statusLine) out.photoSet = photos.statusLine;
  return out;
}

export function siteCardFacts(site: Record<string, unknown>, deal?: Record<string, unknown> | null): SiteCardFacts {
  const out: SiteCardFacts = deal ? dealCardFacts(deal, site) : {};
  if (!out.askingPrice && typeof site.asking_price_display === "string" && site.asking_price_display) {
    out.askingPrice = site.asking_price_display;
  }
  if (out.acres == null) {
    const acres = typeof site.parcel_acres === "number" ? site.parcel_acres : typeof site.lot_ac === "number" ? site.lot_ac : null;
    if (acres != null) out.acres = acres;
  }
  if (!out.spareLand && typeof site.spare_ac_own === "number") {
    const spare = spareLandSqft(null, site.spare_ac_own);
    const text = joinSpare(spare.value, spare.note);
    if (text) out.spareLand = text;
  }
  if (!out.photoSet) {
    const line = galleryModel(cardPhotos(site as PhotoCarrier, (deal || null) as PhotoCarrier | null)).statusLine;
    if (line) out.photoSet = line;
  }
  return out;
}
