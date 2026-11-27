import clip from "polygon-clipping";
import { geodesicInverse } from "./measure";
import { AISLE_FT, STALL_DEPTH_FT, STALL_WIDTH_FT, stallFootprint } from "./slots";
import { usableOutline, type Aerial, type Point, type Zone } from "./options";

type Frame = Pick<Aerial, "width" | "height" | "bounds" | "metersPerPixel">;
export type Angle = 45 | 60 | 90;
export type RowSpec = { area: string; edge: number; angle: Angle; count: number; sharedAisle?: boolean; offset?:number };
export type ParcelCase = {
  name: string; condition: string; rows: RowSpec[]; approach?: Point[];
  conversionCost?: number; lostAnnualCash?: number; system?: boolean;
};
export type Sketch = { stalls: Point[][]; aisles: Point[][]; firstSlot?:number; approach?:Point[] };
export const inventoryLabels = { parking: "Existing parking", ground: "Undeveloped ground", operations: "Outdoor operations and access", bays: "Service or wash bays" };
export type Inventory = Record<keyof typeof inventoryLabels, string>;

function feetPerPercent(frame?: Frame): Point | null {
  if (!frame) return null;
  if (frame.bounds) {
    const [w,n,e,s] = frame.bounds;
    const lat = (n+s)/2;
    const width = geodesicInverse({lng:w,lat}, {lng:e,lat}).meters;
    const height = geodesicInverse({lng:w,lat:n}, {lng:w,lat:s}).meters;
    return width > 0 && height > 0 ? [width/30.48,height/30.48] : null;
  }
  if (!frame.metersPerPixel) return null;
  return [frame.width*frame.metersPerPixel/30.48,frame.height*frame.metersPerPixel/30.48];
}
function signedArea(points: Point[]) {
  return points.reduce((sum,[x,y],i) => {
    const next = points[(i+1)%points.length];
    return sum + x*next[1]-y*next[0];
  },0)/2;
}
function surface(polygons: ReturnType<typeof clip.intersection>) {
  return polygons.reduce((sum,polygon) => sum + Math.abs(signedArea(polygon[0])) -
    polygon.slice(1).reduce((holes,ring) => holes + Math.abs(signedArea(ring)),0),0);
}
const tolerance = 0.000001;
function overlaps(a: Point[], b: Point[]) {
  // Most rows are in disjoint courts. Skip the polygon operation for disjoint boxes.
  for (const axis of [0,1]) {
    const av=a.map(p=>p[axis]), bv=b.map(p=>p[axis]);
    if (Math.max(...av)<=Math.min(...bv) || Math.max(...bv)<=Math.min(...av)) return false;
  }
  return surface(clip.intersection([a],[b])) > tolerance;
}
function fits(outline: Point[], candidate: Point[], blocked: Point[][]) {
  return surface(clip.difference([candidate],[outline])) <= tolerance && !blocked.some(hole => overlaps(candidate,hole));
}

