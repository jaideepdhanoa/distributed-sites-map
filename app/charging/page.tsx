"use client";
import "./explanation.css";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { reviewReturn } from "@/lib/reviewNavigation";
import { ChargingEditor } from "@/components/ChargingEconomics";
function SiteCase() {
  const params=useSearchParams(), site=params.get("site")||"";
  const back=reviewReturn(params.get("returnTo"),["/","/selection-review"],"/selection-review");
  const label=back.startsWith("/selection-review") ? "← Selection review" : "← Back to site review";
  return <main className="space-review-page charging-page"><a className="text-link" href={back}>{label}</a>
    {site?<ChargingEditor key={site} site={site} revision={params.get("case")} screenId={params.get("screen")} basis={params.get("basis")} layoutName={params.get("layout")} omitted={params.getAll("omit")} explain={params.get("view")==="explain"}/>:<p>Choose a site in Selection review.</p>}</main>;
}
export default function ChargingPage(){return <Suspense fallback={<main>Loading site case…</main>}><SiteCase/></Suspense>;}
