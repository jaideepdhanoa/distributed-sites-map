"use client";

import { useEffect, useState } from "react";
import { courtFromWaiting, courtPill, daysSince, type NdaMirror } from "@/lib/nda";
import { pacificToday } from "@/lib/queue/today";

type Extra = { owner: string; next: string; pill: string };

function pillClass(label: string): string {
  const ours = label.startsWith("Our court");
  const days = Number(/(\d+)d/.exec(label)?.[1] || 0);
  return `court-pill ${ours ? "us" : "them"}${ours && days >= 14 ? " aged" : ""}`;
}

export default function NdaCardLine({ ndaId, mirror }: { ndaId: string; mirror?: Partial<NdaMirror> }) {
  const [extra, setExtra] = useState<Extra | null>(null);
  useEffect(() => {
    let cancel = false;
    fetch("/api/data/nda").then(async (response) => {
      if (!response.ok || cancel) return;
      const body = await response.json() as { queue?: { nda_id?: string; owner?: string; owner_name?: string; next_step?: string; court_pill?: string }[] };
      const row = (body.queue || []).find((item) => item.nda_id === ndaId);
      if (!cancel && row) setExtra({ owner: row.owner_name || row.owner || "", next: row.next_step || "", pill: row.court_pill || "" });
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [ndaId]);
  const pill = extra?.pill || courtPill(courtFromWaiting(mirror?.nda_waiting_on || ""), daysSince(mirror?.stage_blocker_since || "", pacificToday()));
  const owner = extra ? (extra.owner || "Unassigned") : "";
  return (
    <div className="nda-card-line" data-testid="nda-card-line">
      <p>
        <span>NDA</span>
        <span aria-hidden="true">·</span>
        <span>{ndaId}</span>
        {pill ? <span className={pillClass(pill)}>{pill}</span> : null}
        {owner ? <><span aria-hidden="true">·</span><span>{owner}</span></> : null}
      </p>
      {extra ? <p className="note">{extra.next || "No next step"}</p> : null}
    </div>
  );
}
