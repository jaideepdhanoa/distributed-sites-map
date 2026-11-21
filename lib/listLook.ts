import { chipFace, chipLabelProblem } from "./chips";
import { STATUS_NOTES, plainVerdict, stageTitle, uncheckedNote } from "./labels";

/** R-108. Land sourcing is paused. The chip stays short; the note is the hover. */
export const LAND_PAUSED_LABEL = "Land paused";
export const LAND_PAUSED_NOTE = "Land is paused since Nov 20, 2026. No sourcing or follow-up while the freeze is on.";
export const LAND_FILTER_TAG = "Paused";

/** A universe row that is not in the pipeline yet. */
export const UNIVERSE_STAGE_LABEL = "Universe";

const COUNTY_LABEL: Record<string, string> = {
  cleared: "Land OK",
  held: "Land OK",
  possible: "Land borderline",
  unresolved: "Records unclear",
  unchecked: "Not reviewed",
  "ruled-out": "Ruled out",
};

export function countyCheck(site: {
  verdict?: string | null;
  network_status?: string | null;
  tenure_fail?: boolean;
  aerial_fit?: string | null;
}): { label: string; note: string } {
  const status = site.tenure_fail || site.verdict === "FAIL" || site.verdict === "NOT_A_WASH"
    ? "ruled-out"
    : site.verdict === "PASS" && site.network_status === "held"
      ? "held"
      : site.verdict === "PASS"
        ? "cleared"
        : site.verdict === "MAYBE"
          ? "possible"
          : site.verdict === "UNRESOLVED"
            ? "unresolved"
            : "unchecked";
  const source = STATUS_NOTES.find((item) => item.id === status) || STATUS_NOTES[4];
  const note = status === "unchecked" ? uncheckedNote(site.aerial_fit) : source.note;
  const label = COUNTY_LABEL[status] || "Not reviewed";
  return { label: chipLabelProblem(label) ? "Not reviewed" : label, note };
}

export function plainCounty(verdict?: string | null): string {
  return countyCheck({ verdict }).label || plainVerdict(verdict);
}

/** Short type chip. Unknown types keep a clipped label and a quiet tone. */
export function typeChip(value: string): { label: string; tone: string } {
  const text = value.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  if (lower === "quick lube" || lower === "lube") return { label: "Quick lube", tone: "brass" };
  if (lower === "car wash" || lower === "wash") return { label: "Car wash", tone: "pine" };
  if (lower === "auto service" || lower === "auto repair" || lower === "tire and lube" || lower === "auto") return { label: "Auto service", tone: "sky" };
  if (lower === "land") return { label: "Land", tone: "sand" };
  if (lower === "c-store" || lower === "gas station" || lower === "convenience store") return { label: "C-store", tone: "quiet" };
  const face = chipFace(text || "Other");
  return { label: face.label || "Other", tone: "quiet" };
}

export function stageChipName(stage: string, group: string): string {
  const name = stageTitle(group);
  if (name && name !== "Deal" && !chipLabelProblem(name)) return name;
  return chipFace(stage.trim() || "Stage").label;
}

/** Keep a tooltip inside the viewport. Width wraps; it does not widen the page. */
export function placeTip(
  anchor: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
): { left: number; top: number; maxWidth: number } {
  const margin = 8;
  const maxWidth = Math.min(288, Math.max(120, viewport.width - margin * 2));
  let left = anchor.left;
  if (left + maxWidth > viewport.width - margin) left = viewport.width - margin - maxWidth;
  if (left < margin) left = margin;
  const height = 96;
  let top = anchor.bottom + 6;
  if (top + height > viewport.height - margin) top = Math.max(margin, anchor.top - height - 6);
  return { left, top, maxWidth };
}

export const LIST_CHIP_LABELS = [
  LAND_PAUSED_LABEL,
  LAND_FILTER_TAG,
  UNIVERSE_STAGE_LABEL,
  "Land OK",
  "Land borderline",
  "Records unclear",
  "Not reviewed",
  "Ruled out",
  "Car wash",
  "Auto service",
  "Quick lube",
  "Land",
  "C-store",
  "Desk screen",
  "Financial screen",
  "Site checks",
  "Offer and close",
  "Dropped",
  "Not scored",
  "Provisional",
];
