import { milesBetween } from "@/lib/geoFilter";

export type WashSite = {
  id: string;
  name: string;
  lng: number | null;
  lat: number | null;
  businessType?: string | null;
  verdict?: string | null;
  landOnly?: boolean | null;
};

export type NearbyWash = {
  id: string;
  name: string;
  coordinates: [number, number];
  miles: number;
  band: "1" | "3";
};

const WITHIN_3 = 3;
const WITHIN_1 = 1;

function isWash(site: WashSite) {
  if (site.landOnly) return false;
  if ((site.verdict || "").toUpperCase() === "NOT_A_WASH") return false;
  const type = (site.businessType || "").trim().toLowerCase();
  if (type && type !== "car wash") return false;
  return true;
}

/**
 * Census washes with a real pin, within 3 miles of an open site.
 * Sites without coordinates are skipped. Nothing is invented.
 */
export function nearbyWashPoints(origin: [number, number], sites: WashSite[], exclude: ReadonlySet<string>): NearbyWash[] {
  const [lng, lat] = origin;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  const found: NearbyWash[] = [];
  for (const site of sites) {
    if (!site.id || exclude.has(site.id)) continue;
    if (!isWash(site)) continue;
    if (site.lng == null || site.lat == null || !Number.isFinite(site.lng) || !Number.isFinite(site.lat)) continue;
    const miles = milesBetween(lng, lat, site.lng, site.lat);
    if (miles < 0.01 || miles > WITHIN_3) continue;
    found.push({
      id: site.id,
      name: site.name || site.id,
      coordinates: [site.lng, site.lat],
      miles,
      band: miles <= WITHIN_1 ? "1" : "3",
    });
  }
  found.sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
  return found;
}
