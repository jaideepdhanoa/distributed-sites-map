import { CITY_VIEW } from "./filter";

export type MarketId = "all" | "PHX" | "LAS" | "MIA";

/** A bare visit opens every market. A later choice is remembered under this version. */
export const MARKET_DEFAULT: MarketId = "all";

export const MARKET_STORAGE = "market-view";

export const MARKET_VERSION = "1";

export const MARKET_VERSION_KEY = "market-view-version";

const CENTERS = [CITY_VIEW.PHX.center, CITY_VIEW.LAS.center, CITY_VIEW.MIA.center];

/** Fallback camera before the site bounds are known. The live view fits the points. */
export const ALL_MARKETS_VIEW: { center: [number, number]; zoom: number } = {
  center: [
    CENTERS.reduce((sum, center) => sum + center[0], 0) / CENTERS.length,
    CENTERS.reduce((sum, center) => sum + center[1], 0) / CENTERS.length,
  ],
  zoom: 3.6,
};

export function isMarketId(value: string | null | undefined): value is MarketId {
  return value === "all" || value === "PHX" || value === "LAS" || value === "MIA";
}

/**
 * The URL names a market when `city` is all, PHX, LAS, or MIA.
 * A site link with no city keeps that site; the saved market does not replace it.
 * A bare visit uses the saved market when it was stored under the current version,
 * and otherwise opens every market.
 */
export function resolveMarket(
  urlCity: string | null | undefined,
  stored: { version: string | null | undefined; value: string | null | undefined },
  hasSite: boolean,
): MarketId | "site" {
  if (urlCity === "all") return "all";
  if (urlCity === "PHX" || urlCity === "LAS" || urlCity === "MIA") return urlCity;
  if (hasSite) return "site";
  if (stored.version === MARKET_VERSION && isMarketId(stored.value)) return stored.value;
  return MARKET_DEFAULT;
}

/** Phoenix, Las Vegas, and Miami stay in the URL. All markets omits `city`. */
export function marketSearchValue(code: string | null | undefined): string | null {
  if (code === "PHX" || code === "LAS" || code === "MIA") return code;
  return null;
}

export function marketFocus(market: MarketId): { center: [number, number]; zoom: number; fit: boolean } {
  if (market === "all") return { center: ALL_MARKETS_VIEW.center, zoom: ALL_MARKETS_VIEW.zoom, fit: true };
  const view = CITY_VIEW[market] ?? CITY_VIEW.PHX;
  return { center: view.center, zoom: view.zoom, fit: false };
}

export function pointBounds(points: [number, number][]): { west: number; south: number; east: number; north: number } | null {
  const finite = points.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!finite.length) return null;
  const lngs = finite.map((point) => point[0]);
  const lats = finite.map((point) => point[1]);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

export function coversMarkets(
  bounds: { west: number; south: number; east: number; north: number },
  markets: ("PHX" | "LAS" | "MIA")[] = ["PHX", "LAS", "MIA"],
): boolean {
  return markets.every((id) => {
    const [lng, lat] = CITY_VIEW[id].center;
    return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
  });
}
