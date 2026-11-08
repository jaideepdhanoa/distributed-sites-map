export type MapArea =
  | { kind: "radius"; lng: number; lat: number; miles: number }
  | { kind: "polygon"; points: [number, number][] };

function milesBetween(lng1: number, lat1: number, lng2: number, lat2: number) {
  const radius = 3958.8;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lng2 - lng1) * Math.PI) / 180;
  const arc = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(arc));
}

function pointInRing(lng: number, lat: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function inMapArea(lng: number, lat: number, area: MapArea | null): boolean {
  if (!area) return true;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (area.kind === "radius") {
    if (!area.miles || area.miles <= 0) return true;
    return milesBetween(lng, lat, area.lng, area.lat) <= area.miles + 1e-6;
  }
  if (area.points.length < 3) return true;
  return pointInRing(lng, lat, area.points);
}

export function parseMapArea(params: { get(name: string): string | null }): MapArea | null {
  const ring = params.get("ring");
  if (ring) {
    const [lng, lat, miles] = ring.split(",").map(Number);
    if ([lng, lat, miles].every((value) => Number.isFinite(value)) && miles > 0 && miles <= 30) {
      return { kind: "radius", lng, lat, miles };
    }
  }
  const poly = params.get("poly");
  if (!poly) return null;
  const points = poly.split(";").flatMap((pair) => {
    const [lng, lat] = pair.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    return [[lng, lat] as [number, number]];
  });
  return points.length >= 3 ? { kind: "polygon", points } : null;
}

export function areaQuery(area: MapArea | null): { ring: string | null; poly: string | null } {
  if (!area) return { ring: null, poly: null };
  if (area.kind === "radius") {
    return { ring: `${area.lng.toFixed(5)},${area.lat.toFixed(5)},${area.miles}`, poly: null };
  }
  return { ring: null, poly: area.points.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";") };
}
