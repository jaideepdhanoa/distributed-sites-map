import { adjacentObstacles, compatible, sketchCase, sketchRow, type ParcelCase, type RowSpec, type Sketch } from "./parcelLayout";
import type { Assessment, Zone } from "./options";
import type { ScaleFrame } from "./fitCheck";

type Pick = { rows: RowSpec[]; sketch: Sketch; flags: number };
const outdoor = 1, ground = 2, bay = 4, shared = 8;
const uses = (zone: Zone) => zone.kind === "bay" ? bay : zone.kind === "ground" ? ground :
  ["vacuum","storage","apron"].includes(zone.kind) ? outdoor : 0;
const size = (p: Pick) => p.sketch.stalls.length;
function join(a: Pick, b: Pick): Pick {
  return { rows:[...a.rows,...b.rows], flags:a.flags|b.flags,
    sketch:{stalls:[...a.sketch.stalls,...b.sketch.stalls],aisles:[...a.sketch.aisles,...b.sketch.aisles]} };
}
function scenario(flags:number) {
  const names=[];
  if (flags & outdoor) names.push("outdoor conversion");
  if (flags & ground) names.push("paving");
  if (flags & bay) names.push("bay conversion");
  if (flags & shared && !(flags & bay)) names.push("shared aisle");
  return names.length ? "With "+names.join(" + ") : "Existing parking and pads";
}
function conditions(flags:number) {
  const notes=["Release the drawn space and preserve access."];
  if (flags & shared) notes.push("Assumes use of the adjoining drive aisle shown.");
  if (flags & outdoor) notes.push("Assumes the outdoor operation can give up this area.");
  if (flags & ground) notes.push("Assumes the ground can be paved and drained.");
  if (flags & bay) notes.push("Assumes the outlined bay footprint is refitted to clear the drawn positions, with openings and access on the drawn edge.");
  if (flags & (outdoor|ground|bay)) notes.push("Additional works and displaced income need pricing.");
  return notes.join(" ");
}
function choices(zone:Zone, frame:ScaleFrame, blocked:Zone["points"][], obstacles:Zone["points"][], filed:RowSpec[]) {
  const picks:Pick[]=[];
  const flags=uses(zone);
  function add(row:RowSpec) {
    const sketch=sketchRow(zone,frame,row.edge,row.angle,row.count,blocked,row.sharedAisle,obstacles);
    if (!sketch?.stalls.length || filed.length && sketch.stalls.length!==row.count) return;
    picks.push({rows:[{...row,count:sketch.stalls.length}],sketch,flags:flags|(row.sharedAisle ? shared : 0)});
  }
  // A filed row records choices about usable edges and how much of a court is released.
  if (filed.length) {
    for (const row of filed) add(row);
    return picks;
  }
  for (let edge=0;edge<zone.points.length;edge++) {
    if (zone.kind!=="bay") for (const angle of [90,60,45] as const) add({area:zone.label,edge,angle,count:100});
    add({area:zone.label,edge,angle:90,count:100,sharedAisle:true});
  }
  // Two facing rows can use a common aisle inside a large court.
  const singles=picks.filter(p=>!(p.flags & shared));
  for(let i=0;i<singles.length;i++) for (const other of singles.slice(i+1)) {
    const first=singles[i];
    if (first.rows[0].edge!==other.rows[0].edge && compatible(first.sketch,other.sketch)) picks.push(join(first,other));
  }
  return picks;
}
// A long row can give up individual end stalls so a neighboring row or its approach fits.
function shortened(p:Pick):Pick[] {
  const source=p.sketch.stalls, lane=p.sketch.aisles[0], result:Pick[]=[];
  const translate=(point:Zone["points"][number],from:number,to:number):Zone["points"][number]=>
    [point[0]+source[to][0][0]-source[from][0][0],point[1]+source[to][0][1]-source[from][0][1]];
  for (let n=source.length-1;n>0;n--) for(let start=0;start+n<=source.length;start++) {
    const end=start+n-1, last=source.length-1;
    const aisle=[translate(lane[0],0,start),translate(lane[1],last,end),translate(lane[2],last,end),translate(lane[3],0,start)];
    result.push({flags:p.flags,rows:[{...p.rows[0],offset:(p.sketch.firstSlot??0)+start,count:n}],
      sketch:{stalls:source.slice(start,end+1),aisles:[aisle]}});
  }
  return result;
}
const empty=():Pick=>({rows:[],sketch:{stalls:[],aisles:[]},flags:0});
// Exact maximum over the enumerated alternatives, choosing at most one configuration per area.
function best(groups:Pick[][], allowed:number) {
  const options=groups.map(group=>group.filter(p=>(p.flags & ~allowed)===0)).filter(g=>g.length);
  const bound=Array<number>(options.length+1).fill(0);
  for (let i=options.length-1;i>=0;i--) bound[i]=bound[i+1]+size(options[i][0]);
  let winner=empty();
  function visit(at:number, taken:Pick) {
    if (size(taken)>size(winner)) winner=taken;
    if (at===options.length || size(taken)+bound[at]<=size(winner)) return;
    for (const p of options[at]) {
      if (size(taken)+size(p)+bound[at+1]<=size(winner)) break;
      if (compatible(taken.sketch,p.sketch)) visit(at+1,join(taken,p));
    }
    visit(at+1,taken);
  }
  visit(0,empty());
  return winner;
}

