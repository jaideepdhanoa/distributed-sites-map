"use client";
import "./explanation.css";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChargingEditor } from "@/components/ChargingEconomics";
function SiteCase() {
  const params=useSearchParams(), site=params.get("site")||"";
  const back=params.get("returnTo")??"";
  const route=back.split(/[?#]/)[0];
  const safe=(route==="/" || route==="/selection-review") && !back.includes("\\");
  return <main className="space-review-page charging-page"><a className="text-link" href={safe?back:"/selection-review"}>{safe && route==="/"?"← Back to site review":"← Selection review"}</a>
    {site?<ChargingEditor key={site} site={site} revision={params.get("case")} explain={params.get("view")==="explain"}/>:<p>Choose a site in Selection review.</p>}</main>;
}
export default function ChargingPage(){return <Suspense fallback={<main>Loading site case…</main>}><SiteCase/></Suspense>;}
