const KEY = "__sitesSearch";

function bag(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  return window as unknown as Record<string, string>;
}

/** The latest query this tab meant to show, even if the router has not committed it. */
export function currentSearch(): string {
  const stored = bag()?.[KEY];
  if (stored) {
    const query = stored.startsWith("?") ? stored : stored.includes("?") ? stored.slice(stored.indexOf("?")) : "";
    return query;
  }
  return typeof window === "undefined" ? "" : window.location.search;
}

export function rememberSearch(href: string) {
  const target = bag();
  if (target) target[KEY] = href;
}
