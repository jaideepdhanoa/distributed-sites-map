export type AreaRole = "current" | "launch" | "later" | "priority" | "future";

export type AreaLabel = {
  id: string;
  name: string;
  nudge?: [number, number];
};

/** Map labels. Plain words. Geometry is unchanged. */
export const AREA_LABELS: readonly AreaLabel[] = [
  { id: "las-100", name: "Core and ring 100 (current)" },
  { id: "las-300", name: "Rings 200 and 300 (later)", nudge: [0.04, -0.16] },
  { id: "phx-service", name: "Phoenix service area (current)", nudge: [-0.04, 0.05] },
  { id: "mia-current", name: "Miami service area (current)", nudge: [0, 0.08] },
  { id: "mia-launch", name: "Miami launch area", nudge: [0, -0.03] },
  { id: "mia-extended", name: "Miami extended area (later)", nudge: [-0.08, 0.04] },
  { id: "mia-future", name: "Mid-2027 northern boundary", nudge: [0, 0.025] },
  { id: "mia-pri-ftl", name: "Fort Lauderdale", nudge: [0, -0.02] },
  { id: "mia-pri-hl", name: "Highland Lakes" },
  { id: "mia-pri-fb", name: "Fontainebleau" },
];

const MIAMI_IDS = [
  "mia-current",
  "mia-launch",
  "mia-extended",
  "mia-future",
  "mia-pri-ftl",
  "mia-pri-hl",
  "mia-pri-fb",
] as const;

export function areaRole(id: string, group = ""): AreaRole {
  if (id === "mia-launch") return "launch";
  if (id === "mia-future") return "future";
  if (id === "mia-pri-ftl" || id === "mia-pri-hl" || id === "mia-pri-fb") return "priority";
  if (group === "expansion" || id === "mia-extended" || id === "las-200" || id === "las-300") return "later";
  return "current";
}

export function areaLabel(id: string): string {
  return AREA_LABELS.find((item) => item.id === id)?.name || "";
}

export function miamiAreaLabels(): AreaLabel[] {
  return AREA_LABELS.filter((item) => (MIAMI_IDS as readonly string[]).includes(item.id));
}

export const AREA_ROLE_MARK: Record<AreaRole, { swatch: string; label: string }> = {
  current: { swatch: "current-area", label: "Current area" },
  launch: { swatch: "launch-area", label: "Launch area" },
  later: { swatch: "later-area", label: "Later expansion" },
  priority: { swatch: "priority-area", label: "Priority area" },
  future: { swatch: "future-area", label: "Northern boundary" },
};

/** Strokes that stay visible on the light map and on imagery. */
export const AREA_PAINT = {
  currentFill: "#c5d9cb",
  currentLine: "#1e4636",
  currentLineSatellite: "#f4efe6",
  launchFill: "#f0d3bf",
  launchLine: "#9e4b3e",
  launchLineSatellite: "#f7e2a8",
  laterLine: "#3d5a73",
  laterLineSatellite: "#f7f3ea",
  priorityFill: "#d5e6c8",
  priorityLine: "#1e4636",
  priorityLineSatellite: "#f4efe6",
  futureLine: "#1d4e89",
  futureLineSatellite: "#d6e8ff",
  caseLine: "#1c1914",
} as const;
