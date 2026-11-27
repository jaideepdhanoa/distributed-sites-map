import type { TipBox } from "./tipPlace";

type Insets = { left: number; right: number; top: number; bottom: number };

// Frame the next site or footprint in the largest rectangle clear of the moved panel.
export function clearPanelPadding(map: TipBox, panel: TipBox, base: Insets): Insets {
  const width = map.right - map.left, height = map.bottom - map.top;
  const area = (pad: Insets) => Math.max(0, width - pad.left - pad.right) * Math.max(0, height - pad.top - pad.bottom);
  const candidates = [
    { ...base, left: Math.max(base.left, panel.right - map.left) },
    { ...base, right: Math.max(base.right, map.right - panel.left) },
    { ...base, top: Math.max(base.top, panel.bottom - map.top) },
    { ...base, bottom: Math.max(base.bottom, map.bottom - panel.top) },
  ];
  const best = candidates.reduce((largest, pad) => area(pad) > area(largest) ? pad : largest);
  return area(best) > 0 ? best : base;
}
