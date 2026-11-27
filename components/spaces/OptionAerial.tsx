import { useId, useState } from "react";
import type { Aerial, Zone, Point } from "@/lib/spaces/options";
import { kinds } from "@/lib/spaces/options";

export default function OptionAerial({ image, zones, sketch, focus, active, labels=false, reviewed = [], onSelect, onPoint, corner, onCorner }: {
  focus?: Zone[]; sketch?: import("@/lib/spaces/parcelLayout").Sketch | null; image: Aerial; zones: Zone[]; active?: string; labels?:boolean; reviewed?: string[]; onSelect?: (area: string) => void; onPoint?: (point: Point, corner?: number) => void; corner?: number; onCorner?: (corner: number) => void;
}) {
  const frameLabel = image.kind === "site-plan" ? "Site plan" : image.kind === "site-photo" ? "Site photo" : "Site aerial";
  const points=focus?.flatMap(z=>z.points);
  let box=[0,0,image.width,image.height];
  if(points?.length) {
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const margin=Math.max(3,(Math.max(...xs)-Math.min(...xs))*.12,(Math.max(...ys)-Math.min(...ys))*.12);
    const left=Math.max(0,Math.min(...xs)-margin),top=Math.max(0,Math.min(...ys)-margin);
    box=[left*image.width/100,top*image.height/100,(Math.min(100,Math.max(...xs)+margin)-left)*image.width/100,
      (Math.min(100,Math.max(...ys)+margin)-top)*image.height/100];
  }
  const drawingSize=Math.min(box[2],box[3]);
  const pattern = useId().replace(/:/g, "");
  const [failed, setFailed] = useState("");
  function position(svg: SVGSVGElement, x: number, y: number): Point | undefined {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const pt = new DOMPoint(x, y).matrixTransform(matrix.inverse());
    if (pt.x < 0 || pt.y < 0 || pt.x > image.width || pt.y > image.height) return;
    return [Math.round(pt.x * 1000 / image.width) / 10, Math.round(pt.y * 1000 / image.height) / 10];
  }
  if (failed === image.id) return <p role="status">The source image could not be displayed. <button type="button" className="text-link" onClick={() => setFailed("")}>Retry image</button></p>;
  return <figure className="option-aerial">
    <svg viewBox={box.join(" ")} role="img" aria-label={zones.length ? frameLabel + " showing " + zones.map(z => z.label).join(", ") : frameLabel}
      onClick={onPoint ? event => {
        const point = position(event.currentTarget, event.clientX, event.clientY);
        if (point) onPoint(point);
      } : undefined}>
      <defs><pattern id={pattern} width="10" height="10" patternUnits="userSpaceOnUse"><path d="M-2 2L2 -2M0 10L10 0M8 12L12 8" stroke="white" strokeWidth="2.5" /></pattern></defs>
      <image onError={() => setFailed(image.id)} href={image.src} width={image.width} height={image.height} />
      {zones.map((z, i) => {
        const clear = z.kind === "clear", selected = !active || active === z.label;
        const points = z.points.map(([x,y]) => [x * image.width / 100, y * image.height / 100].join(",")).join(" ");
        const amber = labels && selected && !clear;
        const fill = clear ? "url(#" + pattern + ")" : amber ? "#ffbb3d" : z.kind === "bay" ? "#ffbb62" : "#64e5be";
        return <g key={z.label + i} opacity={clear || selected ? 1 : .65} onClick={!clear && onSelect ? () => onSelect(z.label) : undefined} style={!clear && onSelect ? { cursor: "pointer" } : undefined}><title>{z.label} · {kinds[z.kind].label}</title>
          <polygon points={points} fill={fill} fillOpacity={clear ? .7 : .35} stroke="#152b27" strokeWidth="4" vectorEffect="non-scaling-stroke" />
          <polygon points={points} fill="none" stroke={clear ? "#fff" : amber ? "#ffe08b" : z.kind === "bay" ? "#ffe49a" : "#abffe0"} strokeWidth="2"
            strokeDasharray={clear || reviewed.includes(z.label) ? undefined : "6 4"} vectorEffect="non-scaling-stroke" />
          {labels && !sketch && (clear || selected) && !onPoint && <text x={Math.max(image.width*.18,Math.min(image.width*.82,z.points.reduce((v,p)=>v+p[0],0)/z.points.length*image.width/100))}
            y={z.points.reduce((v,p)=>v+p[1],0)/z.points.length*image.height/100} textAnchor="middle" dominantBaseline="middle"
            fill="white" stroke="#17261e" strokeWidth={drawingSize*.012} paintOrder="stroke" fontSize={drawingSize*.032} fontWeight="700">{clear?"Keep clear":z.label}</text>}
        </g>;
      })}
      {sketch && (["aisles","stalls"] as const).map(key=>sketch[key].map((ring,i)=>
        <polygon key={key+i} pointerEvents="none" points={ring.map(([x,y])=>[x*image.width/100,y*image.height/100].join(",")).join(" ")}
          fill={key==="stalls"?"#126b9c":"#ebaa38"} fillOpacity={.66} stroke="white" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />))}
      {sketch?.approach && <polyline pointerEvents="none" points={sketch.approach.map(([x,y])=>[x*image.width/100,y*image.height/100].join(",")).join(" ")}
        fill="none" stroke="#fff8df" strokeWidth="3" strokeDasharray="6 3" vectorEffect="non-scaling-stroke"/>}
      {onPoint && zones.find(z => z.label === active)?.points.map(([x,y], index) => (
        <g key={index} transform={`translate(${x * image.width / 100},${y * image.height / 100})`}
          style={{touchAction:"none",cursor:"grab"}} onClick={event => event.stopPropagation()}
          onPointerDown={event => { event.preventDefault(); onCorner?.(index); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => {
            const svg = event.currentTarget.ownerSVGElement;
            if (!svg || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const point = position(svg, event.clientX, event.clientY);
            if (point) onPoint(point, index);
          }}>
          <circle r={drawingSize * .04} fill="transparent" />
          <circle r={drawingSize * .013} fill={index === corner ? "#ffe49a" : "white"} stroke="#152b27" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
    <figcaption>{image.source} · {image.kind === "site-plan" ? "Filed " : ""}{image.date || "Date unknown"}{image.documentUrl && <> · <a href={image.documentUrl} target="_blank" rel="noopener noreferrer" className="text-link">Open source</a></>}</figcaption>
  </figure>;
}
