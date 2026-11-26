"use client";

import { useRef, useState } from "react";
import { formatArea } from "@/lib/spaces/measure";
import { spaceTypeLabel } from "@/lib/spaces/vocab";
import type { SpaceShape } from "./SpacePopover";

export default function SavedLots({ lots, remove }: {
  lots: SpaceShape[];
  remove?: (lot: SpaceShape, key: string) => Promise<void>;
}) {
  const [target,setTarget] = useState<SpaceShape|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const request = useRef("");
  const saving = useRef(false);
  if (!lots.length) return null;

  async function confirm() {
    if (!target || !remove || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await remove(target,request.current);
      setTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This lot could not be removed.");
    } finally { saving.current=false; setBusy(false); }
  }
  return <details className="disclosure" data-testid="saved-manual-lots">
    <summary className="disclosure">Saved Draw lots ({lots.length})</summary>
    <ul>{lots.map(lot=><li key={lot.id}>
      <strong>{spaceTypeLabel(lot.type)}</strong> · {lot.id} · {formatArea(lot.box.lengthFt*lot.box.widthFt)}
      {remove && target?.id!==lot.id && <button type="button" className="text-link" disabled={busy}
        aria-label={"Remove "+lot.id} onClick={()=>{setTarget(lot);request.current=crypto.randomUUID();setError("");}}>Remove</button>}
      {target?.id===lot.id && <div><p>Remove this saved lot from the site map?</p>
        <button type="button" className="paper-btn" disabled={busy} onClick={()=>{setTarget(null);setError("");}}>Cancel</button>
        <button type="button" className="text-link" disabled={busy} aria-label={"Confirm removal of "+lot.id}
          onClick={()=>void confirm()}>{busy?"Removing…":"Remove lot"}</button>
        {error && <p role="alert">{error}</p>}</div>}
    </li>)}</ul>
  </details>;
}
