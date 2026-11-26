import { useState } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { comparisonPower } from "@/lib/mapPower";
import { factsForDeal, factsForSite } from "@/lib/keyNumbers";
import { derivePowerRating } from "@/lib/score/power-rating";
import { useActionStatus } from "./actions/panel";
import ComparisonEvidence from "./actions/ComparisonEvidence";
import { currentSearch, rememberSearch } from "@/lib/navSearch";

export function PowerFollowUp({ deal, site, primary = false }: { primary?: boolean; deal?: DealProps | null; site?: SiteProps | null }) {
  const [open, setOpen] = useState(false);
  const access = useActionStatus();
  const record = deal || site;
  if (!record || !access.enabled || deal?.kind === "land" || site?.land_only || deal?.stage_group === "dropped") return null;
  return <>
    <button type="button" className={primary ? "primary preview-open" : "text-link"} onClick={() => setOpen(true)}>Open power follow-up</button>
    {open && <ComparisonEvidence title={record.name || record.address || "Site"} target={{ targetKind: deal ? "deal" : "site", targetId: deal?.deal_id || site!.site_id, measure: "power", period: "", basis: "" }}
      context="Confirm on-site power" close={() => setOpen(false)} saved={() => {}} inspect={note => {
        const query = new URLSearchParams(currentSearch());
        query.set("panel","discussion"); query.set("note",note);
        if (deal) query.set("site",deal.deal_id);
        const href = "/?" + query;
        setOpen(false); rememberSearch(href); window.history.replaceState(null,"",href);
      }} />}
  </>;
}

export default function PowerEvidence({deal, site, signedIn}: {deal?: DealProps | null; site?: SiteProps | null; signedIn: boolean}) {
  const record = deal || site;
  const facts = deal ? factsForDeal(deal) : factsForSite(site);
  const rating = derivePowerRating({...record, market:record?.city});
  const { service, frontage, differing } = comparisonPower(deal, site);
  const names = { b:"Other utility hosting evidence", a:"Grid proximity", d:"Load history" };
  return <section className="power-evidence" data-evidence="power"><span className="eyebrow">Power</span><h3>{differing ? "Sources disagree" : service?.verified ? "Verified on-site service" : service?.complete ? "Recorded on-site service" : service ? "Partial on-site service record" : "On-site capacity unconfirmed"}</h3>
    <dl className="record-economics">
      <div data-evidence="on-site-service"><dt>On-site service</dt><dd>{service?.value || "Unconfirmed"}{service && <small>{service.source || "Source not recorded"}</small>}</dd></div>
      <div data-evidence="street-hosting"><dt>Street-frontage hosting</dt><dd>{frontage?.value || "Not on file"}{frontage && <small>{[frontage.basis, frontage.source].filter(Boolean).join(" · ")}</small>}</dd></div>
      {(["b","a","d"] as const).map(id => {
        const fact = facts.find(item => item.id === id);
        const lines = fact?.lines.filter(line => !line.startsWith("Frontage hosting "));
        if (!lines?.length) return null;
        return <div key={id}><dt>{names[id]}</dt><dd>{lines.join(" · ")}<small>{fact?.basis || "Source not recorded"}</small></dd></div>;
      })}
    </dl>
    <p><strong>Power rating</strong> · {rating.reason}</p>
    {signedIn && <PowerFollowUp deal={deal} site={site} />}
  </section>;
}
