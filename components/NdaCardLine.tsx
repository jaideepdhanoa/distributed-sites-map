"use client";

import { useEffect, useState } from "react";
import { courtFromWaiting, courtPill, daysSince, type NdaMirror } from "@/lib/nda";
import { pacificToday } from "@/lib/queue/today";

type Extra = { owner: string; next: string; pill: string };

export default function NdaCardLine({ ndaId, mirror }: { ndaId: string; mirror?: Partial<NdaMirror> }) {
  const [extra, setExtra] = useState<Extra | null>(null);
  useEffect(() => {
    let cancel = false;
    fetch("/api/data/nda").then(async (response) => {
      if (!response.ok || cancel) return;
      const body = await response.json() as { queue?: { nda_id?: string; owner?: string; next_step?: string; court_pill?: string }[] };
      const row = (body.queue || []).find((item) => item.nda_id === ndaId);
      if (!cancel && row) setExtra({ owner: row.owner || "", next: row.next_step || "", pill: row.court_pill || "" });
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [ndaId]);
  const pill = extra?.pill || courtPill(courtFromWaiting(mirror?.nda_waiting_on || ""), daysSince(mirror?.stage_blocker_since || "", pacificToday()));
  const bits = [ndaId, pill, extra?.owner].filter(Boolean);
  return (
    <div data-testid="nda-card-line">
      <p>{bits.join(" · ")}</p>
      {extra?.next ? <p className="note">{extra.next}</p> : null}
    </div>
  );
}
