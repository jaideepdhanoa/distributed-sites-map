import { useEffect, useRef } from "react";
import { ArrowRight, LocateFixed } from "lucide-react";
import { displayAddress } from "@/lib/format";
import { acresText, spareLandSqft, universeTrafficLine, workbookTrafficLine } from "@/lib/keyNumbers";
import { nextStepText, stageTitle, statusOf } from "@/lib/labels";
import type { DealProps, SiteProps, UnscreenedProps } from "@/lib/types";

type PreviewProps = {
  site?: SiteProps | null;
  deal?: DealProps | null;
  listing?: UnscreenedProps | null;
  linkedDeal?: DealProps | null;
  signedIn: boolean;
  onOpen: () => void;
  onClose: () => void;
};

function available(value?: string | null) {
  const text = value?.trim();
  return text && !/^(—|-|unknown|not on file|n\/a)$/i.test(text) ? text : "";
}

function previewFacts({ site, deal: selectedDeal, linkedDeal, listing, signedIn }: PreviewProps) {
  const deal = selectedDeal || linkedDeal;
  const spare = spareLandSqft(deal?.open_land_sqft, site?.spare_ac_own, deal?.open_land_basis);
  const acres = acresText(deal?.land_acres ?? site?.parcel_acres ?? site?.lot_ac ?? listing?.acres);
  const traffic = (deal && workbookTrafficLine(deal)) || universeTrafficLine(site);
  const fact = [
    ["Usable bays", deal?.bays_that_fit == null ? "" : String(deal.bays_that_fit)],
    ["Open land", available(spare.value) && [spare.value, spare.note].filter(Boolean).join(" · ")],
    ["Traffic", traffic],
    ["Parcel size", acres],
    ["Asking price", signedIn && available(deal?.asking_price_display || site?.asking_price_display || listing?.asking_price_display)],
  ].find(([, value]) => value);
  const status = deal ? stageTitle(deal.stage_group) : site ? statusOf(site).label : "Unscreened listing";
  const gap = signedIn && (available(deal?.stage_blocker) || available(deal?.next_step));
  if (deal?.stage_group === "dropped") return { fact, status, review: "No further review scheduled." };
  let review = gap || (listing?.approximate ? "Confirm the exact location." : "");
  if (!review && site?.verdict) review = nextStepText(site);
  if (!review && site && !deal) review = "Check the county parcel record.";
  if (!review && !available(spare.value)) review = "Confirm how much open land is usable.";
  return { fact, status, review: review || "Review the site evidence." };
}

export default function MapSitePreview(props: PreviewProps) {
  const { site, deal, listing, onOpen, onClose } = props;
  const record = deal || site || listing;
  const id = deal?.deal_id || site?.site_id || listing?.listing_id;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [id]);
  if (!record) return null;
  const { fact, status, review } = previewFacts(props);
  const address = displayAddress(record.address);
  return (
    <aside className="drawer map-preview" aria-labelledby="pin-preview-title" data-record={id}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div className="preview-topline">
        <span className="preview-stage"><LocateFixed size={17} aria-hidden="true" />{status}</span>
        <button className="close" type="button" aria-label="Close site preview" onClick={onClose}>×</button>
      </div>
      <h2 id="pin-preview-title" ref={titleRef} tabIndex={-1}>{record.name || address || id}</h2>
      {record.name && address && address !== record.name && <p className="preview-address">{address}</p>}
      <dl className="preview-facts">
        {fact && <div><dt>{fact[0]}</dt><dd>{fact[1]}</dd></div>}
        <div><dt>Next check</dt><dd>{review}</dd></div>
      </dl>
      <button type="button" className="primary preview-open" onClick={onOpen}>Open site record <ArrowRight size={16} aria-hidden="true" /></button>
    </aside>
  );
}