/** A row starts at the chosen curb edge. Its drive aisle must also fit inside the traced area. */
export function sketchRow(zone: Zone, frame: Frame | undefined, edge: number, angle: Angle, limit: number, excluded: Point[][], assumedShared = false, adjacentObstacles:Point[][] = [], offset=0): Sketch | null {
  const scale = feetPerPercent(frame);
  if (!scale || zone.fitHold || (zone.kind==="clear" || zone.kind==="bay" && !assumedShared) || !usableOutline(zone.points) ||
      !Number.isInteger(edge) || !zone.points[edge] || ![45,60,90].includes(angle) || !(limit > 0)) return null;
  const start = zone.points[edge], end = zone.points[(edge+1)%zone.points.length];
  const dx = (end[0]-start[0])*scale[0], dy = (end[1]-start[1])*scale[1];
  const length = Math.hypot(dx,dy);
  if (!length) return null;
  const u = dx/length, v = dy/length, side = Math.sign(signedArea(zone.points));
  const point = (x: number,y: number): Point => [start[0]+(u*x-side*v*y)/scale[0],start[1]+(v*x+side*u*y)/scale[1]];
  const radians = angle*Math.PI/180, sin=Math.sin(radians), cos=Math.cos(radians);
  const {alongFt:pitch,depthFt:depth} = stallFootprint(angle);
  const aisle = AISLE_FT[angle === 90 ? "stalls_90" : angle === 60 ? "stalls_60" : "stalls_45"];
  const width=STALL_WIDTH_FT, long=STALL_DEPTH_FT, span=width*sin+long*cos;
  const sketch: Sketch = {stalls:[],aisles:[]};
  // A single uninterrupted group. Try again after an island or notch.
  let group: Point[][] = [];
  let first = 0;
  for (let slot=offset; slot<100 && slot*pitch+span<=length+1e-6; slot++) {
    const x = slot*pitch;
    const stall = [point(x,width*cos),point(x+width*sin,0),point(x+span,long*sin),point(x+long*cos,depth)];
    const candidateFirst = group.length ? first : x;
    const near = assumedShared ? -aisle : depth, far = assumedShared ? 0 : depth+aisle;
    const lane = [point(candidateFirst,near),point(x+span,near),point(x+span,far),point(candidateFirst,far)];
    // A shared aisle is a conditional use of adjoining ground. It must still fit on
    // the source image and avoid all mapped keep-clear areas.
    const laneFits = assumedShared ? lane.every(p=>p.every(n=>n>=-1e-8 && n<=100+1e-8)) &&
      ![...excluded,...adjacentObstacles].some(hole=>overlaps(lane,hole)) : fits(zone.points,lane,excluded);
    if (!fits(zone.points,stall,excluded) || !laneFits) { group=[]; continue; }
    first=candidateFirst;
    group.push(stall);
    if (group.length>sketch.stalls.length) { sketch.stalls=[...group]; sketch.aisles=[lane]; sketch.firstSlot=slot-group.length+1; }
    if (group.length>=limit) break;
  }
  return sketch;
}

export function adjacentObstacles(zone: Zone, zones: Zone[]) {
  return zones.filter(z=>z!==zone && (z.kind==="bay" || z.kind==="ground" || z.fitHold)).map(z=>z.points);
}

export function compatible(a:Sketch,b:Sketch) {
  return !a.stalls.some(stall=>[...b.stalls,...b.aisles].some(shape=>overlaps(stall,shape)))
    && !a.aisles.some(aisle=>b.stalls.some(stall=>overlaps(aisle,stall)));
}

export function sketchCase(proposal: ParcelCase, zones: Zone[], frame?: Frame): Sketch | null {
  const result: Sketch = {stalls:[],aisles:[]};
  const blocked = zones.filter(z=>z.kind==="clear").map(z=>z.points);
  for (const row of proposal.rows) {
    const zone = zones.find(z=>z.label===row.area);
    const drawn = zone && sketchRow(zone,frame,row.edge,row.angle,row.count,blocked,!!proposal.system && row.sharedAisle,adjacentObstacles(zone,zones),row.offset);
    if (!drawn || drawn.stalls.length !== row.count ||
        !compatible(drawn,result)) return null;
    result.stalls.push(...drawn.stalls);
    result.aisles.push(...drawn.aisles);
  }
  return result.stalls.length ? {...result,approach:proposal.approach} : null;
}

export function rotateOutline(points: Point[], degrees: number, frame?: Frame): Point[] | null {
  const scale=feetPerPercent(frame) || (frame?.width && frame.height ? [frame.width,frame.height] : null);
  if (!scale || !points.length) return null;
  const cx=points.reduce((s,p)=>s+p[0],0)/points.length, cy=points.reduce((s,p)=>s+p[1],0)/points.length;
  const a=degrees*Math.PI/180;
  const moved=points.map(([x,y]):Point=>{
    const dx=(x-cx)*scale[0], dy=(y-cy)*scale[1];
    return [cx+(dx*Math.cos(a)-dy*Math.sin(a))/scale[0],cy+(dx*Math.sin(a)+dy*Math.cos(a))/scale[1]].map(v=>Math.round(v*1e9)/1e9) as Point;
  });
  return usableOutline(moved) ? moved : null;
}

/** Find an inspectable single row with its own aisle. Disjoint rows require a filed case. */
export function bestRow(zone:Zone,frame:Frame|undefined,excluded:Point[][]) {
  let best: {edge:number;angle:Angle;stalls:number}|null=null;
  for(let edge=0;edge<zone.points.length;edge++) {
    for(const angle of [90,60,45] as const) {
      const sketch=sketchRow(zone,frame,edge,angle,100,excluded);
      if(sketch && (!best || sketch.stalls.length>best.stalls)) best={edge,angle,stalls:sketch.stalls.length};
    }
  }
  return best;
}
