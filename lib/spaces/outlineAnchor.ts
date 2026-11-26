import { kinds, type Assessment, type Zone } from "./options";

export function outlineId(zone: Zone) {
  return "outline:" + kinds[zone.kind].option + ":" + zone.label;
}

export function findOutline(row: Assessment | undefined, id: string) {
  return row?.status === "reviewed" ? row.zones.find(zone => zone.kind !== "clear" && outlineId(zone) === id) : undefined;
}

export function outlineHref(site: string, id: string, note?: string) {
  const query = new URLSearchParams({ site, panel: "space-options", outline: id });
  if (note) query.set("note", note);
  return "/space-review?" + query.toString();
}
