export type TipBox = { left: number; right: number; top: number; bottom: number };

export function boxesOverlap(a: TipBox, b: TipBox): boolean {
  return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
}

/** A full-width sheet sitting on the bottom of the map. The note has to stay above it. */
export function sheetCeiling(bounds: TipBox, obstacles: TipBox[]): number {
  let bottom = bounds.bottom;
  const width = bounds.right - bounds.left;
  for (const item of obstacles) {
    const spans = item.left <= bounds.left + 16 && item.right - item.left >= width - 32;
    const onBottom = item.bottom >= bounds.bottom - 32 && item.top > bounds.top + 48;
    if (spans && onBottom) bottom = Math.min(bottom, item.top);
  }
  return bottom;
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
  /** Keep the note entirely above the pointer so the ground under the cursor stays visible. */
  above?: boolean;
}): { left: number; top: number; width: number; height: number } {
  const margin = args.margin ?? 8;
  const ceiling = sheetCeiling(args.bounds, args.obstacles);
  const region = {
    left: args.bounds.left + margin,
    top: args.bounds.top + margin,
    right: args.bounds.right - margin,
    bottom: ceiling - margin,
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
    const spots: Array<[number, number]> = args.above
      ? [
          [args.cursor.x - w / 2, args.cursor.y - h - gap],
          [args.cursor.x - w - gap, args.cursor.y - h - gap],
          [args.cursor.x + gap, args.cursor.y - h - gap],
        ]
      : [
          [args.cursor.x - w - gap, args.cursor.y - h - gap],
          [args.cursor.x + gap, args.cursor.y - h - gap],
          [args.cursor.x - w - gap, args.cursor.y + gap],
          [args.cursor.x + gap, args.cursor.y + gap],
          [args.cursor.x - w / 2, args.cursor.y - h - gap],
          [args.cursor.x - w / 2, args.cursor.y + gap],
        ];
    const step = 24;
    if (!args.above) {
      for (let top = region.top; top + h <= region.bottom + 0.5; top += step) {
        for (let left = region.left; left + w <= region.right + 0.5; left += step) spots.push([left, top]);
      }
    }
    let best: { left: number; top: number; score: number } | null = null;
    for (const [left, top] of spots) {
      if (args.above && top + h > args.cursor.y - gap + 0.5) continue;
      if (!fits(left, top, w, h)) continue;
      const score = args.above
        ? Math.abs(left + w / 2 - args.cursor.x) + (args.cursor.y - (top + h))
        : Math.hypot(left + w / 2 - args.cursor.x, top + h / 2 - args.cursor.y);
      if (!best || score < best.score) best = { left, top, score };
    }
    if (best) return { left: best.left, top: best.top, width: w, height: h };
  }
  const width = args.widths[args.widths.length - 1] ?? 160;
  const size = args.measure(width);
  const gap = 12;
  const noteWidth = Math.min(size.width, Math.max(8, region.right - region.left));
  const preferredTop = args.above ? args.cursor.y - size.height - gap : args.cursor.y + gap;
  const left = Math.min(
    Math.max(region.left, args.above ? args.cursor.x - noteWidth / 2 : args.cursor.x + gap),
    Math.max(region.left, region.right - noteWidth),
  );
  // A note taller than the open map still ends at the sheet. It does not spill onto the card.
  const maxTop = region.bottom - size.height;
  const top = maxTop < region.top ? maxTop : Math.min(Math.max(region.top, preferredTop), maxTop);
  return { left, top, width: noteWidth, height: size.height };
}

/** Service-area notes wait until the pointer has been still. A later move starts the wait over. */
export const AREA_TIP_DWELL_MS = 400;
