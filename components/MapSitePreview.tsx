import { useEffect, useRef } from "react";
import { ArrowRight, LocateFixed } from "lucide-react";
import { displayAddress } from "@/lib/format";
import { screeningEvidence } from "@/lib/screeningEvidence";
import FinancialsEntry from "./FinancialsEntry";
import type { DealProps, SiteProps, UnscreenedProps } from "@/lib/types";

type PreviewProps = {
  site?: SiteProps | null;
  deal?: DealProps | null;
  listing?: UnscreenedProps | null;
  linkedDeal?: DealProps | null;
  signedIn: boolean;
  loading: boolean;
  onOpen: (panel?: "open-land") => void;
  onClose: () => void;
};

export default function MapSitePreview(props: PreviewProps) {
  const { site, deal, listing, onOpen, onClose } = props;
  const record = deal || site || listing;
  const id = deal?.deal_id || site?.site_id || listing?.listing_id;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [id]);
  if (!record) return null;
  const { figures, status, review, evidence, missing } = screeningEvidence({ site, deal: deal || props.linkedDeal, listing, signedIn: props.signedIn });
  const fact = figures[0];
  const address = displayAddress(record.address);
  return (
    <aside className="drawer map-preview" aria-labelledby="pin-preview-title" data-record={id}
      onKeyDown={event => { if (event.key === "Escape" && !document.querySelector(".pnl-overlay")) { event.stopPropagation(); onClose(); } }}>
      <div className="preview-topline">
        <span className="preview-stage"><LocateFixed size={17} aria-hidden="true" />{status}</span>
        <button className="close" type="button" aria-label="Close site preview" onClick={onClose}>×</button>
      </div>
      <h2 id="pin-preview-title" ref={titleRef} tabIndex={-1}>{record.name || address || id}</h2>
      {record.name && address && address !== record.name && <p className="preview-address">{address}</p>}
      <dl className="preview-facts">
        {fact && <div><dt>{fact.label}</dt><dd>{fact.value}{fact.date && ` · ${fact.date}`}</dd></div>}
        <div><dt>Next check</dt><dd>{review}{missing && !props.loading && <small className="preview-missing">{missing}</small>}</dd></div>
      </dl>
      <div className="preview-actions">
      {evidence?.kind === "county" && <a className="primary preview-open" href={evidence.href} target="_blank" rel="noopener noreferrer">Open county record <span aria-hidden="true">↗</span><span className="sr"> (opens in a new tab)</span></a>}
      {evidence?.kind === "space" && <button className="primary preview-open" type="button" onClick={() => onOpen("open-land")}>Check open land</button>}
      {evidence?.kind === "financials" && <FinancialsEntry dealId={evidence.id} compact />}
      <button type="button" className={evidence ? "text-link preview-open" : "primary preview-open"} onClick={() => onOpen()}>Open site record <ArrowRight size={16} aria-hidden="true" /></button>
      </div>
    </aside>
  );
}
