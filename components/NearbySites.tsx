import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { milesBetween, type MapArea } from "@/lib/geoFilter";

type Location = { id: string; name: string; point?: [number, number] | null };

export default function NearbySites({ locations, area, onPick, onSpot, fact }: {
  locations: Location[]; area: Extract<MapArea, { kind: "polygon" }>; onPick: (id: string) => void;
  onSpot: (point: [number, number] | null) => void; fact: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(8);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const sync = () => setOpen(desktop.matches);
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const spot = open ? locations.find(row => row.id === (hover || focus))?.point : null;
  const [[west, south], , [east, north]] = area.points;
  const x = spot?.[0], y = spot?.[1];
  useEffect(() => {
    onSpot(x != null && y != null && x >= west && x <= east && y >= south && y <= north ? [x, y] : null);
    return () => onSpot(null);
  }, [x, y, west, east, south, north, onSpot]);
  const lng = (west + east) / 2, lat = (south + north) / 2;
  const nearby = locations.flatMap(({ id, name, point }) => {
    if (!point || point[0] < west || point[0] > east || point[1] < south || point[1] > north) return [];
    return [{ id, name, distance: milesBetween(lng, lat, ...point) }];
  }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  return <aside className="nearby-sites" aria-label="Nearby sites">
    <button type="button" className="paper-btn nearby-toggle" aria-expanded={open} aria-controls="nearby-results"
      onClick={() => { setOpen(!open); setLimit(8); setHover(null); setFocus(null); }}>
      <span>Nearby sites</span><span className="nearby-count">{nearby.length}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div id="nearby-results">
      {nearby.length ? <><small>Closest to the center of this map</small>
        <ul>{nearby.slice(0, limit).map(row => <li key={row.id}>
          <button type="button" className="menu-item" data-nearby-id={row.id}
            onMouseEnter={() => setHover(row.id)} onMouseLeave={() => setHover(null)}
            onFocus={() => { setFocus(row.id); setHover(null); }} onBlur={() => setFocus(null)} onClick={() => onPick(row.id)}>
            <span>{row.name}<small>{fact(row.id)}</small></span><ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>)}</ul>
        {nearby.length > limit && <button type="button" className="text-link" onClick={() => setLimit(n => n + 8)}>Show more sites</button>}
      </> : <p>No matching sites in this map area. Zoom out or pan to see more.</p>}
    </div>}
  </aside>;
}