export function areaCounts(rows:RowSpec[]) {
  const parts=new Map<string,number>();
  for (const row of rows) parts.set(row.area,(parts.get(row.area)??0)+row.count);
  return Array.from(parts,([area,stalls])=>({area,stalls}));
}
/** An aerial establishes fit. Documented use covers both the stalls and the necessary vehicle access. */
export function layoutRights(rows: RowSpec[], zones: Zone[]) {
  let documented = 0, pending = 0;
  const checks = new Set<string>();
  for (const part of areaCounts(rows)) {
    const right = zones.find(z => z.label === part.area)?.useRight;
    if (right?.status === "documented") documented += part.stalls;
    else {
      pending += part.stalls;
      if (right?.detail) checks.add(right.detail);
    }
  }
  return {documented, pending, checks:[...checks]};
}
export function rightsSummary(rights: ReturnType<typeof layoutRights>) {
  if (!rights.pending) return "Use and access documented for all " + rights.documented;
  return (rights.documented ? rights.documented + " with documented use · " : "") + rights.pending + " pending use-rights validation";
}
export function assessedCases(zones:Zone[], frame:ScaleFrame, assessment:Assessment):ParcelCase[] {
  if (assessment.status!=="reviewed" || !(frame.bounds || frame.metersPerPixel)) return [];
  const filed=(assessment.parcelCases??[]).filter(c=>!c.rows.some(r=>zones.find(z=>z.label===r.area)?.useRight?.status==="unavailable") && sketchCase(c,zones,frame));
  const blocked=zones.filter(z=>z.kind==="clear").map(z=>z.points);
  const full=zones.filter(z=>z.kind!=="clear" && z.useRight?.status!=="unavailable" && !z.fitHold && zones.filter(other=>other.label===z.label).length===1)
    .map(z=>choices(z,frame,blocked,adjacentObstacles(z,zones),filed.flatMap(c=>c.rows.filter(r=>r.area===z.label))))
    .filter(g=>g.length);
  const groups=full.map((group,i)=>{
    const neighbors=full.filter((_,j)=>j!==i).flat();
    const partial=group.flatMap(p=>p.rows.length===1 && size(p)>1 &&
      !filed.some(c=>c.rows.some(r=>r.area===p.rows[0].area)) &&
      neighbors.some(other=>!compatible(p.sketch,other.sketch)) ? shortened(p) : []);
    return [...group,...partial].sort((a,b)=>size(b)-size(a)||a.flags-b.flags);
  });
  const masks=[0,shared,outdoor,outdoor|shared,ground,ground|shared,bay|shared,
    outdoor|ground,outdoor|ground|shared,outdoor|bay|shared,ground|bay|shared,outdoor|ground|bay|shared];
  const available=groups.flat().reduce((n,p)=>n|p.flags,0);
  const byMask=new Map<number,Pick>();
  const result:ParcelCase[]=[];
  const signature=(rows:RowSpec[])=>JSON.stringify(rows.map(r=>[r.area,r.edge,r.angle,r.count,!!r.sharedAisle,r.offset??0]).sort());
  for (const mask of masks) {
    if (mask & ~available) continue;
    const mix=best(groups,mask);
    if (!size(mix) || [...byMask].some(([m,p])=>(m&mask)===m && size(p)>=size(mix))) continue;
    byMask.set(mask,mix);
    const exact=filed.find(c=>signature(c.rows)===signature(mix.rows));
    result.push({ ...exact,system:true,name:scenario(mix.flags),rows:mix.rows,
      condition:exact?.condition??conditions(mix.flags) });
  }
  // Keep original named cases and their economic terms addressable, including saved links.
  return [...result,...filed];
}
