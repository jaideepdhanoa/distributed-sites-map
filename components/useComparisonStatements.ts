"use client";
import { useEffect, useState } from "react";
import type { PnlStatement } from "@/lib/pnl/statement";

type Loaded = { pnl: PnlStatement; pnlDemo?: boolean };
export function useComparisonStatements(ids: string) {
  const [state, setState] = useState<{ids:string; rows:Record<string, Loaded | null>}>({ids:"",rows:{}});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    setState({ids,rows:{}});
    for (const id of ids.split("|")) {
      fetch("/api/data/financials/" + encodeURIComponent(id), {signal:controller.signal,cache:"no-store"})
        .then(async response => {
          if (!response.ok) throw Error();
          const body:Loaded = await response.json();
          return body.pnl && body.pnl.status !== "unavailable" ? body : null;
        }).catch(() => null).then(body => {
          if (!controller.signal.aborted) setState(prev => ({ids, rows:{...prev.rows,[id]:body}}));
        });
    }
    return () => controller.abort();
  },[ids,attempt]);
  return { rows:state.ids === ids ? state.rows : {}, retry:() => setAttempt(n => n+1) };
}
