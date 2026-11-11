import type { StyleSpecification } from "maplibre-gl";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

let pending: Promise<StyleSpecification> | null = null;

/** OpenFreeMap Positron, recolored to the cream basemap. Same tiles, glyphs, and sprite. */
export function mutedPositronStyle(): Promise<StyleSpecification> {
  if (!pending) {
    pending = fetch(STYLE_URL).then(async (response) => {
      if (!response.ok) throw new Error(`basemap ${response.status}`);
      const style = (await response.json()) as StyleSpecification;
      return mute(style);
    }).catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

function looksLikeColor(value: string) {
  return /^(#|rgb|hsl)/i.test(value);
}

function paintColor(value: unknown, color: string): unknown {
  if (typeof value === "string") return looksLikeColor(value) ? color : value;
  if (Array.isArray(value)) return value.map((item) => paintColor(item, color));
  return value;
}

function tone(id: string, prop: string): string | null {
  if (id === "background") return "#f3efe6";
  if (id === "park" || id.includes("wood") || id.includes("grass")) return "#e4eee6";
  if (id === "water" || id.startsWith("waterway")) return "#dfe6e4";
  if (id.includes("residential") || id.includes("landuse")) return "#efeae0";
  if (id === "building") return prop.includes("outline") ? "#e7e0d2" : "#f7f3ec";
  if (id.includes("motorway") && (id.includes("casing") || id.includes("subtle"))) return "#e4d9c4";
  if (id.includes("motorway")) return "#f3eee4";
  if (id.includes("major") && (id.includes("casing") || id.includes("subtle"))) return "#e7e0d2";
  if (id.includes("major")) return "#fbf9f4";
  if (id.includes("minor") || id.includes("path") || id.includes("pier") || id.includes("service") || id.startsWith("aeroway")) return "#e9e3d6";
  if (id.startsWith("railway")) return "#ddd6c6";
  if (id.startsWith("boundary")) return "#d6cebe";
  if (id.includes("ice") || id.includes("glacier")) return "#f6f3ec";
  if (prop === "text-color") {
    if (id.startsWith("label_city") || id.startsWith("label_country") || id === "label_state" || id === "label_town") return "#6f6757";
    if (id.includes("water")) return "#8aa0a4";
    return "#9a917f";
  }
  if (prop === "text-halo-color") return "#f6f3ec";
  if (prop.includes("color")) return "#e7e0d2";
  return null;
}

function mute(style: StyleSpecification): StyleSpecification {
  const next = structuredClone(style);
  delete next.center;
  delete next.zoom;
  delete next.bearing;
  delete next.pitch;
  for (const layer of next.layers) {
    if (/shield/i.test(layer.id)) {
      layer.layout = { ...(layer.layout || {}), visibility: "none" };
    }
    const paint = layer.paint;
    if (!paint) continue;
    for (const key of Object.keys(paint)) {
      const color = tone(layer.id, key);
      if (!color || !key.includes("color")) continue;
      (paint as Record<string, unknown>)[key] = paintColor((paint as Record<string, unknown>)[key], color);
    }
  }
  return next;
}
