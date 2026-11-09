"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map, NavigationControl, Popup, setWorkerUrl, type MapLayerMouseEvent, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { areaTip, clusterTip, dealTip, depotTip, siteTip, tipHtml, type TipModel } from "@/lib/markerTip";
import { mutedPositronStyle } from "@/lib/mutedStyle";
import { dealLabelFeatures, publicDeal, type PinLabel } from "@/lib/keyNumbers";
import type { MapArea } from "@/lib/geoFilter";
import type { DealFeature, GeoFeature, SiteFeature, UnscreenedFeature } from "@/lib/types";

type Props = {
  sites: SiteFeature[];
  deals: DealFeature[];
  areas: GeoFeature[];
  depots: GeoFeature[];
  parcels: GeoFeature[];
  offMarket: SiteFeature[];
  unscreened?: UnscreenedFeature[];
  selectedId: string | null;
  showAreas: boolean;
  showDepots: boolean;
  showSites: boolean;
  showRings: boolean;
  focusLng: number;
  focusLat: number;
  focusZoom: number;
  reviewMarkers?: { id: string; lng: number; lat: number; n: number; current: boolean }[];
  reviewFocus?: { lng: number; lat: number; zoom: number } | null;
  pinLabel?: PinLabel;
  onPinLabel?: (mode: PinLabel) => void;
  coverage?: { listed: number; missingPoint: number } | null;
  basemap?: "positron" | "satellite";
  onBasemap?: (mode: "positron" | "satellite") => void;
  onSelect: (id: string) => void;
  onBounds: (bounds: { contains: (lnglat: [number, number]) => boolean }) => void;
  fitPoints?: [number, number][];
  area?: MapArea | null;
  onArea?: (area: MapArea | null) => void;
  overlayPoints?: { label: string; coordinates: [number, number] }[];
  gridFeatures?: GeoFeature[];
};

function ringPoint(lon: number, lat: number, miles: number, step: number): [number, number] {
  const angle = (step / 64) * Math.PI * 2;
  const latRad = (lat * Math.PI) / 180;
  return [lon + (miles / (69 * Math.cos(latRad))) * Math.cos(angle), lat + (miles / 69) * Math.sin(angle)];
}

function depotRings(depots: GeoFeature[]) {
  const features = [];
  for (const depot of depots) {
    const coords = depot.geometry && depot.geometry.type === "Point" ? (depot.geometry.coordinates as number[]) : null;
    if (!coords) continue;
    for (const miles of [5, 10]) {
      const ring = Array.from({ length: 65 }, (_, index) => ringPoint(coords[0], coords[1], miles, index));
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { miles } });
    }
  }
  return features;
}

function geometryCoords(geometry: { type: string; coordinates: unknown } | null | undefined): [number, number][] {
  if (!geometry) return [];
  if (geometry.type === "Point") return [geometry.coordinates as [number, number]];
  if (geometry.type === "LineString") return geometry.coordinates as [number, number][];
  if (geometry.type === "Polygon") return (geometry.coordinates as [number, number][][])[0] || [];
  return [];
}

function glide(map: Map, center: [number, number], zoom: number) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.flyTo({ center, zoom, duration: reduce ? 0 : 300, essential: true });
}

function acresOf(coords: [number, number][]) {
  const radius = 6378137;
  let area = 0;
  for (let i = 0; i < coords.length; i += 1) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[(i + 1) % coords.length];
    area += ((lon2 - lon1) * Math.PI) / 180 * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((area * radius * radius) / 2) / 4046.8564224;
}

function areaLabels(areas: GeoFeature[]) {
  const labels: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { name: string } }[] = [];
  const place = (id: string, name: string, nudge: [number, number] = [0, 0]) => {
    const feature = areas.find((item) => item.properties.id === id);
    const center = feature ? bboxCenter(feature) : null;
    if (!center) return;
    labels.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [center[0] + nudge[0], center[1] + nudge[1]] },
      properties: { name },
    });
  };
  place("las-100", "Core and ring 100 (current)");
  place("las-300", "Rings 200 and 300 (later)", [0, 0.12]);
  place("phx-service", "Phoenix service area (current)");
  place("mia-current", "Miami service area (current)");
  place("mia-extended", "Miami extended area (later)", [0.05, 0.08]);
  return labels;
}

