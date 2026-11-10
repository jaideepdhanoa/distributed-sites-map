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
  queueIds?: string[];
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

function markCentered(map: Map, id: string, lng: number, lat: number) {
  const node = map.getContainer();
  node.dataset.centered = id;
  node.dataset.lng = lng.toFixed(4);
  node.dataset.lat = lat.toFixed(4);
}

function fitMap(
  map: Map,
  bounds: [[number, number], [number, number]],
  options: { padding: { top: number; bottom: number; left: number; right: number }; maxZoom?: number; duration?: number },
) {
  const center: [number, number] = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
  const box = map.getContainer();
  const spanLng = Math.abs(bounds[1][0] - bounds[0][0]);
  const spanLat = Math.abs(bounds[1][1] - bounds[0][1]);
  const reserved = map.getPadding();
  const roomHeight = box.clientHeight - (reserved.top ?? 0) - (reserved.bottom ?? 0);
  const roomWidth = box.clientWidth - (reserved.left ?? 0) - (reserved.right ?? 0);
  if (roomWidth < 48 || roomHeight < 48 || (spanLng < 1e-6 && spanLat < 1e-6)) {
    glide(map, center, options.maxZoom ?? 12);
    return;
  }
  const padding = {
    top: Math.min(options.padding.top, Math.floor(roomHeight / 5)),
    bottom: Math.min(options.padding.bottom, Math.floor(roomHeight / 5)),
    left: Math.min(options.padding.left, Math.floor(roomWidth / 6)),
    right: Math.min(options.padding.right, Math.floor(roomWidth / 6)),
  };
  const fitted = { ...options, padding };
  if (!map.cameraForBounds(bounds, fitted)) {
    glide(map, center, options.maxZoom ?? 12);
    return;
  }
  map.fitBounds(bounds, fitted);
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
  place("las-300", "Rings 200 and 300 (later)", [0.04, -0.16]);
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
  const [measureDone, setMeasureDone] = useState(false);
  const measureRef = useRef(false);
  measureRef.current = measure;
  const measureDoneRef = useRef(false);
  measureDoneRef.current = measureDone;
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
          { id: "areas-op", type: "fill", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "fill-color": "#dfeae1", "fill-opacity": 0.1 } },
          { id: "areas-op-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "line-color": "#b9cdbf", "line-width": 1.4 } },
          { id: "area-labels", type: "symbol", source: "area-labels", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-max-width": 8, "text-offset": [0, 1.1], "text-allow-overlap": false, "text-padding": 8 }, paint: { "text-color": "#f7f3ea", "text-halo-color": "#1c1914", "text-halo-width": 1.2 } },
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
            paint: { "circle-radius": 15, "circle-color": "#e7f0ea", "circle-stroke-color": "#1e4636", "circle-stroke-width": 3 },
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
            paint: { "circle-radius": 15, "circle-color": "#e7f0ea", "circle-stroke-color": "#1e4636", "circle-stroke-width": 3 },
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
          { id: "measure-fill", type: "fill", source: "measure", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#1e4636", "fill-opacity": 0.28 } },
          { id: "measure", type: "line", source: "measure", paint: { "line-color": "#fffdf8", "line-width": 2 } },
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
    let resizeTimer = 0;
    let resizeStop = 0;
    let cancelled = false;
    const boot = async () => {
    const basemap = propsRef.current.basemap || "satellite";
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
            edge = inside && d >= limit - 3.4;
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
        if (!measureRef.current || measureDoneRef.current) return;
        points.current = [...points.current, [event.lngLat.lng, event.lngLat.lat]];
        const coords = points.current;
        const source = map.getSource("measure") as GeoJSONSource;
        if (coords.length >= 3) {
          source.setData({
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } }],
          });
          const acres = acresOf(coords);
          setReadout(`${acres.toFixed(2)} ac · ${Math.round(acres * 43560).toLocaleString()} sq ft`);
        } else {
          source.setData({
            type: "FeatureCollection",
            features: coords.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [],
          });
          setReadout(coords.length === 2 ? "Add one more corner" : "Tap the corners");
        }
      });
      const satelliteOn = (propsRef.current.basemap || "satellite") === "satellite";
      const paint = (id: string, prop: "circle-color" | "circle-opacity" | "circle-stroke-color" | "circle-stroke-opacity" | "circle-stroke-width" | "fill-opacity" | "line-color" | "line-width" | "text-color" | "text-halo-color" | "text-halo-width", value: string | number) => {
        if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
      };
      const phoneScreen = window.matchMedia("(max-width: 767px)").matches;
      if (!satelliteOn) {
        paint("areas-op", "fill-opacity", 0.45);
        paint("area-labels", "text-color", "#5b554b");
        paint("area-labels", "text-halo-color", "#f6f3ec");
        paint("depot-labels", "text-color", "#1d4e89");
        paint("depot-labels", "text-halo-color", "#fffdf8");
      } else {
        paint("areas-op", "fill-opacity", phoneScreen ? 0.06 : 0.1);
        paint("areas-op-line", "line-color", "#f4efe6");
        paint("areas-op-line", "line-width", 2);
        for (const id of ["tier-large", "tier-small"]) {
          paint(id, "circle-stroke-color", "#fffdf8");
          paint(id, "circle-stroke-width", 2);
        }
        for (const id of ["tier-large-halo", "tier-small-halo"]) {
          paint(id, "circle-stroke-color", "#1c1914");
          paint(id, "circle-stroke-width", 3);
          paint(id, "circle-stroke-opacity", 0.9);
        }
        paint("selected-halo", "circle-color", "#1e4636");
        paint("selected-halo", "circle-opacity", 0.2);
        paint("selected-halo", "circle-stroke-color", "#1e4636");
        paint("selected-halo", "circle-stroke-width", 3);
        paint("selected", "circle-color", "#e7f0ea");
        paint("selected", "circle-stroke-color", "#1e4636");
        paint("selected", "circle-stroke-width", 3);
        paint("deal-halo", "circle-color", "#1e4636");
        paint("deal-halo", "circle-opacity", 0.2);
        paint("deal-halo", "circle-stroke-color", "#1e4636");
        paint("deal-halo", "circle-stroke-width", 3);
        paint("deal-ring", "circle-color", "#e7f0ea");
        paint("deal-ring", "circle-stroke-color", "#1e4636");
        paint("deal-ring", "circle-stroke-width", 3);
        paint("clusters", "circle-stroke-width", 3);
        paint("clusters-halo", "circle-opacity", 0.5);
        paint("clusters-halo", "circle-stroke-color", "#fffdf8");
        paint("clusters-halo", "circle-stroke-width", 2);
        paint("deal-pills", "text-halo-color", "#fffdf8");
        paint("deal-pills", "text-halo-width", 4);
        paint("deal-site-badge", "text-halo-width", 1.6);
        paint("unscreened", "circle-stroke-width", 3);
        paint("missing-parcel", "circle-stroke-color", "#f3d48a");
        paint("missing-parcel", "circle-stroke-width", 3);
        paint("missing-parcel-deals", "circle-stroke-color", "#f3d48a");
        paint("missing-parcel-deals", "circle-stroke-width", 3);
        paint("review-marks", "circle-stroke-width", 3);
        paint("offmarket-selected", "circle-stroke-width", 3);
      }
      map.on("moveend", () => propsRef.current.onBounds(map.getBounds()));
      propsRef.current.onBounds(map.getBounds());
    });
    const observed = node.current;
    const recenter = () => {
      if (!map.isStyleLoaded()) return;
      map.resize();
      if (propsRef.current.reviewFocus) return;
      const id = propsRef.current.selectedId;
      if (!id) return;
      const deal = propsRef.current.deals.find((feature) => feature.properties.deal_id === id);
      const site = propsRef.current.sites.find((feature) => feature.properties.site_id === id);
      const off = propsRef.current.offMarket.find((feature) => feature.properties.site_id === id);
      const geometry = deal?.geometry || site?.geometry || off?.geometry;
      if (!geometry || geometry.type !== "Point") return;
      const pin = geometry.coordinates as [number, number];
      if (!Number.isFinite(pin[0]) || !Number.isFinite(pin[1])) return;
      markCentered(map, id, pin[0], pin[1]);
      const center = map.getCenter();
      const near = Math.abs(center.lng - pin[0]) < 0.01 && Math.abs(center.lat - pin[1]) < 0.01 && map.getZoom() >= 13;
      if (!near) map.jumpTo({ center: pin, zoom: 15 });
    };
    observer = new ResizeObserver(() => recenter());
    observer.observe(observed);
    resizeTimer = window.setInterval(recenter, 250);
    resizeStop = window.setTimeout(() => window.clearInterval(resizeTimer), 4000);
    mapRef.current = map;
    (window as Window & { __sitesMap?: Map }).__sitesMap = map;
    if (!cancelled) setMapGeneration((value) => value + 1);
    };
    void boot();
    return () => {
      cancelled = true;
      window.clearInterval(resizeTimer);
      window.clearTimeout(resizeStop);
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
  const focusToken = `${props.focusLng},${props.focusLat},${props.focusZoom},${props.basemap || "satellite"}`;
  const reviewToken = props.reviewFocus ? `${props.reviewFocus.lng},${props.reviewFocus.lat},${props.reviewFocus.zoom}` : "";
  const appliedFocus = useRef("");
  const appliedReview = useRef("");
  const appliedFit = useRef("");
  const appliedPad = useRef("");
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
      const queued = new Set(props.queueIds || []);
      const queueData = {
        type: "FeatureCollection" as const,
        features: props.deals.flatMap((feature) => {
          if (!feature.geometry || !queued.has(feature.properties.deal_id)) return [];
          return [{ type: "Feature" as const, properties: {}, geometry: feature.geometry }];
        }),
      };
      const queueSource = map.getSource("queue-dots") as GeoJSONSource | undefined;
      if (queueSource) queueSource.setData(queueData);
      else {
        map.addSource("queue-dots", { type: "geojson", data: queueData });
        map.addLayer({
          id: "queue-dots",
          type: "circle",
          source: "queue-dots",
          paint: {
            "circle-radius": (props.basemap || "satellite") === "satellite" ? 4 : 3.5,
            "circle-color": (props.basemap || "satellite") === "satellite" ? "#1c1914" : "#8d7350",
            "circle-stroke-width": (props.basemap || "satellite") === "satellite" ? 2 : 1,
            "circle-stroke-color": "#fffdf8",
            "circle-translate": [8, -8],
          },
        });
      }
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
      const reviewing = Boolean(props.reviewFocus) || (props.reviewMarkers || []).length > 0;
      const phonePad = phone && !reviewing;
      const padKey = phonePad ? "clear" : "flush";
      map.setPadding(phonePad ? { top: 176, bottom: 168, left: 16, right: 20 } : { top: 0, bottom: 0, left: 0, right: 0 });
      if ((props.basemap || "satellite") === "satellite" && map.getLayer("areas-op")) {
        map.setPaintProperty("areas-op", "fill-opacity", phone ? 0.06 : 0.1);
      }
      const finiteFit = (props.fitPoints || []).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
      const fitKey = finiteFit.map((point) => point.join(",")).join("|");
      if (reviewToken) {
        appliedReview.current = reviewToken;
        appliedPad.current = "flush";
      } else if (phone && fitKey && (appliedFit.current !== fitKey || appliedPad.current !== padKey)) {
        appliedFit.current = fitKey;
        appliedPad.current = padKey;
        appliedFocus.current = focusToken;
        const lngs = finiteFit.map((point) => point[0]);
        const lats = finiteFit.map((point) => point[1]);
        fitMap(
          map,
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 176, bottom: 168, left: 28, right: 36 }, maxZoom: 12.4, duration: 0 },
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
  }, [mapGeneration, props.sites, props.deals, props.areas, props.depots, props.parcels, props.offMarket, props.unscreened, props.selectedId, props.pinLabel, props.fitPoints, props.overlayPoints, props.gridFeatures, props.queueIds, focusToken, reviewToken, props.focusLng, props.focusLat, props.focusZoom, props.reviewFocus]);

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
      markCentered(map, props.selectedId || "", pin[0], pin[1]);
      if (!extra.length) {
        glide(map, pin, 16);
        return;
      }
      const points = [pin, ...extra];
      const lngs = points.map((point) => point[0]);
      const lats = points.map((point) => point[1]);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      fitMap(
        map,
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

  useEffect(() => {
    if (measure) return;
    points.current = [];
    setReadout("");
    setMeasureDone(false);
    const source = mapRef.current?.getSource("measure") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [] });
  }, [measure]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!measureRef.current) return;
      if (event.key === "Escape") setMeasure(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function undoMeasure() {
    points.current = points.current.slice(0, -1);
    setMeasureDone(false);
    const coords = points.current;
    const source = mapRef.current?.getSource("measure") as GeoJSONSource | undefined;
    if (!source) return;
    if (coords.length >= 3) {
      source.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } }] });
      const acres = acresOf(coords);
      setReadout(`${acres.toFixed(2)} ac · ${Math.round(acres * 43560).toLocaleString()} sq ft`);
    } else if (coords.length >= 2) {
      source.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] });
      setReadout("Add one more corner");
    } else {
      source.setData({ type: "FeatureCollection", features: [] });
      setReadout(coords.length ? "Tap the corners" : "");
    }
  }

  return (
      <div className="stage-map" data-basemap={props.basemap || "satellite"}>
      <div ref={node} className="map" />
      <div className="map-float">
        <div className="segmented map-basemap only-desktop" role="group" aria-label="Basemap" data-testid="basemap-desktop">
          <button type="button" className={`segmented ${(props.basemap || "satellite") === "satellite" ? "on" : ""}`} onClick={() => props.onBasemap?.("satellite")}>Satellite</button>
          <button type="button" className={`segmented ${(props.basemap || "satellite") === "positron" ? "on" : ""}`} onClick={() => props.onBasemap?.("positron")}>Map</button>
        </div>
        <div className="measure-row">
          {measure ? (
            <div className="measure-bar">
              <span>{readout || "Tap the corners"}</span>
              <button type="button" className="paper-btn" onClick={undoMeasure}>Undo</button>
              <button type="button" className="paper-btn" data-testid="measure-done" onClick={() => setMeasure(false)}>Done</button>
            </div>
          ) : null}
          <button type="button" className={`tool ${measure ? "on" : ""}`} data-testid="measure" onClick={() => setMeasure((value) => !value)}>Measure</button>
        </div>
      </div>
      <div className="map-attrib">{(props.basemap || "satellite") === "satellite" ? "Powered by Esri · Earthstar Geographics, Maxar" : "OpenFreeMap © OpenMapTiles Data from OpenStreetMap"}</div>
    </div>
  );
}
