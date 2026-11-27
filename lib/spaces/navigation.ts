import type { Option } from "./options";

export function navigateSpaces(open: boolean, site?: string, area?: string, layout?: Option) {
  const url = new URL(window.location.href);
  const enteringFromMap = open && !url.searchParams.has("spaces");
  for (const key of ["spaces", "spaceSite", "spaceArea", "spaceLayout", "discussion", "note"])
    url.searchParams.delete(key);
  if (!open) url.searchParams.delete("spaceScope");
  if (enteringFromMap) url.searchParams.set("spaceScope", "map");
  if (open) {
    url.searchParams.set("spaces", "1");
    url.searchParams.delete("view");
  }
  if (site) url.searchParams.set("spaceSite", site);
  if (area) url.searchParams.set("spaceArea", area);
  if (layout) url.searchParams.set("spaceLayout", layout);
  window.history.pushState(null, "", url);
}
