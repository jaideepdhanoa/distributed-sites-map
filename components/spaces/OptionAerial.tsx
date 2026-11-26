import { useId, useState } from "react";
import type { Aerial, Zone, Point } from "@/lib/spaces/options";
import { kinds } from "@/lib/spaces/options";

export default function OptionAerial({ image, zones, active, corrected, onPoint }: {
  image: Aerial; zones: Zone[]; active?: string; corrected?: string; onPoint?: (point: Point) => void;
}) {
  const pattern = useId().replace(/:/g, "");
  const [failed, setFailed] = useState("");
  if (failed === image.id) return <p role="status">The source aerial could not be displayed. <button type="button" className="text-link" onClick={() => setFailed("")}>Retry image</button></p>;
  return <figure className="option-aerial">
    <svg viewBox={`0 0 ${image.width} ${image.height}`} role="img" aria-label={zones.length ? "Site aerial showing " + zones.map(z => z.label).join(", ") : "Source aerial of the site"}
      onClick={onPoint ? event => {
        const matrix = event.currentTarget.getScreenCTM();
        if (!matrix) return;
        const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        if (pt.x >= 0 && pt.y >= 0 && pt.x <= image.width && pt.y <= image.height) onPoint([Math.round(pt.x * 1000 / image.width) / 10, Math.round(pt.y * 1000 / image.height) / 10]);
      } : undefined}>
      <defs><pattern id={pattern} width="10" height="10" patternUnits="userSpaceOnUse"><path d="M-2 2L2 -2M0 10L10 0M8 12L12 8" stroke="white" strokeWidth="2.5" /></pattern></defs>
      <image onError={() => setFailed(image.id)} href={image.src} width={image.width} height={image.height} />
      {zones.map((z, i) => {
        const clear = z.kind === "clear", selected = !active || active === z.label;
        const points = z.points.map(([x,y]) => [x * image.width / 100, y * image.height / 100].join(",")).join(" ");
        const fill = clear ? "url(#" + pattern + ")" : z.kind === "bay" ? "#ffbb62" : "#64e5be";
        return <g key={z.label + i} opacity={clear || selected ? 1 : .65}><title>{z.label} · {kinds[z.kind].label}</title>
          <polygon points={points} fill={fill} fillOpacity={clear ? .7 : .35} stroke="#152b27" strokeWidth="4" vectorEffect="non-scaling-stroke" />
          <polygon points={points} fill="none" stroke={clear ? "#fff" : z.kind === "bay" ? "#ffe49a" : "#abffe0"} strokeWidth="2"
            strokeDasharray={clear || z.label === corrected ? undefined : "6 4"} vectorEffect="non-scaling-stroke" />
        </g>;
      })}
    </svg>
    <figcaption>{image.source} · {image.date || "Imagery date unknown"}</figcaption>
  </figure>;
}
