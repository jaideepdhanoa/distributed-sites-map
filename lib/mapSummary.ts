import { droppedChip } from "./counts";

/**
 * Market line under the funnel.
 * Dropped deals are described as hidden only while they are not drawn.
 */
export function pipelineMapSummary(view: {
  placed: number;
  dropped: number;
  droppedPlaced: number;
  droppedShown: boolean;
  droppedOnly: boolean;
}): string {
  if (!view.droppedShown) {
    if (!view.dropped) return `${view.placed.toLocaleString()} on the map`;
    return `${view.placed.toLocaleString()} on the map · ${view.dropped.toLocaleString()} dropped, hidden`;
  }
  const droppedOnMap = `${view.droppedPlaced.toLocaleString()} dropped on the map`;
  if (view.droppedOnly) return droppedOnMap;
  return `${view.placed.toLocaleString()} on the map · ${droppedOnMap}`;
}

/** The All chip counts what the list and map show. Hidden dropped deals stay beside that count. */
export function pipelineAllCount(shown: number, hiddenDropped: number): { count: string; dropped: string; title: string } {
  const chip = droppedChip(shown, hiddenDropped);
  return { count: chip.count, dropped: chip.aside, title: chip.title };
}
