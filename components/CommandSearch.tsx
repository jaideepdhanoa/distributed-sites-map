"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { withoutGmail } from "@/lib/displayText";
import { rememberSearch } from "@/lib/navSearch";
import { filledSections, type PaletteGroups, type PaletteHit } from "@/lib/search/palette";
import { commandSheetBox } from "@/lib/search/sheet";

type Groups = PaletteGroups;

const EMPTY: Groups = { sites: [], brokers: [], conversations: [] };

function count(groups: Groups) {
  return groups.sites.length + groups.brokers.length + groups.conversations.length;
}

function mergeHits(remote: PaletteHit[], local: PaletteHit[]): PaletteHit[] {
  if (!remote.length) return local;
  const localById = new Map(local.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const merged: PaletteHit[] = [];
  for (const item of [...remote, ...local]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const extra = localById.get(item.id);
    merged.push({ ...extra, ...item, detail: item.detail || extra?.detail });
  }
  return merged;
}

function filled(remote: Groups, local: Groups): Groups {
  return {
    sites: mergeHits(remote.sites, local.sites),
    brokers: remote.brokers.length ? remote.brokers : local.brokers,
    conversations: remote.conversations.length ? remote.conversations : local.conversations,
  };
}

function shown(value: string | undefined): string {
  return withoutGmail(value || "");
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
  const [active, setActive] = useState(0);
  const queryKey = useRef("");
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  if (queryKey.current !== query) {
    queryKey.current = query;
    if (active !== 0) setActive(0);
  }
  if (open && !opened.current) {
    opened.current = true;
    if (query) setQuery("");
  }
  if (!open) opened.current = false;

  function choose(hit: PaletteHit) {
    const href = openPath(hit);
    rememberSearch(href);
    onClose();
    router.push(href);
  }

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = panel.current;
    const view = window.visualViewport;
    if (!node || !view) return;
    const place = () => {
      const box = commandSheetBox(window.innerHeight, { height: view.height, offsetTop: view.offsetTop });
      if (!box) {
        node.style.removeProperty("--command-bottom");
        node.style.removeProperty("--command-max");
        return;
      }
      node.style.setProperty("--command-bottom", `${box.bottom}px`);
      node.style.setProperty("--command-max", `${box.maxHeight}px`);
    };
    place();
    view.addEventListener("resize", place);
    view.addEventListener("scroll", place);
    return () => {
      view.removeEventListener("resize", place);
      view.removeEventListener("scroll", place);
    };
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

  const sections = filledSections(groups);
  const flat = sections.flatMap((section) => section.hits);
  const index = flat.length ? Math.min(active, flat.length - 1) : 0;
  const current = flat[index];

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [open, index, groups]);

  if (!open || typeof document === "undefined") return null;
  const any = count(groups);
  return createPortal(
    <>
    <button type="button" className="backdrop command-backdrop" aria-label="Close search" onClick={onClose} />
    <div ref={panel} className="command-search" role="dialog" aria-label="Search everything" data-testid="command-search">
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
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!flat.length) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActive((index + delta + flat.length) % flat.length);
            return;
          }
          if (event.key !== "Enter" || !current) return;
          event.preventDefault();
          choose(current);
        }}
      />
      <div className="command-results">
      {query.trim().length >= 2 && any === 0 ? <p className="layer-meta" data-testid="command-empty">No matches.</p> : null}
      {sections.map((section) => (
        <section key={section.label} data-testid={`command-group-${section.label.toLowerCase()}`}>
          <p className="eyebrow">{section.label}</p>
          {section.hits.map((item) => {
            const title = shown(item.title) || item.id;
            const meta = shown(item.detail) || [shown(item.site), shown(item.when)].filter(Boolean).join(" · ");
            const selected = item === current;
            return (
            <button
              key={`${section.label}-${item.id}`}
              type="button"
              className={selected ? "menu-item is-active" : "menu-item"}
              data-testid="command-hit"
              data-active={selected ? "true" : undefined}
              aria-selected={selected}
              onMouseMove={() => {
                const at = flat.indexOf(item);
                if (at >= 0) setActive(at);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(item);
              }}
            >
              <span className="hit-title">{title}</span>
              {meta ? <span className="hit-meta">{meta}</span> : null}
            </button>
            );
          })}
        </section>
      ))}
      </div>
    </div>
    </>,
    document.body,
  );
}
