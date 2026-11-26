import MapPowerCard, { type GridCoverage } from "./MapPowerCard";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, LocateFixed } from "lucide-react";
import { displayAddress } from "@/lib/format";
import { previewFitFigure, screeningEvidence } from "@/lib/screeningEvidence";
import { canWrite, useActionStatus } from "./actions/panel";
import { PowerFollowUp } from "./PowerEvidence";
import SpaceOptions from "./spaces/SpaceOptions";
import FinancialsEntry from "./FinancialsEntry";
import type { DealProps, SiteProps, UnscreenedProps } from "@/lib/types";

type PreviewProps = {
  site?: SiteProps | null;
  deal?: DealProps | null;
  listing?: UnscreenedProps | null;
  linkedDeal?: DealProps | null;
  signedIn: boolean;
  powerMode: boolean;
  powerSite?: SiteProps | null;
  powerDeal?: DealProps | null;
  grid: GridCoverage;
  onGrid: () => void;
  loading: boolean;
  compared: boolean;
  comparisonFull: boolean;
  onCompare?: () => void;
  onSatellite?: () => void;
  onOpen: (panel?: "open-land" | "finding" | "space-options") => void;
  onClose: () => void;
};

export default function MapSitePreview(props: PreviewProps) {
  const { site, deal, listing, onOpen, onClose } = props;
  const record = deal || site || listing;
  const id = deal?.deal_id || site?.site_id || listing?.listing_id;
  const access = useActionStatus();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [id]);
  const [tab, setTab] = useState<"site" | "power" | null>(null);
  useEffect(() => { setTab(null); }, [id, props.powerMode]);
  if (!record) return null;
  const canSeePower = props.signedIn && !listing;
  const showingPower = canSeePower && (tab === "power" || (tab == null && props.powerMode));
  const { figures, status, review, evidence, missing } = screeningEvidence({ site, deal: deal || props.linkedDeal, listing, signedIn: props.signedIn });
  const fact = previewFitFigure(figures);
  const powerDeal = deal || props.linkedDeal;
  const power = props.signedIn && !listing && access.enabled && !evidence && /power|utility|electrical/i.test(review) && powerDeal?.kind !== "land" && !site?.land_only && powerDeal?.stage_group !== "dropped";
  const address = displayAddress(record.address);
  return (
    <aside className={`drawer map-preview${showingPower ? " with-power" : ""}`} aria-labelledby="pin-preview-title" data-record={id}
      onKeyDown={event => { if (event.key === "Escape" && !document.querySelector(".pnl-overlay, dialog[open]")) { event.stopPropagation(); onClose(); } }}>
      <div className="preview-topline">
        <span className="preview-stage"><LocateFixed size={17} aria-hidden="true" />{status}</span>
        <button className="close" type="button" aria-label="Close site preview" onClick={onClose}>×</button>
      </div>
      <h2 id="pin-preview-title" ref={titleRef} tabIndex={-1}>{record.name || address || id}</h2>
      {record.name && address && address !== record.name && <p className="preview-address">{address}</p>}
      {deal?.universe_id && <p className="preview-address">Linked to a census site</p>}
      {canSeePower && !props.grid.open && <div className="segmented power-tabs" role="group" aria-label="Pin details">
        <button type="button" className={`segmented ${!showingPower ? "on" : ""}`} aria-pressed={!showingPower} onClick={() => {if (props.grid.open) props.onGrid(); setTab("site");}}>Site fit</button>
        <button type="button" className={`segmented ${showingPower ? "on" : ""}`} aria-pressed={showingPower} onClick={() => setTab("power")}>Power</button>
      </div>}
      {showingPower ? <MapPowerCard deal={props.powerDeal} site={props.powerSite} grid={props.grid} onGrid={props.onGrid}/> : <dl className="preview-facts">
        {fact ? <div><dt>{fact.label}</dt><dd>{fact.value}{fact.date && ` · ${fact.date}`}{fact.source && <small className="preview-missing">{fact.source}</small>}</dd></div> : <div><dt>Site fit</dt><dd>{props.loading ? "Checking…" : "No site-fit figure on file"}</dd></div>}
        <div><dt>Next check</dt><dd>{review}{missing && !props.loading && <small className="preview-missing">{missing}</small>}</dd></div>
      </dl>}
      {!showingPower && props.signedIn && !listing && !site?.land_only && powerDeal?.kind === "pipeline" && <SpaceOptions key={powerDeal.deal_id} site={powerDeal.deal_id} compact onOpen={() => onOpen("space-options")} />}
      {!props.grid.open && <div className="preview-actions">
      {!showingPower && power && <PowerFollowUp deal={props.powerDeal} site={props.powerSite} primary />}
      {!showingPower && evidence?.kind === "county" && <a className="primary preview-open" href={evidence.href} target="_blank" rel="noopener noreferrer">Open county record <span aria-hidden="true">↗</span><span className="sr"> (opens in a new tab)</span></a>}
      {!showingPower && evidence?.kind === "space" && <button className="primary preview-open" type="button" onClick={() => onOpen("open-land")}>Check open land</button>}
      {!showingPower && evidence?.kind === "financials" && <FinancialsEntry dealId={evidence.id} compact />}
      {props.onCompare && <button className="paper-btn preview-open" type="button" onClick={props.onCompare}
        disabled={props.comparisonFull && !props.compared}>{props.compared ? "Remove from comparison" : props.comparisonFull ? "Comparison full" : "Add to comparison"}</button>}
      {props.onSatellite && <button className="text-link preview-open" type="button" onClick={props.onSatellite}>View satellite</button>}
      {props.signedIn && !listing && access.enabled && canWrite(access.actionRole) && <button type="button" className="text-link preview-open" onClick={() => onOpen("finding")}>Record finding</button>}
      <button type="button" className={showingPower || evidence || power ? "text-link preview-open" : "primary preview-open"} onClick={() => onOpen()}>Open site record <ArrowRight size={16} aria-hidden="true" /></button>
      </div>}
    </aside>
  );
}