function bboxCenter(feature: GeoFeature): [number, number] | null {
  const coords = feature.geometry?.coordinates;
  const points: number[][] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      points.push(value as number[]);
      return;
    }
    value.forEach(walk);
  };
  walk(coords);
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export default function MapView(props: Props) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const clusterLeaves = useRef(new globalThis.Map<number, { properties?: Record<string, unknown> }[]>());
  const [measure, setMeasure] = useState(false);
  const [coverageText, setCoverageText] = useState("");
  const [areaTool, setAreaTool] = useState<"off" | "radius" | "draw">("off");
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const [radiusMiles, setRadiusMiles] = useState(1);
  const measureRef = useRef(false);
  measureRef.current = measure;
  const areaToolRef = useRef(areaTool);
  areaToolRef.current = areaTool;
  const radiusRef = useRef(radiusMiles);
  radiusRef.current = radiusMiles;
  const [readout, setReadout] = useState("");
  const [mapGeneration, setMapGeneration] = useState(0);
  const points = useRef<[number, number][]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!node.current) return;
    setWorkerUrl("/maplibre-gl-worker.js");
    const satelliteStyle = {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          imagery: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            attribution: "Powered by Esri",
          },
          labels: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
          },
          areas: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          parcels: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "area-labels": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          sites: { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 48, clusterMaxZoom: 11 },
          offmarket: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          deals: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "deal-labels": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          unscreened: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          depots: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          rings: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          measure: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "review-ring": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "review-marks": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "imagery", type: "raster", source: "imagery" },
          { id: "labels", type: "raster", source: "labels", layout: { visibility: "none" } },
          { id: "rings", type: "line", source: "rings", layout: { visibility: "none" }, paint: { "line-color": "#f7e2a8", "line-dasharray": [1.2, 1.2], "line-width": 1.4, "line-opacity": 0.9 } },
          { id: "expansion-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "expansion"], paint: { "line-color": "#d6e4f5", "line-dasharray": [2, 1.5], "line-width": 1.6, "line-opacity": 0.95 } },
          { id: "areas-op", type: "fill", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "fill-color": "#dfeae1", "fill-opacity": 0.72 } },
          { id: "areas-op-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "line-color": "#b9cdbf", "line-width": 1.4 } },
          { id: "area-labels", type: "symbol", source: "area-labels", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-allow-overlap": false, "text-padding": 6 }, paint: { "text-color": "#f7f3ea", "text-halo-color": "#1c1914", "text-halo-width": 1.2 } },
          { id: "parcels-line", type: "line", source: "parcels", minzoom: 14, filter: ["!=", ["get", "role"], "adjoining"], paint: { "line-color": "#f7f3ea", "line-width": 1.1 } },
          { id: "parcels-adjoining", type: "line", source: "parcels", minzoom: 14, filter: ["==", ["get", "role"], "adjoining"], paint: { "line-color": "#8eb7ff", "line-width": 1.4 } },
          { id: "parcels-selected", type: "line", source: "parcels", minzoom: 14, filter: ["all", ["==", ["get", "site_id"], ""], ["!=", ["get", "role"], "adjoining"]], paint: { "line-color": "#9e4b3e", "line-width": 1.6, "line-dasharray": [1.5, 1.2] } },
          {
            id: "missing-parcel",
            type: "circle",
            source: "sites",
            minzoom: 14,
            filter: ["==", ["get", "parcel_match"], "none"],
            paint: { "circle-radius": 13, "circle-color": "transparent", "circle-stroke-color": "#a8711b", "circle-stroke-width": 2 },
          },
          {
            id: "missing-parcel-deals",
            type: "circle",
            source: "deals",
            minzoom: 14,
            filter: ["==", ["get", "parcel_match"], "none"],
            paint: { "circle-radius": 14, "circle-color": "transparent", "circle-stroke-color": "#a8711b", "circle-stroke-width": 2 },
          },
          {
            id: "offmarket-halo",
            type: "circle",
            source: "offmarket",
            filter: ["==", ["get", "site_id"], ""],
            paint: { "circle-radius": 22, "circle-color": "#8a8173", "circle-opacity": 0.16 },
          },
          {
            id: "offmarket",
            type: "symbol",
            source: "offmarket",
            layout: { "icon-image": "dia-stone", "icon-size": 0.9, "icon-allow-overlap": true },
          },
          {
            id: "offmarket-selected",
            type: "circle",
            source: "offmarket",
            filter: ["==", ["get", "site_id"], ""],
            paint: { "circle-radius": 16, "circle-color": "transparent", "circle-stroke-color": "#fffdf8", "circle-stroke-width": 2 },
          },
          {
            id: "clusters-halo",
            type: "circle",
            source: "sites",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#1e4636",
              "circle-opacity": 0.14,
              "circle-radius": ["+", ["step", ["get", "point_count"], 16, 20, 20, 80, 26], 6],
            },
          },
          {
            id: "clusters",
            type: "circle",
            source: "sites",
            filter: ["has", "point_count"],
            paint: { "circle-color": "#1e4636", "circle-radius": ["step", ["get", "point_count"], 15, 20, 18, 80, 22], "circle-stroke-color": "#fffdf8", "circle-stroke-width": 2.5, "circle-opacity": 1 },
          },
          {
            id: "cluster-count",
            type: "symbol",
            source: "sites",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 13 },
            paint: { "text-color": "#fffdf8" },
          },
          {
            id: "tier-large-halo",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "land_tier"], "L10"]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 16],
              "circle-color": "transparent",
              "circle-stroke-color": "#cfc6b6",
              "circle-stroke-width": 1,
              "circle-stroke-opacity": 0.45,
            },
          },
          {
            id: "tier-large",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "land_tier"], "L10"]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 14, 12, 20, 15, 28],
              "circle-color": "transparent",
              "circle-stroke-color": "#c4b8a4",
              "circle-stroke-width": 1.2,
            },
          },
          {
            id: "tier-small-halo",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "land_tier"], "L4"]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 14, 11],
              "circle-color": "transparent",
              "circle-stroke-color": "#cfc6b6",
              "circle-stroke-width": 1,
              "circle-stroke-opacity": 0.4,
            },
          },
          {
            id: "tier-small",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "land_tier"], "L4"]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 11, 15, 14],
              "circle-color": "transparent",
              "circle-stroke-color": "#c4b8a4",
              "circle-stroke-width": 1,
            },
          },
          {
            id: "selected-halo",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "site_id"], ""]],
            paint: {
              "circle-radius": 24,
              "circle-opacity": 0.16,
              "circle-color": [
                "case",
                ["all", ["==", ["get", "verdict"], "PASS"], ["==", ["get", "network_status"], "held"]], "#1d4e89",
                ["==", ["get", "verdict"], "PASS"], "#387156",
                ["==", ["get", "verdict"], "MAYBE"], "#a8711b",
                ["==", ["get", "verdict"], "UNRESOLVED"], "#9e4b3e",
                ["==", ["get", "verdict"], "FAIL"], "#9e4b3e",
                ["==", ["get", "verdict"], "NOT_A_WASH"], "#9e4b3e",
                "#8a8173",
              ],
            },
          },
          {
            id: "selected",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "site_id"], ""]],
            paint: { "circle-radius": 15, "circle-color": "#fffdf8", "circle-stroke-width": 0 },
          },
          {
            id: "sites",
            type: "symbol",
            source: "sites",
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": [
                "case",
                ["all", ["==", ["get", "verdict"], "PASS"], ["==", ["get", "network_status"], "held"]], "dia-held",
                ["==", ["get", "verdict"], "PASS"], "dia-moss",
                ["==", ["get", "verdict"], "MAYBE"], "dia-amber",
                ["==", ["get", "verdict"], "UNRESOLVED"], "dia-clay",
                ["==", ["get", "verdict"], "FAIL"], "dia-clay",
                ["==", ["get", "verdict"], "NOT_A_WASH"], "dia-clay",
                "dia-stone",
              ],
              "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.74, 14, 0.92],
              "icon-allow-overlap": true,
            },
          },
          {
            id: "linked",
            type: "circle",
            source: "sites",
            filter: ["all", ["has", "linked_deal_id"], ["!=", ["get", "linked_deal_id"], ""]],
            paint: { "circle-radius": 11, "circle-color": "transparent", "circle-stroke-color": "#f7f3ea", "circle-stroke-width": 2 },
          },
          {
            id: "deal-halo",
            type: "circle",
            source: "deals",
            filter: ["==", ["get", "deal_id"], ""],
            paint: {
              "circle-radius": 24,
              "circle-opacity": 0.16,
              "circle-color": [
                "match",
                ["get", "stage_group"],
                "desk", "#a8711b",
                "dropped", "#9e4b3e",
                "sourced", "#8a8173",
                "#387156",
              ],
            },
          },
          {
            id: "deal-ring",
            type: "circle",
            source: "deals",
            filter: ["==", ["get", "deal_id"], ""],
            paint: { "circle-radius": 15, "circle-color": "#fffdf8", "circle-stroke-width": 0 },
          },
          {
            id: "deals-pipe",
            type: "symbol",
            source: "deals",
            filter: ["==", ["get", "kind"], "pipeline"],
            layout: { "icon-image": ["concat", "sq-", ["get", "stage_group"]], "icon-size": 0.9, "icon-allow-overlap": true },
          },
          {
            id: "deal-site-badge",
            type: "symbol",
            source: "deals",
            filter: ["all", ["==", ["get", "kind"], "pipeline"], ["has", "universe_id"], ["!=", ["get", "universe_id"], ""]],
            layout: {
              "text-field": "Site",
              "text-font": ["Noto Sans Regular"],
              "text-size": 9,
              "text-offset": [1.1, 0.15],
              "text-anchor": "left",
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#1c1914", "text-halo-color": "#f4efe6", "text-halo-width": 1.2 },
          },
          {
            id: "unscreened",
            type: "circle",
            source: "unscreened",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 12, 9, 15, 12],
              "circle-color": "transparent",
              "circle-stroke-color": "#f4efe6",
              "circle-stroke-width": 2.4,
            },
          },
          {
            id: "unscreened-selected",
            type: "circle",
            source: "unscreened",
            filter: ["==", ["get", "listing_id"], ""],
            paint: { "circle-radius": 14, "circle-color": "transparent", "circle-stroke-color": "#faf7f1", "circle-stroke-width": 3 },
          },
          {
            id: "deals-land",
            type: "symbol",
            source: "deals",
            filter: ["==", ["get", "kind"], "land"],
            layout: { "icon-image": ["concat", "sq-", ["get", "stage_group"]], "icon-size": 0.9, "icon-allow-overlap": true },
          },
          {
            id: "deal-pills",
            type: "symbol",
            source: "deal-labels",
            layout: {
              "text-field": ["get", "pill"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 12,
              "text-offset": [0, 1.6],
              "text-anchor": "top",
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#1C1914", "text-halo-color": "#F7EAD2", "text-halo-width": 8 },
          },
          {
            id: "depots",
            type: "symbol",
            source: "depots",
            layout: { "icon-image": "depot", "icon-size": 0.72, "icon-allow-overlap": true },
          },
          {
            id: "depot-labels",
            type: "symbol",
            source: "depots",
            minzoom: 12,
            layout: {
              "text-field": ["get", "id"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 11,
              "text-offset": [0, 1.15],
              "text-anchor": "top",
              "text-allow-overlap": false,
            },
            paint: { "text-color": "#f7f3ea", "text-halo-color": "#1c1914", "text-halo-width": 1.2 },
          },
          { id: "measure", type: "line", source: "measure", paint: { "line-color": "#f4efe6", "line-width": 2 } },
          {
            id: "review-ring",
            type: "circle",
            source: "review-ring",
            paint: { "circle-radius": 18, "circle-color": "transparent", "circle-stroke-color": "#f3d48a", "circle-stroke-width": 3, "circle-stroke-opacity": 0.9 },
          },
          {
            id: "review-marks",
            type: "circle",
            source: "review-marks",
            paint: {
              "circle-radius": ["case", ["==", ["get", "current"], 1], 16, 13],
              "circle-color": "#1e4636",
              "circle-stroke-color": "#faf7f1",
              "circle-stroke-width": 2,
            },
          },
          {
            id: "review-numbers",
            type: "symbol",
            source: "review-marks",
            layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-allow-overlap": true },
            paint: { "text-color": "#faf7f1" },
          },
        ],
      } as StyleSpecification;
    let active: Map | null = null;
    let observer: ResizeObserver | null = null;
    let cancelled = false;
    const boot = async () => {
    const basemap = propsRef.current.basemap || "positron";
    let style: StyleSpecification | string = satelliteStyle;
    if (basemap !== "satellite") {
      try {
        style = await mutedPositronStyle();
      } catch {
        style = "https://tiles.openfreemap.org/styles/positron";
      }
    }
    if (cancelled || !node.current) return;
    const map = new Map({
      container: node.current,
      style,
      center: [props.focusLng, props.focusLat],
      zoom: props.focusZoom,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 0,
    });
    active = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const size = 36;
    const marker = (kind: "circle" | "diamond" | "depot", rgb: [number, number, number]) => {
      const pixels = new Uint8Array(size * size * 4);
      const cream: [number, number, number] = [255, 253, 248];
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = x - 17.5;
          const dy = y - 17.5;
          let inside = false;
          let edge = false;
          if (kind === "depot") {
            const ax = Math.abs(dx);
            const ay = Math.abs(dy);
            const box = Math.max(ax, ay);
            const corner = Math.max(0, ax - 8) + Math.max(0, ay - 8);
            inside = box <= 12 && corner <= 6;
            edge = inside && (box >= 10.2 || corner >= 4.2);
          } else {
            const d = kind === "circle" ? Math.hypot(dx, dy) : Math.abs(dx) + Math.abs(dy);
            const limit = kind === "circle" ? 11.5 : 13;
            inside = d <= limit;
            edge = inside && d >= limit - 2.4;
          }
          if (!inside) continue;
          const i = (y * size + x) * 4;
          const fill = edge ? cream : rgb;
          pixels[i] = fill[0];
          pixels[i + 1] = fill[1];
          pixels[i + 2] = fill[2];
          pixels[i + 3] = 255;
        }
      }
      if (kind === "depot") {
        for (let y = 8; y < 28; y += 1) {
          for (let x = 12; x < 24; x += 1) {
            const ny = (y - 8) / 20;
            const spine = 18 - ny * 6;
            const bolt = Math.abs(x - spine) < 2.2 && (ny < 0.48 ? x < spine + 1 : x > spine - 1);
            if (!bolt) continue;
            const i = (y * size + x) * 4;
            pixels[i] = 255;
            pixels[i + 1] = 253;
            pixels[i + 2] = 248;
            pixels[i + 3] = 255;
          }
        }
      }
      return pixels;
    };
    const image = marker("depot", [29, 78, 137]);
    const square = (rgb: [number, number, number]) => marker("circle", rgb);
    const triangle = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = (x - 17.5) / 16;
        const ny = (y - 28) / 26;
        if (ny <= 0 && Math.abs(nx) <= -ny * 0.55) {
          const i = (y * size + x) * 4;
          const edge = ny > -0.18;
          triangle[i] = edge ? 28 : 44;
          triangle[i + 1] = edge ? 25 : 93;
          triangle[i + 2] = edge ? 20 : 143;
          triangle[i + 3] = 255;
        }
      }
    }
    map.on("load", () => {
      if (!map.hasImage("depot")) map.addImage("depot", { width: size, height: size, data: image });
      const pinColors: Record<string, [number, number, number]> = {
        stone: [138, 129, 115],
        amber: [168, 113, 27],
        moss: [56, 113, 86],
        clay: [158, 75, 62],
        held: [29, 78, 137],
      };
      for (const [name, rgb] of Object.entries(pinColors)) {
        const id = `dia-${name}`;
        if (!map.hasImage(id)) map.addImage(id, { width: size, height: size, data: marker("diamond", rgb) });
      }
      const squares: Record<string, [number, number, number]> = {
        sourced: pinColors.stone,
        desk: pinColors.amber,
        financial: pinColors.moss,
        checks: pinColors.moss,
        close: pinColors.moss,
        contacted: pinColors.moss,
        later: pinColors.moss,
        dropped: pinColors.clay,
      };
      for (const [name, rgb] of Object.entries(squares)) {
        const id = `sq-${name}`;
        if (!map.hasImage(id)) map.addImage(id, { width: size, height: size, data: square(rgb) });
      }
      node.current?.setAttribute("data-deal-markers", "square");
      map.resize();
      requestAnimationFrame(() => map.resize());
      window.setTimeout(() => {
        if (mapRef.current === map) map.resize();
      }, 350);
      if (!map.getSource("sites")) {
        for (const [id, source] of Object.entries(satelliteStyle.sources)) {
          if (id === "imagery" || id === "labels") continue;
          map.addSource(id, source);
        }
        for (const layer of satelliteStyle.layers) {
          if (layer.id === "imagery" || layer.id === "labels") continue;
          map.addLayer(layer);
        }
      }
      if (!map.hasImage("tri-land")) map.addImage("tri-land", { width: size, height: size, data: triangle });
      map.on("click", "clusters", (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        const source = map.getSource("sites") as GeoJSONSource;
        const center = (feature?.geometry && feature.geometry.type === "Point" ? feature.geometry.coordinates : null) as [number, number] | null;
        if (clusterId == null || !center) return;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center, zoom });
        }).catch(() => undefined);
      });
      map.on("click", "sites", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const feature = event.features?.[0];
        const id = feature?.properties?.site_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "offmarket", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.site_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "review-marks", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "deals-pipe", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.deal_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "deals-land", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.deal_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "unscreened", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.listing_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      const popup = new Popup({ closeButton: false, closeOnClick: false, closeOnMove: false, maxWidth: "280px", className: "map-tip-popup", offset: 14 });
      const tipLayers = ["clusters", "sites", "offmarket", "deals-pipe", "deals-land", "unscreened", "depots", "expansion-line", "areas-op"];
      const areaLayers = new Set(["expansion-line", "areas-op"]);
      let shownKey = "";
      let request = 0;
      const hideTip = () => {
        shownKey = "";
        request += 1;
        popup.remove();
        map.getCanvas().style.cursor = "";
      };
      const showTip = (key: string, lngLat: { lng: number; lat: number }, model: TipModel) => {
        if (shownKey !== key) {
          shownKey = key;
          popup.setHTML(tipHtml(model));
        }
        popup.setLngLat(lngLat);
        if (!popup.isOpen()) popup.addTo(map);
      };
      map.on("mousemove", (event: MapMouseEvent) => {
        if (measureRef.current) {
          hideTip();
          return;
        }
        const pointer = event.originalEvent as PointerEvent;
        if (pointer && pointer.pointerType === "touch") return;
        const layers = tipLayers.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
        const hits = layers.length ? map.queryRenderedFeatures(event.point, { layers }) : [];
        const feature = hits.find((item) => !areaLayers.has(item.layer.id)) || hits[0];
        if (!feature) {
          hideTip();
          return;
        }
        const layer = feature.layer.id;
        map.getCanvas().style.cursor = layer === "areas-op" || layer === "expansion-line" ? "" : "pointer";
        const props = (feature.properties || {}) as Record<string, unknown>;
        if (layer === "clusters") {
          const clusterId = Number(props.cluster_id);
          const key = `cluster:${clusterId}`;
          const count = Number(props.point_count) || 0;
          const cached = clusterLeaves.current.get(clusterId);
          if (cached) {
            showTip(key, event.lngLat, clusterTip(cached));
            return;
          }
          showTip(key, event.lngLat, { title: `${count.toLocaleString()} sites`, marks: [] });
          const ticket = ++request;
          const source = map.getSource("sites") as GeoJSONSource;
          source.getClusterLeaves(clusterId, Math.max(count, 1), 0).then((leaves) => {
            clusterLeaves.current.set(clusterId, leaves as { properties?: Record<string, unknown> }[]);
            if (ticket !== request || shownKey !== key) return;
            popup.setHTML(tipHtml(clusterTip(leaves as { properties?: Record<string, unknown> }[])));
          }).catch(() => undefined);
          return;
        }
        const model = layer === "unscreened"
          ? { title: String(props.name || props.address || props.listing_id || "Listing"), marks: [{ swatch: "listing", label: "Listed, not yet screened" }] }
          : layer === "offmarket"
          ? siteTip(props, true)
          : layer === "sites"
            ? siteTip(props)
            : layer === "deals-pipe" || layer === "deals-land"
              ? dealTip(props)
              : layer === "depots"
                ? depotTip(props)
                : areaTip(props);
        const key = `${layer}:${String(props.site_id || props.deal_id || props.id || "")}`;
        showTip(key, event.lngLat, model);
      });
      map.on("mouseout", hideTip);
      map.on("dragstart", hideTip);
      map.on("click", (event: MapMouseEvent) => {
        if (areaToolRef.current === "radius") {
          propsRef.current.onArea?.({ kind: "radius", lng: event.lngLat.lng, lat: event.lngLat.lat, miles: radiusRef.current });
          return;
        }
        if (areaToolRef.current === "draw") {
          const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
          setDraftPoints((points) => [...points, point]);
          return;
        }
        if (!measureRef.current) return;
        points.current = [...points.current, [event.lngLat.lng, event.lngLat.lat]];
        const source = map.getSource("measure") as GeoJSONSource;
        source.setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.current } }],
        });
        if (points.current.length >= 3) setReadout(`${acresOf(points.current).toFixed(2)} acres`);
        else if (points.current.length === 2) setReadout("Add points, then read acres");
      });
      if (propsRef.current.basemap !== "satellite") {
        if (map.getLayer("area-labels")) {
          map.setPaintProperty("area-labels", "text-color", "#5b554b");
          map.setPaintProperty("area-labels", "text-halo-color", "#f6f3ec");
        }
        if (map.getLayer("depot-labels")) {
          map.setPaintProperty("depot-labels", "text-color", "#1d4e89");
          map.setPaintProperty("depot-labels", "text-halo-color", "#fffdf8");
        }
      }
      map.on("moveend", () => propsRef.current.onBounds(map.getBounds()));
      propsRef.current.onBounds(map.getBounds());
    });
    const observed = node.current;
    observer = new ResizeObserver(() => map.resize());
    observer.observe(observed);
    mapRef.current = map;
    (window as Window & { __sitesMap?: Map }).__sitesMap = map;
    if (!cancelled) setMapGeneration((value) => value + 1);
    };
    void boot();
    return () => {
      cancelled = true;
      observer?.disconnect();
      active?.remove();
      mapRef.current = null;
      if (active && (window as Window & { __sitesMap?: Map }).__sitesMap === active) delete (window as Window & { __sitesMap?: Map }).__sitesMap;
    };
    // Recreate the map when the basemap changes. Later effects push data in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.basemap]);

  const reviewFocusRef = useRef(props.reviewFocus);
  reviewFocusRef.current = props.reviewFocus;
  const focusToken = `${props.focusLng},${props.focusLat},${props.focusZoom},${props.basemap || "positron"}`;
  const reviewToken = props.reviewFocus ? `${props.reviewFocus.lng},${props.reviewFocus.lat},${props.reviewFocus.zoom}` : "";
  const appliedFocus = useRef("");
  const appliedReview = useRef("");
  const appliedFit = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancel = false;
    const push = () => {
      if (cancel) return;
      if (!map.getSource("sites") || !map.getSource("deals") || !map.getSource("offmarket") || !map.getSource("unscreened")) {
        if (mapRef.current === map) map.once("idle", push);
        return;
      }
      clusterLeaves.current.clear();
      (map.getSource("sites") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.sites.filter((f) => f.geometry) });
      (map.getSource("offmarket") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.offMarket.filter((f) => f.geometry) });
      (map.getSource("deals") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: props.deals.filter((feature) => feature.geometry).map((feature) => ({
          ...feature,
          properties: publicDeal(feature.properties),
        })),
      });
      const labelData = {
        type: "FeatureCollection" as const,
        features: dealLabelFeatures(props.deals, props.pinLabel || "none"),
      };
      const labelSource = map.getSource("deal-labels") as GeoJSONSource | undefined;
      if (labelSource) labelSource.setData(labelData);
      else map.addSource("deal-labels", { type: "geojson", data: labelData });
      const overlayData = {
        type: "FeatureCollection" as const,
        features: (props.overlayPoints || []).map((point) => ({
          type: "Feature" as const,
          properties: { label: point.label },
          geometry: { type: "Point" as const, coordinates: point.coordinates },
        })),
      };
      const overlaySource = map.getSource("overlays") as GeoJSONSource | undefined;
      if (overlaySource) overlaySource.setData(overlayData);
      else map.addSource("overlays", { type: "geojson", data: overlayData });
      const gridData = {
        type: "FeatureCollection" as const,
        features: (props.gridFeatures || []).filter((feature) => feature.geometry),
      };
      const gridSource = map.getSource("grid") as GeoJSONSource | undefined;
      if (gridSource) gridSource.setData(gridData);
      else map.addSource("grid", { type: "geojson", data: gridData });
      if (!map.getLayer("grid-line")) {
        map.addLayer({
          id: "grid-line",
          type: "line",
          source: "grid",
          filter: ["==", ["get", "kind"], "line"],
          paint: { "line-color": "#1d4e89", "line-width": 3, "line-opacity": 0.9 },
        });
      }
      if (!map.getLayer("grid-substation")) {
        map.addLayer({
          id: "grid-substation",
          type: "fill",
          source: "grid",
          filter: ["all", ["==", ["get", "kind"], "substation"], ["==", ["geometry-type"], "Polygon"]],
          paint: { "fill-color": "#1d4e89", "fill-opacity": 0.28 },
        });
      }
      if (!map.getLayer("grid-substation-line")) {
        map.addLayer({
          id: "grid-substation-line",
          type: "line",
          source: "grid",
          filter: ["all", ["==", ["get", "kind"], "substation"], ["!=", ["geometry-type"], "Point"]],
          paint: { "line-color": "#1d4e89", "line-width": 2 },
        });
      }
      if (!map.getLayer("grid-substation-point")) {
        map.addLayer({
          id: "grid-substation-point",
          type: "circle",
          source: "grid",
          filter: ["all", ["==", ["get", "kind"], "substation"], ["==", ["geometry-type"], "Point"]],
          paint: { "circle-radius": 7, "circle-color": "#1d4e89", "circle-stroke-color": "#faf7f1", "circle-stroke-width": 2 },
        });
      }
      if (!map.getLayer("grid-labels")) {
        map.addLayer({
          id: "grid-labels",
          type: "symbol",
          source: "grid",
          filter: ["any", ["==", ["geometry-type"], "Point"], ["has", "label_only"]],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 13,
            "text-offset": [0, -1.4],
            "text-anchor": "bottom",
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#1d4e89", "text-halo-color": "#f7f4ee", "text-halo-width": 3 },
        });
      }
      if (!map.getLayer("overlay-labels")) {
        map.addLayer({
          id: "overlay-labels",
          type: "symbol",
          source: "overlays",
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, -1.8],
            "text-anchor": "bottom",
            "text-allow-overlap": false,
            "text-optional": true,
          },
          paint: { "text-color": "#1e4636", "text-halo-color": "#f4fff6", "text-halo-width": 6 },
        });
      }
      if (!map.getLayer("deal-pills")) {
        map.addLayer({
          id: "deal-pills",
          type: "symbol",
          source: "deal-labels",
          layout: {
            "text-field": ["get", "pill"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 13,
            "text-offset": [0, 1.55],
            "text-anchor": "top",
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#1C1914", "text-halo-color": "#F7EAD2", "text-halo-width": 10 },
        });
      }
      (map.getSource("unscreened") as GeoJSONSource).setData({ type: "FeatureCollection", features: (props.unscreened || []).filter((f) => f.geometry) });
      (map.getSource("areas") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.areas });
      (map.getSource("depots") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.depots });
      (map.getSource("rings") as GeoJSONSource).setData({ type: "FeatureCollection", features: depotRings(props.depots) });
      (map.getSource("parcels") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.parcels });
      (map.getSource("area-labels") as GeoJSONSource).setData({ type: "FeatureCollection", features: areaLabels(props.areas) });
      if (map.getLayer("parcels-selected")) {
        map.setFilter("parcels-selected", ["all", ["==", ["get", "site_id"], props.selectedId || ""], ["!=", ["get", "role"], "adjoining"]]);
      }
      if (map.getLayer("offmarket-selected")) map.setFilter("offmarket-selected", ["==", ["get", "site_id"], props.selectedId || ""]);
      if (map.getLayer("offmarket-halo")) map.setFilter("offmarket-halo", ["==", ["get", "site_id"], props.selectedId || ""]);
      map.setFilter("selected", ["==", ["get", "site_id"], props.selectedId || ""]);
      if (map.getLayer("selected-halo")) map.setFilter("selected-halo", ["all", ["!", ["has", "point_count"]], ["==", ["get", "site_id"], props.selectedId || ""]]);
      if (map.getLayer("deal-halo")) map.setFilter("deal-halo", ["==", ["get", "deal_id"], props.selectedId || ""]);
      if (map.getLayer("deal-ring")) map.setFilter("deal-ring", ["==", ["get", "deal_id"], props.selectedId || ""]);
      if (map.getLayer("unscreened-selected")) map.setFilter("unscreened-selected", ["==", ["get", "listing_id"], props.selectedId || ""]);
      map.resize();
      const phone = window.matchMedia("(max-width: 767px)").matches;
      const fitKey = (props.fitPoints || []).map((point) => point.join(",")).join("|");
      if (reviewToken) {
        appliedReview.current = reviewToken;
      } else if (phone && fitKey && appliedFit.current !== fitKey) {
        appliedFit.current = fitKey;
        appliedFocus.current = focusToken;
        const lngs = props.fitPoints!.map((point) => point[0]);
        const lats = props.fitPoints!.map((point) => point[1]);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 56, bottom: 120, left: 28, right: 28 }, maxZoom: 13, duration: 0 },
        );
      } else if (appliedFocus.current !== focusToken) {
        appliedFocus.current = focusToken;
        appliedReview.current = "";
        glide(map, [props.focusLng, props.focusLat], props.focusZoom);
      }
    };
    if (map.isStyleLoaded()) push();
    else map.once("load", push);
    return () => {
      cancel = true;
      map.off("load", push);
    };
  }, [mapGeneration, props.sites, props.deals, props.areas, props.depots, props.parcels, props.offMarket, props.unscreened, props.selectedId, props.pinLabel, props.fitPoints, props.overlayPoints, props.gridFeatures, focusToken, reviewToken, props.focusLng, props.focusLat, props.focusZoom, props.reviewFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.coverage) {
      setCoverageText("");
      return;
    }
    let cancel = false;
    const report = () => {
      if (cancel || !map.isStyleLoaded() || !map.getLayer("clusters") || !map.getLayer("sites")) return;
      try {
      const bounds = map.getBounds();
      let onScreen = 0;
      let offScreen = 0;
      for (const feature of props.sites) {
        const coords = feature.geometry?.coordinates;
        if (!coords) continue;
        if (bounds.contains(coords as [number, number])) onScreen += 1;
        else offScreen += 1;
      }
      const seenClusters = new Set<number>();
      for (const feature of map.queryRenderedFeatures({ layers: ["clusters"] })) {
        const id = Number(feature.properties?.cluster_id);
        if (seenClusters.has(id)) continue;
        seenClusters.add(id);
      }
      const clusterCount = seenClusters.size;
      const pinIds = new Set<string>();
      for (const feature of map.queryRenderedFeatures({ layers: ["sites"] })) {
        const id = String(feature.properties?.site_id || "");
        if (id) pinIds.add(id);
      }
      const listed = props.coverage?.listed ?? props.sites.length;
      const missing = props.coverage?.missingPoint ?? 0;
      const grouped = Math.max(onScreen - pinIds.size, 0);
      const clusterNote = clusterCount > 0
        ? ` ${grouped.toLocaleString()} more on this map are grouped into ${clusterCount.toLocaleString()} clusters.`
        : "";
      setCoverageText(`${listed.toLocaleString()} listed. ${pinIds.size.toLocaleString()} separate pins on screen.${clusterNote} ${offScreen.toLocaleString()} off this view. ${missing.toLocaleString()} with no point.`);
      } catch {
        setCoverageText("");
      }
    };
    report();
    map.on("moveend", report);
    map.on("idle", report);
    return () => {
      cancel = true;
      map.off("moveend", report);
      map.off("idle", report);
    };
  }, [mapGeneration, props.sites, props.coverage, props.showSites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const vis = (id: string, on: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      };
      vis("areas-op", props.showAreas);
      vis("areas-op-line", props.showAreas);
      vis("expansion-line", props.showAreas);
      vis("area-labels", props.showAreas);
      vis("depots", props.showDepots);
      vis("depot-labels", props.showDepots);
      vis("rings", props.showRings);
      vis("sites", props.showSites);
      vis("clusters", props.showSites);
      vis("clusters-halo", props.showSites);
      vis("cluster-count", props.showSites);
      vis("selected-halo", props.showSites);
      vis("tier-large", props.showSites);
      vis("tier-large-halo", props.showSites);
      vis("tier-small", props.showSites);
      vis("tier-small-halo", props.showSites);
      vis("linked", props.showSites);
      vis("selected", props.showSites);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [mapGeneration, props.showAreas, props.showDepots, props.showSites]);

  const selectedOnMap =
    props.sites.some((feature) => feature.properties.site_id === props.selectedId) ||
    props.offMarket.some((feature) => feature.properties.site_id === props.selectedId) ||
    props.deals.some((feature) => feature.properties.deal_id === props.selectedId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancel = false;
    const go = () => {
      if (cancel || reviewFocusRef.current) return;
      if (!props.selectedId) {
        glide(map, [props.focusLng, props.focusLat], props.focusZoom);
        return;
      }
      const site = propsRef.current.sites.find((feature) => feature.properties.site_id === props.selectedId);
      const off = propsRef.current.offMarket.find((feature) => feature.properties.site_id === props.selectedId);
      const deal = propsRef.current.deals.find((feature) => feature.properties.deal_id === props.selectedId);
      const geometry = site?.geometry || off?.geometry || deal?.geometry;
      if (!geometry || geometry.type !== "Point") return;
      const pin = geometry.coordinates as [number, number];
      const extra = (propsRef.current.gridFeatures || []).flatMap((feature) => geometryCoords(feature.geometry));
      if (!extra.length) {
        glide(map, pin, 16);
        return;
      }
      const points = [pin, ...extra];
      const lngs = points.map((point) => point[0]);
      const lats = points.map((point) => point[1]);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 88, bottom: 56, left: 48, right: 430 }, maxZoom: 15, duration: reduce ? 0 : 300 },
      );
    };
    if (props.reviewFocus) return;
    if (props.selectedId && !selectedOnMap) return;
    go();
    if (props.selectedId) map.once("idle", go);
    return () => {
      cancel = true;
      map.off("idle", go);
    };
  }, [mapGeneration, props.selectedId, selectedOnMap, props.focusLng, props.focusLat, props.focusZoom, props.reviewFocus, props.gridFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    const focus = props.reviewFocus;
    if (!map || !focus) return;
    let cancel = false;
    const go = () => {
      if (cancel || !mapRef.current) return;
      const center = map.getCenter();
      const near = Math.abs(map.getZoom() - focus.zoom) < 0.4
        && Math.abs(center.lng - focus.lng) < 0.02
        && Math.abs(center.lat - focus.lat) < 0.02;
      if (!near) map.jumpTo({ center: [focus.lng, focus.lat], zoom: focus.zoom });
    };
    go();
    map.on("idle", go);
    const timer = window.setInterval(go, 250);
    const stop = window.setTimeout(() => window.clearInterval(timer), 3000);
    return () => {
      cancel = true;
      map.off("idle", go);
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [mapGeneration, reviewToken, props.reviewFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = props.reviewMarkers || [];
    const current = markers.find((marker) => marker.current) || null;
    const marks = {
      type: "FeatureCollection" as const,
      features: markers.map((marker) => ({
        type: "Feature" as const,
        properties: { id: marker.id, n: String(marker.n), current: marker.current ? 1 : 0 },
        geometry: { type: "Point" as const, coordinates: [marker.lng, marker.lat] },
      })),
    };
    const ring = {
      type: "FeatureCollection" as const,
      features: current ? [{
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [current.lng, current.lat] },
      }] : [],
    };
    const dimmed = markers.length > 0;
    let cancel = false;
    const apply = () => {
      if (cancel || !map.isStyleLoaded()) return;
      const markSource = map.getSource("review-marks") as GeoJSONSource | undefined;
      const ringSource = map.getSource("review-ring") as GeoJSONSource | undefined;
      if (markSource) markSource.setData(marks);
      if (ringSource) ringSource.setData(ring);
      const set = (id: string, prop: "circle-opacity" | "circle-stroke-opacity" | "icon-opacity" | "text-opacity", value: number) => {
        if (!map.getLayer(id)) return;
        if (prop === "circle-opacity") map.setPaintProperty(id, "circle-opacity", value);
        else if (prop === "circle-stroke-opacity") map.setPaintProperty(id, "circle-stroke-opacity", value);
        else if (prop === "icon-opacity") map.setPaintProperty(id, "icon-opacity", value);
        else map.setPaintProperty(id, "text-opacity", value);
      };
      set("sites", "icon-opacity", dimmed ? 0.3 : 1);
      set("offmarket", "icon-opacity", dimmed ? 0.3 : 1);
      set("clusters", "circle-opacity", dimmed ? 0.3 : 1);
      set("clusters-halo", "circle-opacity", dimmed ? 0.05 : 0.14);
      set("unscreened", "circle-stroke-opacity", dimmed ? 0.3 : 1);
      set("deals-pipe", "icon-opacity", dimmed ? 0 : 1);
      set("deals-land", "icon-opacity", dimmed ? 0 : 1);
      set("deal-site-badge", "text-opacity", dimmed ? 0 : 1);
    };
    apply();
    const timer = window.setInterval(apply, 200);
    const stop = window.setTimeout(() => window.clearInterval(timer), 3000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [mapGeneration, props.reviewMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    const current = (props.reviewMarkers || []).find((marker) => marker.current);
    if (!map || !current) return;
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 1;
      const turn = (frame % 70) / 70;
      if (map.getLayer("review-ring")) {
        map.setPaintProperty("review-ring", "circle-radius", 16 + turn * 26);
        map.setPaintProperty("review-ring", "circle-stroke-opacity", 0.9 * (1 - turn));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapGeneration, props.reviewMarkers]);

  return (
      <div className="stage-map" data-basemap={props.basemap || "positron"}>
      <div ref={node} className="map" />
      <div className="map-tools">
        <details className="map-chrome">
          <summary>Map tools</summary>
        <div className="pin-label" role="group" aria-label="Basemap" data-testid="basemap">
          <span>Base</span>
          <button className={(props.basemap || "positron") === "positron" ? "on" : ""} type="button" onClick={() => props.onBasemap?.("positron")}>Map</button>
          <button className={props.basemap === "satellite" ? "on" : ""} type="button" onClick={() => props.onBasemap?.("satellite")}>Satellite</button>
        </div>
        <div className="pin-label" role="group" aria-label="Pin label" data-testid="pin-label">
          <span>Pin label</span>
          {(["none", "asking", "acres", "peracre"] as const).map((mode) => (
            <button key={mode} className={(props.pinLabel || "none") === mode ? "on" : ""} type="button" onClick={() => props.onPinLabel?.(mode)}>
              {mode === "none" ? "None" : mode === "asking" ? "Asking" : mode === "acres" ? "Acres" : "Per acre"}
            </button>
          ))}
        </div>
        <button className={measure ? "on" : ""} type="button" onClick={() => { setMeasure((value) => !value); setAreaTool("off"); points.current = []; setReadout(""); }}>
          Measure acres
        </button>
        <button className={areaTool === "radius" ? "on" : ""} type="button" onClick={() => { setAreaTool((value) => value === "radius" ? "off" : "radius"); setMeasure(false); }}>
          Radius
        </button>
        {areaTool === "radius" ? (
          <label className="map-readout">
            Miles
            <select aria-label="Radius miles" value={radiusMiles} onChange={(event) => setRadiusMiles(Number(event.target.value))}>
              {[0.5, 1, 2, 3, 5].map((miles) => <option key={miles} value={miles}>{miles}</option>)}
            </select>
          </label>
        ) : null}
        <button className={areaTool === "draw" ? "on" : ""} type="button" onClick={() => { setAreaTool((value) => value === "draw" ? "off" : "draw"); setMeasure(false); setDraftPoints([]); }}>
          Draw area
        </button>
        {areaTool === "draw" && draftPoints.length >= 3 ? (
          <button type="button" onClick={() => { props.onArea?.({ kind: "polygon", points: draftPoints }); setAreaTool("off"); }}>
            Use this area
          </button>
        ) : null}
        {props.area ? (
          <button type="button" onClick={() => { props.onArea?.(null); setDraftPoints([]); setAreaTool("off"); }}>
            Clear area
          </button>
        ) : null}
        {readout ? <span className="map-readout">{readout}</span> : null}
        </details>
      </div>
      {coverageText ? <p className="map-coverage" data-testid="map-coverage">{coverageText}</p> : null}
      <div className="map-attrib">{(props.basemap || "positron") === "satellite" ? "Powered by Esri · Earthstar Geographics, Maxar" : "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"}</div>
    </div>
  );
}
