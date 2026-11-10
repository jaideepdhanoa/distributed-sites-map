"use client";

import { useCallback, useEffect, useState } from "react";
import { seesRecommendations, showSuggestedBlock } from "@/lib/agent/access";
import type { VisibleRecommendation } from "@/lib/agent/recommend";
import { useActionStatus } from "../actions/panel";

export function useRecommendations(recordId: string) {
  const status = useActionStatus();
  const [rows, setRows] = useState<VisibleRecommendation[]>([]);
  const allowed = seesRecommendations(status.username);

  const reload = useCallback(() => {
    if (!allowed || !recordId) {
      setRows([]);
      return;
    }
    const query = new URLSearchParams({ recordId });
    fetch(`/api/actions/recommendations?${query}`)
      .then(async (response) => {
        if (!response.ok) return [];
        const body = (await response.json()) as { recommendations?: VisibleRecommendation[] };
        return body.recommendations || [];
      })
      .then((next) => setRows(showSuggestedBlock(status.username, next)))
      .catch(() => setRows([]));
  }, [allowed, recordId, status.username]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function dismiss(id: string) {
    setRows((current) => current.filter((item) => item.id !== id));
    await fetch(`/api/actions/recommendations/${id}/dismiss`, { method: "POST" }).catch(() => undefined);
  }

  return { rows: showSuggestedBlock(status.username, rows), dismiss };
}
