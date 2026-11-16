/**
 * Ground distance on the WGS84 ellipsoid (Vincenty). A parking rectangle is
 * built with the direct problem, so its sides are geodesic feet, not a
 * lng/lat box. The international foot is 0.3048 m.
 */

export type LngLat = { lng: number; lat: number };

export type GroundBox = {
  center: LngLat;
  lengthFt: number;
  widthFt: number;
  /** Clockwise degrees. 0 keeps the length axis east-west and the width axis north-south. */
  rotationDeg: number;
};

export type GeoPolygon = { type: "Polygon"; coordinates: number[][][] };

const A = 6378137;
const F = 1 / 298.257223563;
const B = (1 - F) * A;
const FEET_PER_METER = 1 / 0.3048;

export function normalizeDegrees(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function degrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function geodesicInverse(start: LngLat, end: LngLat): { meters: number; bearingDeg: number } {
  if (start.lat === end.lat && start.lng === end.lng) return { meters: 0, bearingDeg: 0 };
  const phi1 = radians(start.lat);
  const phi2 = radians(end.lat);
  const L = radians(end.lng - start.lng);
  const U1 = Math.atan((1 - F) * Math.tan(phi1));
  const U2 = Math.atan((1 - F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAlpha = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 100; i += 1) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return { meters: 0, bearingDeg: 0 };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    const next = L + (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(next - lambda) < 1e-12) {
      lambda = next;
      break;
    }
    lambda = next;
  }
  const u2 = cos2Alpha * ((A * A - B * B) / (B * B));
  const bigA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const bigB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const deltaSigma = bigB * sinSigma * (cos2SigmaM + (bigB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const meters = B * bigA * (sigma - deltaSigma);
  const bearing = degrees(Math.atan2(cosU2 * Math.sin(lambda), cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda)));
  return { meters, bearingDeg: (bearing + 360) % 360 };
}

export function geodesicDirect(start: LngLat, bearingDeg: number, meters: number): LngLat {
  if (meters < 1e-9) return { lng: start.lng, lat: start.lat };
  const alpha1 = radians(bearingDeg);
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);
  const phi1 = radians(start.lat);
  const U1 = Math.atan((1 - F) * Math.tan(phi1));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sigma1 = Math.atan2(Math.tan(U1), cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cos2Alpha = 1 - sinAlpha * sinAlpha;
  const u2 = cos2Alpha * ((A * A - B * B) / (B * B));
  const bigA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const bigB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  let sigma = meters / (B * bigA);
  let cos2SigmaM = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  for (let i = 0; i < 100; i += 1) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma = bigB * sinSigma * (cos2SigmaM + (bigB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    const next = meters / (B * bigA) + deltaSigma;
    if (Math.abs(next - sigma) < 1e-12) {
      sigma = next;
      sinSigma = Math.sin(sigma);
      cosSigma = Math.cos(sigma);
      cos2SigmaM = Math.cos(2 * sigma1 + sigma);
      break;
    }
    sigma = next;
  }
  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const phi2 = Math.atan2(sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1, (1 - F) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp));
  const lambda = Math.atan2(sinSigma * sinAlpha1, cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
  const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
  const L = lambda - (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  let lng = start.lng + degrees(L);
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return { lng, lat: degrees(phi2) };
}

export function geodesicFeet(start: LngLat, end: LngLat): number {
  return geodesicInverse(start, end).meters * FEET_PER_METER;
}

/** Local feet. Rotation 0: x is east, y is north. Positive rotation is clockwise. */
export function toLocalFeet(origin: LngLat, rotationDeg: number, point: LngLat): { x: number; y: number } {
  const { meters, bearingDeg } = geodesicInverse(origin, point);
  const bearing = radians(bearingDeg);
  const east = meters * Math.sin(bearing);
  const north = meters * Math.cos(bearing);
  const rot = radians(rotationDeg);
  return {
    x: (east * Math.cos(rot) - north * Math.sin(rot)) * FEET_PER_METER,
    y: (east * Math.sin(rot) + north * Math.cos(rot)) * FEET_PER_METER,
  };
}

export function fromLocalFeet(origin: LngLat, rotationDeg: number, xFt: number, yFt: number): LngLat {
  const rot = radians(rotationDeg);
  const east = (xFt * Math.cos(rot) + yFt * Math.sin(rot)) / FEET_PER_METER;
  const north = (-xFt * Math.sin(rot) + yFt * Math.cos(rot)) / FEET_PER_METER;
  const meters = Math.hypot(east, north);
  if (meters < 1e-8) return { lng: origin.lng, lat: origin.lat };
  const bearing = degrees(Math.atan2(east, north));
  return geodesicDirect(origin, bearing, meters);
}

function roundCoord(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

export function roundFeet(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Corners in counter-clockwise order: southwest, northwest, northeast, southeast at rotation 0. */
export function rectangleCorners(box: GroundBox): LngLat[] {
  const signs: [number, number][] = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ];
  return signs.map(([sx, sy]) => fromLocalFeet(box.center, box.rotationDeg, sx * box.lengthFt / 2, sy * box.widthFt / 2));
}

export function rectanglePolygon(box: GroundBox): GeoPolygon {
  const corners = rectangleCorners(box).map((point) => [roundCoord(point.lng), roundCoord(point.lat)]);
  return { type: "Polygon", coordinates: [[...corners, corners[0]]] };
}

export function measureRectangle(box: GroundBox): { lengthFt: number; widthFt: number; areaSqFt: number } {
  const corners = rectangleCorners(box);
  const edge = (from: LngLat, to: LngLat) => geodesicFeet(from, to);
  const lengthFt = (edge(corners[1], corners[2]) + edge(corners[0], corners[3])) / 2;
  const widthFt = (edge(corners[0], corners[1]) + edge(corners[3], corners[2])) / 2;
  return { lengthFt, widthFt, areaSqFt: lengthFt * widthFt };
}

export function axisAlignedBox(a: LngLat, b: LngLat): GroundBox {
  const origin = { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 };
  const pa = toLocalFeet(origin, 0, a);
  const pb = toLocalFeet(origin, 0, b);
  const center = fromLocalFeet(origin, 0, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
  return {
    center,
    lengthFt: Math.abs(pa.x - pb.x),
    widthFt: Math.abs(pa.y - pb.y),
    rotationDeg: 0,
  };
}

export function moveBox(box: GroundBox, from: LngLat, to: LngLat): GroundBox {
  const start = toLocalFeet(box.center, 0, from);
  const end = toLocalFeet(box.center, 0, to);
  return { ...box, center: fromLocalFeet(box.center, 0, end.x - start.x, end.y - start.y) };
}

export function rotateBox(box: GroundBox, pointer: LngLat): GroundBox {
  const local = toLocalFeet(box.center, 0, pointer);
  const bearing = degrees(Math.atan2(local.x, local.y));
  return { ...box, rotationDeg: normalizeDegrees(bearing) };
}

export function resizeBox(box: GroundBox, sx: number, sy: number, pointer: LngLat): GroundBox {
  const opposite = fromLocalFeet(box.center, box.rotationDeg, -sx * box.lengthFt / 2, -sy * box.widthFt / 2);
  const pointed = toLocalFeet(box.center, box.rotationDeg, pointer);
  const fixed = toLocalFeet(box.center, box.rotationDeg, opposite);
  const lengthFt = Math.abs(pointed.x - fixed.x);
  const widthFt = Math.abs(pointed.y - fixed.y);
  const center = fromLocalFeet(box.center, box.rotationDeg, (pointed.x + fixed.x) / 2, (pointed.y + fixed.y) / 2);
  return { ...box, center, lengthFt, widthFt };
}

export function boxContains(box: GroundBox, point: LngLat): boolean {
  const local = toLocalFeet(box.center, box.rotationDeg, point);
  return Math.abs(local.x) <= box.lengthFt / 2 + 0.05 && Math.abs(local.y) <= box.widthFt / 2 + 0.05;
}

export function formatFeet(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatArea(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} sq ft`;
}
