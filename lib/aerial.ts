/** The same Esri World Imagery tiles the map already requests. No extra service. */
const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

export type AerialTile = {
  url: string;
  left: number;
  top: number;
};

function finite(lat?: number | null, lng?: number | null): boolean {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
}

/** One satellite tile, shifted so the site sits in the middle of the crop. */
export function aerialTile(lat?: number | null, lng?: number | null, zoom = 17): AerialTile | null {
  if (!finite(lat, lng)) return null;
  const size = 256;
  const n = 2 ** zoom;
  const xFloat = ((lng as number) + 180) / 360 * n;
  const latRad = (lat as number) * Math.PI / 180;
  const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  if (!Number.isFinite(xFloat) || !Number.isFinite(yFloat)) return null;
  const x = Math.floor(xFloat);
  const y = Math.floor(yFloat);
  const cropW = 320;
  const cropH = 160;
  return {
    url: `${TILE}/${zoom}/${y}/${x}`,
    left: cropW / 2 - (xFloat - x) * size,
    top: cropH / 2 - (yFloat - y) * size,
  };
}

/** A maps link only. Nothing here requests or stores a Street View image. */
export function streetViewHref(lat?: number | null, lng?: number | null): string {
  if (!finite(lat, lng)) return "";
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}
