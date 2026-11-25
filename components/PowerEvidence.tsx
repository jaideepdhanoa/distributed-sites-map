import { useState } from "react";
import type { DealProps, SiteProps } from "@/lib/types";
import { factsForDeal, factsForSite } from "@/lib/keyNumbers";
import { derivePowerRating } from "@/lib/score/power-rating";
import { useActionStatus } from "./actions/panel";
import ComparisonEvidence from "./actions/ComparisonEvidence";
import { currentSearch, rememberSearch } from "@/lib/navSearch";

export function PowerFollowUp({ deal, site }: { deal?: DealProps | null; site?: SiteProps | null }) {
  const [open, setOpen] = useState(false);
  const access = useActionStatus();
  const record = deal || site;
  if (!record || !access.enabled || deal?.kind === "land" || site?.land_only || deal?.stage_group === "dropped") return null;
  return <>
    <button type="button" className="text-link" onClick={() => setOpen(true)}>Open power follow-up</button>
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
  const siteCapacity = rating.inputs.find(input => input.layer === "C" && input.value.endsWith(" MW"));
  const names = { c:"On-site service", b:"Utility hosting at street and nearby", a:"Grid proximity", d:"Load history" };
  return <section className="power-evidence" data-evidence="power"><h3>Power</h3>
    <dl className="record-economics">{(["c","b","a","d"] as const).map(id => {
      const fact = facts.find(item => item.id === id);
      if (!fact && id !== "c") return null;
      return <div key={id}><dt>{names[id]}</dt><dd>{[id === "c" && siteCapacity?.value, fact?.lines.join(" · ")].filter(Boolean).join(" · ") || "Unconfirmed"}{(fact || (id === "c" && siteCapacity)) && <small>{fact?.basis || [siteCapacity?.source,siteCapacity?.confidence,siteCapacity?.asOf].filter(Boolean).join(" · ") || "Source not recorded"}</small>}</dd></div>;
    })}</dl>
    <p><strong>Power rating</strong> · {rating.reason}</p>
    {signedIn && <PowerFollowUp deal={deal} site={site} />}
  </section>;
}
