export type SheetSnap = "peek" | "half" | "full";

/** Heights shared by the sheet CSS and the drag-release snap. */
export function sheetSnapHeights(viewHeight: number) {
  const view = Math.max(1, viewHeight);
  return {
    peek: Math.min(320, Math.round(view * 0.45)),
    half: Math.round(view * 0.56),
    full: Math.round(view * 0.88),
  };
}

export function nearestSheetSnap(height: number, viewHeight: number): SheetSnap {
  const stops = sheetSnapHeights(viewHeight);
  const order: SheetSnap[] = ["peek", "half", "full"];
  return order.reduce((best, id) => (
    Math.abs(stops[id] - height) < Math.abs(stops[best] - height) ? id : best
  ));
}

export function stepSheet(snap: SheetSnap, direction: "more" | "less"): SheetSnap {
  if (direction === "more") return snap === "peek" ? "half" : "full";
  return snap === "full" ? "half" : "peek";
}
