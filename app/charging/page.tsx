"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChargingEditor } from "@/components/ChargingEconomics";
function SiteCase() {
  const params=useSearchParams(), site=params.get("site")||"";
  return <main className="space-review-page"><a className="text-link" href="/selection-review">← Selection review</a>
    {site?<ChargingEditor key={site} site={site}/>:<p>Choose a site in Selection review.</p>}</main>;
}
export default function ChargingPage(){return <Suspense fallback={<main>Loading site case…</main>}><SiteCase/></Suspense>;}
