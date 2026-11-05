export const DRAWER_WIDTH_KEY = "drawer-width";
export const DRAWER_DEFAULT = 380;
export const DRAWER_MIN = 360;
export const DRAWER_MAX = 900;

export function drawerMax(viewport: number) {
  return Math.min(DRAWER_MAX, Math.round(viewport * 0.6));
}

export function clampDrawerWidth(width: number, viewport: number) {
  const max = Math.max(DRAWER_MIN, drawerMax(viewport));
  return Math.round(Math.min(max, Math.max(DRAWER_MIN, width)));
}
