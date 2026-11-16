"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { PaletteGroups, PaletteHit } from "@/lib/search/palette";

type Groups = PaletteGroups;

const EMPTY: Groups = { sites: [], brokers: [], conversations: [] };

function count(groups: Groups) {
  return groups.sites.length + groups.brokers.length + groups.conversations.length;
}

function filled(remote: Groups, local: Groups): Groups {
  return {
    sites: remote.sites.length ? remote.sites : local.sites,
    brokers: remote.brokers.length ? remote.brokers : local.brokers,
    conversations: remote.conversations.length ? remote.conversations : local.conversations,
  };
}

function openPath(hit: PaletteHit): string {
  const url = new URL(hit.path || hit.url || "/", "https://distributedsites.com");
  const next = new URLSearchParams();
  const site = url.searchParams.get("site");
  if (site) next.set("site", site);
  for (const key of ["panel", "msg", "pl", "sheet"] as const) {
    const value = url.searchParams.get(key);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return query ? `/?${query}` : "/";
}

export default function CommandSearch({
  open,
  onClose,
  fallback,
}: {
  open: boolean;
  onClose: () => void;
  fallback?: (query: string) => Groups;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Groups>(EMPTY);
  const input = useRef<HTMLInputElement>(null);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  function choose(hit: PaletteHit) {
    const href = openPath(hit);
    onClose();
    router.push(href);
  }

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setGroups(EMPTY);
      return;
    }
    const local = fallbackRef.current?.(needle) || EMPTY;
    setGroups(local);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { mode?: string; groups?: Groups } | null) => {
          if (ctrl.signal.aborted) return;
          const remote = body?.groups || EMPTY;
          const useRemote = (body?.mode === "index" || body?.mode === "records") && count(remote) > 0;
          setGroups(useRemote ? filled(remote, fallbackRef.current?.(needle) || EMPTY) : (fallbackRef.current?.(needle) || EMPTY));
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setGroups(fallbackRef.current?.(needle) || EMPTY);
        });
    }, 160);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const sections = [
    ["Sites", groups.sites],
    ["Brokers", groups.brokers],
    ["Conversations", groups.conversations],
  ] as const;
  const any = count(groups);
  const first = groups.sites[0] || groups.brokers[0] || groups.conversations[0];
  return createPortal(
    <>
    <button type="button" className="backdrop command-backdrop" aria-label="Close search" onClick={onClose} />
    <div className="command-search" role="dialog" aria-label="Search everything" data-testid="command-search">
      <header className="command-head">
        <p className="eyebrow">Search</p>
        <button type="button" className="close" aria-label="Close search" onClick={onClose}><span aria-hidden="true">×</span></button>
      </header>
      <input
        ref={input}
        className="search"
        aria-label="Search everything"
        placeholder="Sites, brokers, conversations"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !first) return;
          event.preventDefault();
          choose(first);
        }}
      />
      {query.trim().length >= 2 && any === 0 ? <p className="layer-meta" data-testid="command-empty">No matches.</p> : null}
      {any > 0 ? sections.map(([label, hits]) => (
        <section key={label} data-testid={`command-group-${label.toLowerCase()}`}>
          <p className="eyebrow">{label}</p>
          {hits.map((item) => (
            <button
              key={`${label}-${item.id}`}
              type="button"
              className="menu-item"
              data-testid="command-hit"
              onMouseDown={(event) => {
                event.preventDefault();
                choose(item);
              }}
            >
              <span className="hit-title">{item.title}</span>
            </button>
          ))}
        </section>
      )) : null}
    </div>
    </>,
    document.body,
  );
}
