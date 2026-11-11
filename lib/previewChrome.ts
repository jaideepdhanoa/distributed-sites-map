export type ChromeBox = {
  viewportWidth: number;
  viewportHeight: number;
  drawerLeft: number | null;
  drawerTop: number | null;
  phone: boolean;
  abovePeek: boolean;
  /** A phone sheet or list is open, so the comment button would sit on top of it. */
  covered: boolean;
};

export type ChromePlacement = {
  display: string;
  position: string;
  left: string;
  right: string;
  top: string;
  bottom: string;
};

const BUTTON = 44;
const GAP = 12;

/** Place the preview comment button in the map, clear of the drawer and any open sheet. */
export function previewChromePlacement(box: ChromeBox): ChromePlacement {
  if (box.phone && (box.abovePeek || box.covered)) {
    return { display: "none", position: "fixed", left: "0px", right: "auto", top: "0px", bottom: "auto" };
  }
  if (box.phone) {
    const sheetTop = box.drawerTop ?? box.viewportHeight;
    const top = Math.max(132, sheetTop - BUTTON - GAP);
    return { display: "block", position: "fixed", left: "auto", right: `${GAP}px`, top: `${top}px`, bottom: "auto" };
  }
  const edge = box.drawerLeft ?? box.viewportWidth;
  const left = Math.max(GAP, edge - BUTTON - GAP);
  return { display: "block", position: "fixed", left: `${left}px`, right: "auto", top: "168px", bottom: "auto" };
}

export const PREVIEW_CHROME_SELECTOR = [
  "vercel-live-feedback",
  "vercel-toolbar",
  "[data-vercel-toolbar]",
  "iframe[src*='vercel.live']",
].join(",");

export function applyPreviewChrome(node: HTMLElement, box: ChromeBox) {
  const rect = node.getBoundingClientRect();
  if (rect.width > 160 && rect.height > 160) return;
  const place = previewChromePlacement(box);
  node.style.setProperty("display", place.display, "important");
  node.style.setProperty("position", place.position, "important");
  node.style.setProperty("left", place.left, "important");
  node.style.setProperty("right", place.right, "important");
  node.style.setProperty("top", place.top, "important");
  node.style.setProperty("bottom", place.bottom, "important");
  node.style.setProperty("z-index", "30", "important");
  node.dataset.previewPlaced = "true";
}
