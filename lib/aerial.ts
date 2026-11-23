/** The same Esri World Imagery service the map already uses. One image, sized to the card. */
const EXPORT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
const EARTH = 20037508.342789244;
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 320;

export type AerialFrame = {
  url: string;
  width: number;
  height: number;
};

function finite(lat?: number | null, lng?: number | null): boolean {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
}

function mercator(lat: number, lng: number) {
  const x = (lng * EARTH) / 180;
  const rad = (lat * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + rad / 2)) * (EARTH / Math.PI);
  return { x, y };
}

/** One satellite image centered on the site, matching the card frame. */
export function aerialTile(lat?: number | null, lng?: number | null, zoom = 17): AerialFrame | null {
  if (!finite(lat, lng)) return null;
  const point = mercator(lat as number, lng as number);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const metersPerPixel = (2 * EARTH) / (256 * 2 ** zoom);
  const halfW = (FRAME_WIDTH / 2) * metersPerPixel;
  const halfH = (FRAME_HEIGHT / 2) * metersPerPixel;
  const bbox = [point.x - halfW, point.y - halfH, point.x + halfW, point.y + halfH].map((value) => value.toFixed(2)).join(",");
  const url = `${EXPORT}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${FRAME_WIDTH},${FRAME_HEIGHT}&format=jpg&f=image`;
  return { url, width: FRAME_WIDTH, height: FRAME_HEIGHT };
}

/** A maps link only. Nothing here requests or stores a Street View image. */
export function streetViewHref(lat?: number | null, lng?: number | null): string {
  if (!finite(lat, lng)) return "";
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}
