export type TipBox = { left: number; right: number; top: number; bottom: number };

export function boxesOverlap(a: TipBox, b: TipBox): boolean {
  return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
}

/**
 * Put a hover note fully inside the map and outside the site card, Layers panel, and other chrome.
 * Wider notes are tried first. A later, narrower width is used only when the wider one has no open spot.
 */
export function placeReadableTip(args: {
  cursor: { x: number; y: number };
  bounds: TipBox;
  obstacles: TipBox[];
  widths: number[];
  measure: (width: number) => { width: number; height: number };
  margin?: number;
}): { left: number; top: number; width: number; height: number } {
  const margin = args.margin ?? 8;
  const region = {
    left: args.bounds.left + margin,
    top: args.bounds.top + margin,
    right: args.bounds.right - margin,
    bottom: args.bounds.bottom - margin,
  };
  const fits = (left: number, top: number, width: number, height: number) => {
    const rect = { left, right: left + width, top, bottom: top + height };
    if (rect.left < region.left - 0.5 || rect.top < region.top - 0.5 || rect.right > region.right + 0.5 || rect.bottom > region.bottom + 0.5) return false;
    return args.obstacles.every((item) => !boxesOverlap(rect, item));
  };
  for (const width of args.widths) {
    const size = args.measure(width);
    const w = Math.min(width, size.width);
    const h = size.height;
    if (w < 8 || h < 8) continue;
    const gap = 12;
    const spots: Array<[number, number]> = [
      [args.cursor.x - w - gap, args.cursor.y - h - gap],
      [args.cursor.x + gap, args.cursor.y - h - gap],
      [args.cursor.x - w - gap, args.cursor.y + gap],
      [args.cursor.x + gap, args.cursor.y + gap],
      [args.cursor.x - w / 2, args.cursor.y - h - gap],
      [args.cursor.x - w / 2, args.cursor.y + gap],
    ];
    const step = 24;
    for (let top = region.top; top + h <= region.bottom + 0.5; top += step) {
      for (let left = region.left; left + w <= region.right + 0.5; left += step) spots.push([left, top]);
    }
    let best: { left: number; top: number; score: number } | null = null;
    for (const [left, top] of spots) {
      if (!fits(left, top, w, h)) continue;
      const score = Math.hypot(left + w / 2 - args.cursor.x, top + h / 2 - args.cursor.y);
      if (!best || score < best.score) best = { left, top, score };
    }
    if (best) return { left: best.left, top: best.top, width: w, height: h };
  }
  const width = args.widths[args.widths.length - 1] ?? 160;
  const size = args.measure(width);
  const left = Math.min(Math.max(region.left, args.cursor.x + 12), Math.max(region.left, region.right - size.width));
  const top = Math.min(Math.max(region.top, args.cursor.y + 12), Math.max(region.top, region.bottom - size.height));
  return { left, top, width: Math.min(size.width, Math.max(8, region.right - region.left)), height: size.height };
}
