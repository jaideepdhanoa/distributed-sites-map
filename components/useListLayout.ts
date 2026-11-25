"use client";

import { useSearchParams } from "next/navigation";
import { currentSearch, rememberSearch } from "@/lib/navSearch";
import { useEffect, useRef, useState } from "react";
import { layoutStorageKey, sanitizeLayout, type LayoutSurface, type ListLayout } from "@/lib/listLayout";

export function useListLayout(options: {
  surface: LayoutSurface;
  signedIn: boolean;
  userId: string;
  allowed: string[];
  seed: ListLayout | null;
  fallback: ListLayout;
}) {
  const { surface, signedIn, userId, allowed, seed, fallback } = options;
  const params = useSearchParams();
  const snapshotKey = surface + "Layout";
  const snapshot = params.get(snapshotKey);
  const allowedKey = allowed.join(",");
  const key = layoutStorageKey(surface, signedIn ? userId : "anon");
  const [layout, setLayout] = useState<ListLayout>(() => sanitizeLayout(fallback, allowed));
  const [ready, setReady] = useState(false);
  const dirty = useRef(false);
  const seedRef = useRef(seed);
  const fallbackRef = useRef(fallback);
  seedRef.current = seed;
  fallbackRef.current = fallback;

  useEffect(() => {
    const known = allowedKey.split(",").filter(Boolean);
    let cancel = false;
    dirty.current = false;
    let stored: ListLayout | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) stored = sanitizeLayout(JSON.parse(raw) as unknown, known);
    } catch {
      stored = null;
    }
    if (stored) setLayout(stored);
    else if (seedRef.current) setLayout(sanitizeLayout(seedRef.current, known));
    else setLayout(sanitizeLayout(fallbackRef.current, known));
    if (!signedIn || !userId) {
      setReady(true);
      return () => {
        cancel = true;
      };
    }
    fetch(`/api/list/layout?surface=${surface}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || cancel || dirty.current) return;
        const body = (await response.json()) as { layout?: unknown; stored?: boolean };
        if (cancel || dirty.current || !body.stored || !body.layout) return;
        const next = sanitizeLayout(body.layout, known);
        setLayout(next);
        window.localStorage.setItem(key, JSON.stringify(next));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancel) setReady(true);
      });
    return () => {
      cancel = true;
    };
  }, [allowedKey, key, signedIn, surface, userId]);

  useEffect(() => {
    if (!ready || !signedIn || !userId) return undefined;
    const timer = window.setTimeout(() => {
      void fetch("/api/list/layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ surface, layout }),
      }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [layout, ready, signedIn, surface, userId]);

  function update(next: ListLayout) {
    dirty.current = true;
    const clean = sanitizeLayout({ ...next, touched: true }, allowed);
    if (snapshot !== null) {
      const query = new URLSearchParams(currentSearch());
      query.set(snapshotKey, JSON.stringify(clean));
      const href = "/?" + query;
      rememberSearch(href);
      window.history.replaceState(null, "", href);
      return;
    }
    setLayout(clean);
    try {
      window.localStorage.setItem(key, JSON.stringify(clean));
    } catch {
      // A full browser store still leaves the sheet usable for this visit.
    }
  }

  if (snapshot !== null) {
    try { return { layout: sanitizeLayout(JSON.parse(snapshot), allowed), update, ready: true }; }
    catch { /* An old or incomplete link falls back to the personal layout. */ }
  }
  return { layout, update, ready };
}
