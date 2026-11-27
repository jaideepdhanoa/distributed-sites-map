import type { Aerial, Point } from "@/lib/spaces/options";
import { rotateOutline } from "@/lib/spaces/parcelLayout";

export default function OutlineTools({points,corner,frame,onChange,disabled}: {
  points:Point[];corner:number;frame?:Aerial;onChange:(next:Point[],index:number)=>void;disabled:boolean
}) {
  const next=(corner+1)%points.length, a=points[corner], b=points[next];
  if(!a || !b)return null;
  return <div className="space-actions" aria-label="Outline geometry">
    {[-5,5].map(degrees=>{
      const rotated=rotateOutline(points,degrees,frame);
      return <button type="button" className="paper-btn" disabled={disabled || !rotated} key={degrees}
        onClick={()=>rotated && onChange(rotated,corner)}>Rotate {degrees}°</button>;
    })}
    <button type="button" className="paper-btn" disabled={disabled || points.length>=40} onClick={()=>{
      const added:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      onChange([...points.slice(0,corner+1),added,...points.slice(corner+1)],corner+1);
    }}>Add corner</button>
    <button type="button" className="text-link" disabled={disabled || points.length<=3} onClick={()=>
      onChange(points.filter((_,i)=>i!==corner),Math.min(corner,points.length-2))}>Remove corner</button>
  </div>;
}
