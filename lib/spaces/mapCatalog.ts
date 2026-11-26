import { outlineId } from "./outlineAnchor";
import { readReview } from "./optionReview";
import type { Aerial, Assessment, Point, Zone } from "./options";

export type MapZone = Zone & { edited: boolean };
export type MapSpaceSite = {
  id: string;
  name: string;
  market: string;
  cohort: Assessment["cohort"];
  revision: string;
  frame: Pick<Aerial, "id" | "bounds" | "kind" | "source" | "date">;
  center: Point | null;
  zones: MapZone[];
};
export type SpaceCatalog = { sites: MapSpaceSite[]; reviewsAvailable: boolean };
export type OutlineNote = { target_id: string; body: string };

/** Notes arrive newest first. A replacement source starts with its own geometry. */
export function mapZones(site: string, row: Assessment, notes: OutlineNote[]): MapZone[] {
  const edits = new Map<string,Point[]>();
  for (const note of notes) {
    if (note.target_id !== site) continue;
    const review = readReview({body:note.body, deleted:false, parentId:null});
    if (!review?.points || review.frame !== row.image?.id) continue;
    const key = "outline:" + review.option + ":" + review.area;
    if (!edits.has(key)) edits.set(key,review.points);
  }
  return row.zones.map(zone => {
    const points = edits.get(outlineId(zone));
    return {...zone, points:points || zone.points, edited:Boolean(points)};
  });
}

export function spacesMapHref(site?: string, outline?: string) {
  const params = new URLSearchParams({ spaces: "1" });
  if (site) params.set("spaceSite", site);
  if (outline) params.set("spaceArea", outline);
  return "/?" + params.toString();
}
