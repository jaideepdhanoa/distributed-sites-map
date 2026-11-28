import { outlineId } from "./outlineAnchor";
import { readReview } from "./optionReview";
import type { Aerial, Assessment, Point, Zone } from "./options";

export type MapZone = Zone & { edited: boolean };
export type MapSpaceSite = {
  id: string;
  name: string;
  market: string;
  pipelineTrack?:import("../selection/pipelineTrack").PipelineTrack;
  cohort: Assessment["cohort"];
  revision: string;
  frame: Pick<Aerial, "id" | "bounds" | "kind" | "source" | "date" | "width" | "height" | "metersPerPixel">;
  center: Point | null;
  assessed?: {stalls:number; maximum:number; combinations:number};
  zones: MapZone[];
};
export type SpaceCatalog = { sites: MapSpaceSite[]; reviewsAvailable: boolean };
export type OutlineNote = { target_id: string; body: string };

/** Notes arrive newest first. A replacement source starts with its own geometry. */
export function mapZones(site: string, row: Assessment, notes: OutlineNote[]): MapZone[] {
  const edits = new Map<string,Point[]>();
  const validations = new Map<string,{right:NonNullable<Zone["useRight"]>; points?:Point[]}>();
  for (const note of notes) {
    if (note.target_id !== site) continue;
    const review = readReview({body:note.body, deleted:false, parentId:null});
    if (!review || review.frame !== row.image?.id) continue;
    const key = "outline:" + review.option + ":" + review.area;
    if (!validations.has(key) && review.revision===row.revision && review.useRight)
      validations.set(key,{right:{status:review.useRight.status,detail:"See the recorded area review for evidence."},points:review.points});
    if (review.points && !edits.has(key)) edits.set(key,review.points);
  }
  return row.zones.map(zone => {
    const points = edits.get(outlineId(zone));
    const moved = !!points && JSON.stringify(points) !== JSON.stringify(zone.points);
    const validation = validations.get(outlineId(zone));
    const matches = validation && JSON.stringify(validation.points ?? zone.points) === JSON.stringify(points ?? zone.points);
    const rights = matches ? validation.right : moved && (validation || zone.useRight)
      ? {status:"unconfirmed" as const,detail:"Check that the recorded rights cover the edited footprint and its drive aisle."} : zone.useRight;
    return {...zone, points:points || zone.points, edited:Boolean(points), ...(rights ? {useRight:rights} : {})};
  });
}

export function spacesMapHref(site?: string, outline?: string) {
  const params = new URLSearchParams({ spaces: "1" });
  if (site) params.set("spaceSite", site);
  if (outline) params.set("spaceArea", outline);
  return "/?" + params.toString();
}
