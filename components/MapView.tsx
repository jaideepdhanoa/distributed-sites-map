"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map, NavigationControl, setWorkerUrl, type MapLayerMouseEvent, type MapMouseEvent, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AREA_LABELS, AREA_PAINT, areaRole } from "@/lib/areas";
import type { NearbyWash } from "@/lib/nearbyWashes";
import { areaTip, dealTip, depotTip, ringTip, siteTip, tipHtml, washTip, type TipModel } from "@/lib/markerTip";
import { CLUSTER_SOURCE, PHONE_BUBBLE_PX, PIN_SPLIT_ZOOM, clusterBubbleLabel, countedPins, leafBounds, phoneBubbleRadius, takeSolo, type PinFeature } from "@/lib/mapClusters";
import { mutedPositronStyle } from "@/lib/mutedStyle";
import { AREA_TIP_DWELL_MS, placeReadableTip, type TipBox } from "@/lib/tipPlace";
import { dealLabelFeatures, publicDeal, type PinLabel } from "@/lib/keyNumbers";
import { depotRingFeatures, ringFrameCoordinates, ringStrokeMeets, type LngLatBounds } from "@/lib/depotRings";
import type { MapArea } from "@/lib/geoFilter";
import type { DealFeature, GeoFeature, SiteFeature, UnscreenedFeature } from "@/lib/types";
import type { GroundBox } from "@/lib/spaces/measure";
import SpaceTools, { spaceIdAt } from "./spaces/SpaceTools";
import type { SpaceShape } from "./spaces/SpacePopover";

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
  /** Pipeline bubbles count deals. Universe bubbles count sites. */
  groupPins?: "deals" | "sites";
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
  onShowList?: () => void;
  onBounds: (
    bounds: {
      contains: (lnglat: [number, number]) => boolean;
      getWest?: () => number;
      getSouth?: () => number;
      getEast?: () => number;
      getNorth?: () => number;
    },
    meta?: { user: boolean },
  ) => void;
  fitPoints?: [number, number][];
  area?: MapArea | null;
  onArea?: (area: MapArea | null) => void;
  overlayPoints?: { label: string; coordinates: [number, number] }[];
  washPoints?: NearbyWash[];
  gridFeatures?: GeoFeature[];
  onRingsOutside?: (outside: boolean) => void;
  registerFrameRings?: (frame: (() => void) | null) => void;
  spaceShapes?: SpaceShape[];
  showSpaces?: boolean;
  spaceDrawing?: boolean;
  spaceFly?: { lng: number; lat: number; nonce: number } | null;
  selectedSpaceId?: string;
  spaceNames?: Record<string, string>;
  onSpaceSelect?: (id: string) => void;
  onSpaceCreate?: (box: GroundBox) => void;
  onSpaceChange?: (space: SpaceShape) => void;
  onSpaceDelete?: (space: SpaceShape) => void;
  onSpaceDone?: () => void;
  fitAll?: boolean;
  /** When this token changes, keep the current center and zoom. */
  preserveCamera?: string;
  canDrawLots?: boolean;
  onDrawLots?: () => void;
  commentedSpaceIds?: string[];
  threadSpaceId?: string;
  onThreadClose?: () => void;
  onMapFailed?: (message: string) => void;
};

const RING_LAYER_IDS = ["rings-10-case", "rings-10", "rings-5-case", "rings-5"];

const AREA_LAYER_IDS = [
  "areas-later-case",
  "areas-later",
  "areas-priority",
  "areas-priority-line",
  "areas-current",
  "areas-current-line",
  "areas-launch",
  "areas-launch-line",
  "areas-future-case",
  "areas-future",
  "area-labels",
];

function geometryCoords(geometry: { type: string; coordinates: unknown } | null | undefined): [number, number][] {
  if (!geometry) return [];
  if (geometry.type === "Point") return [geometry.coordinates as [number, number]];
  if (geometry.type === "LineString") return geometry.coordinates as [number, number][];
  if (geometry.type === "Polygon") return (geometry.coordinates as [number, number][][])[0] || [];
  return [];
}

function drawerInset(map: Map) {
  if (window.matchMedia("(max-width: 767px)").matches) return 0;
  const shell = map.getContainer().closest(".shell");
  if (!shell?.classList.contains("drawer-open")) return 0;
  const raw = Number.parseFloat(getComputedStyle(shell).getPropertyValue("--drawer-width"));
  return Number.isFinite(raw) && raw > 0 ? raw : 480;
}

function pointPadding(map: Map) {
  return { top: 0, bottom: 0, left: 0, right: drawerInset(map) };
}

function applyClusterChrome(map: Map) {
  const phone = window.matchMedia("(max-width: 767px)").matches;
  if (map.getLayer("clusters")) {
    map.setPaintProperty("clusters", "circle-radius", phone ? phoneBubbleRadius() : ["step", ["get", "point_count"], 22, 20, 26, 80, 30]);
  }
  if (map.getLayer("clusters-halo")) {
    map.setPaintProperty("clusters-halo", "circle-radius", phone ? phoneBubbleRadius() + 8 : ["+", ["step", ["get", "point_count"], 22, 20, 26, 80, 30], 8]);
  }
  const pinIcon = phone ? PHONE_BUBBLE_PX / 36 : 0.9;
  if (map.getLayer("focus-pin")) map.setLayoutProperty("focus-pin", "icon-size", phone ? PHONE_BUBBLE_PX / 36 : 0.92);
  if (map.getLayer("pin-singles")) map.setLayoutProperty("pin-singles", "icon-size", phone ? PHONE_BUBBLE_PX / 36 : 0.92);
  if (map.getLayer("offmarket")) map.setLayoutProperty("offmarket", "icon-size", phone ? pinIcon : 0.9);
  if (map.getLayer("deals-pipe")) map.setLayoutProperty("deals-pipe", "icon-size", phone ? pinIcon : 0.9);
  if (map.getLayer("deals-land")) map.setLayoutProperty("deals-land", "icon-size", phone ? pinIcon : 0.9);
  if (map.getLayer("sites")) {
    map.setLayoutProperty("sites", "icon-size", phone ? pinIcon : ["interpolate", ["linear"], ["zoom"], 8, 0.74, 14, 0.92]);
  }
  const shell = map.getContainer().closest(".stage-map");
  if (shell instanceof HTMLElement) shell.dataset.clusterPx = String(phone ? PHONE_BUBBLE_PX : 44);
}

function markZoomBand(map: Map) {
  const band = map.getZoom() >= PIN_SPLIT_ZOOM ? "pins" : "groups";
  const shell = map.getContainer().closest(".stage-map");
  if (shell instanceof HTMLElement) {
    shell.dataset.zoomBand = band;
    const zoom = map.getZoom().toFixed(2);
    shell.dataset.zoom = zoom;
    const root = shell.closest(".shell");
    if (root instanceof HTMLElement) root.dataset.zoom = zoom;
  }
}

function glide(map: Map, center: [number, number], zoom: number) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.flyTo({ center, zoom, padding: pointPadding(map), duration: reduce ? 0 : 300, essential: true });
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
  const cover = Math.max(drawerInset(map), reserved.right ?? 0);
  const padding = {
    top: Math.min(options.padding.top, Math.floor(roomHeight / 5)),
      bottom: Math.min(options.padding.bottom, Math.floor(roomHeight / 5)),
    left: Math.min(options.padding.left, Math.floor(roomWidth / 6)),
    right: Math.min(Math.max(0, cover - (reserved.right ?? 0)), Math.max(0, roomWidth - 48)),
  };
  const fitted = { ...options, padding };
  if (!map.cameraForBounds(bounds, fitted)) {
    glide(map, center, options.maxZoom ?? 12);
    return;
  }
  map.fitBounds(bounds, fitted);
}

function frameSites(map: Map, points: [number, number][], phone: boolean) {
  const finite = points.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!finite.length) return false;
  const lngs = finite.map((point) => point[0]);
  const lats = finite.map((point) => point[1]);
  fitMap(
    map,
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    {
      padding: phone
        ? { top: 176, bottom: 120, left: 28, right: 28 }
        : { top: 72, bottom: 64, left: 48, right: 260 },
      maxZoom: 10.5,
      duration: 0,
    },
  );
  return true;
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
  const labels: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { name: string; id: string } }[] = [];
  for (const item of AREA_LABELS) {
    const feature = areas.find((area) => area.properties.id === item.id);
    const center = feature ? bboxCenter(feature) : null;
    if (!center) continue;
    const nudge = item.nudge || [0, 0];
    labels.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [center[0] + nudge[0], center[1] + nudge[1]] },
      properties: { name: item.name, id: item.id },
    });
  }
  return labels;
}

function presentAreas(areas: GeoFeature[]) {
  return areas.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      role: areaRole(String(feature.properties.id || ""), String(feature.properties.group || "")),
    },
  }));
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
  const keptCamera = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const heldView = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const skipViewReset = useRef(false);
  const freezeCamera = useRef(false);
  const clusterLeaves = useRef(new globalThis.Map<number, { properties?: Record<string, unknown> }[]>());
  const holdCamera = useRef(false);
  const preserveCamera = useRef<string | undefined>(undefined);
  const sawSelection = useRef<string | null>(null);
  const [measure, setMeasure] = useState(false);
  const [measureDone, setMeasureDone] = useState(false);
  const [draftPoints, setDraftPoints] = useState(0);
  const [drawCommand, setDrawCommand] = useState<{ id: number; type: "undo" | "cancel" | "finish" } | null>(null);
  const [deleteAsk, setDeleteAsk] = useState(0);
  const drawSeq = useRef(0);
  const measureRef = useRef(false);
  measureRef.current = measure;
  const measureDoneRef = useRef(false);
  measureDoneRef.current = measureDone;
  const [readout, setReadout] = useState("");
  const [mapGeneration, setMapGeneration] = useState(0);
  const [mapFailed, setMapFailed] = useState("");
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
          sites: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          offmarket: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          deals: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          pins: { type: "geojson", data: { type: "FeatureCollection", features: [] }, ...CLUSTER_SOURCE },
          "focus-pin": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "deal-labels": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          unscreened: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          depots: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          rings: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          washes: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          measure: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "review-ring": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          "review-marks": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "imagery", type: "raster", source: "imagery" },
          { id: "labels", type: "raster", source: "labels", layout: { visibility: "none" } },
          { id: "areas-later-case", type: "line", source: "areas", filter: ["==", ["get", "role"], "later"], paint: { "line-color": AREA_PAINT.caseLine, "line-width": 4, "line-opacity": 0.35 } },
          { id: "areas-later", type: "line", source: "areas", filter: ["==", ["get", "role"], "later"], paint: { "line-color": AREA_PAINT.laterLineSatellite, "line-dasharray": [2, 1.4], "line-width": 2.2, "line-opacity": 0.95 } },
          { id: "areas-priority", type: "fill", source: "areas", filter: ["==", ["get", "role"], "priority"], paint: { "fill-color": AREA_PAINT.priorityFill, "fill-opacity": 0.22 } },
          { id: "areas-priority-line", type: "line", source: "areas", filter: ["==", ["get", "role"], "priority"], paint: { "line-color": AREA_PAINT.priorityLineSatellite, "line-width": 2.2 } },
          { id: "areas-current", type: "fill", source: "areas", filter: ["==", ["get", "role"], "current"], paint: { "fill-color": AREA_PAINT.currentFill, "fill-opacity": 0.16 } },
          { id: "areas-current-line", type: "line", source: "areas", filter: ["==", ["get", "role"], "current"], paint: { "line-color": AREA_PAINT.currentLineSatellite, "line-width": 2.6 } },
          { id: "areas-launch", type: "fill", source: "areas", filter: ["==", ["get", "role"], "launch"], paint: { "fill-color": AREA_PAINT.launchFill, "fill-opacity": 0.32 } },
          { id: "areas-launch-line", type: "line", source: "areas", filter: ["==", ["get", "role"], "launch"], paint: { "line-color": AREA_PAINT.launchLineSatellite, "line-width": 2.6 } },
          { id: "areas-future-case", type: "line", source: "areas", filter: ["==", ["get", "role"], "future"], paint: { "line-color": AREA_PAINT.caseLine, "line-width": 6, "line-opacity": 0.55 } },
          { id: "areas-future", type: "line", source: "areas", filter: ["==", ["get", "role"], "future"], paint: { "line-color": AREA_PAINT.futureLineSatellite, "line-dasharray": [1.4, 0.9], "line-width": 3.6 } },
          { id: "rings-10-case", type: "line", source: "rings", filter: ["==", ["get", "miles"], 10], layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fffdf8", "line-width": 6, "line-opacity": 0.95 } },
          { id: "rings-10", type: "line", source: "rings", filter: ["==", ["get", "miles"], 10], layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1d4e89", "line-width": 2.8, "line-dasharray": [2.6, 1.5], "line-opacity": 1 } },
          { id: "rings-5-case", type: "line", source: "rings", filter: ["==", ["get", "miles"], 5], layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fffdf8", "line-width": 7, "line-opacity": 0.98 } },
          { id: "rings-5", type: "line", source: "rings", filter: ["==", ["get", "miles"], 5], layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1e4636", "line-width": 3.4, "line-dasharray": [0.9, 0.7], "line-opacity": 1 } },
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "site_id"], ""],
            paint: { "circle-radius": 22, "circle-color": "#8a8173", "circle-opacity": 0.16 },
          },
          {
            id: "offmarket",
            type: "symbol",
            source: "offmarket",
            minzoom: PIN_SPLIT_ZOOM,
            layout: { "icon-image": "dia-stone", "icon-size": 0.9, "icon-allow-overlap": true },
          },
          {
            id: "offmarket-selected",
            type: "circle",
            source: "offmarket",
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "site_id"], ""],
            paint: { "circle-radius": 16, "circle-color": "transparent", "circle-stroke-color": "#fffdf8", "circle-stroke-width": 2 },
          },
          {
            id: "clusters-halo",
            type: "circle",
            source: "pins",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#1e4636",
              "circle-opacity": 0.22,
              "circle-stroke-color": "#1c1914",
              "circle-stroke-width": 2,
              "circle-radius": ["+", ["step", ["get", "point_count"], 22, 20, 26, 80, 30], 8],
            },
          },
          {
            id: "clusters",
            type: "circle",
            source: "pins",
            filter: ["has", "point_count"],
            paint: { "circle-color": "#1e4636", "circle-radius": ["step", ["get", "point_count"], 22, 20, 26, 80, 30], "circle-stroke-color": "#fffdf8", "circle-stroke-width": 3, "circle-opacity": 1 },
          },
          {
            id: "cluster-count",
            type: "symbol",
            source: "pins",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 15, "text-allow-overlap": true },
            paint: { "text-color": "#fffdf8", "text-halo-color": "#1e4636", "text-halo-width": 1 },
          },
          {
            id: "tier-large-halo",
            type: "circle",
            source: "sites",
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "land_tier"], "L10"],
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "land_tier"], "L10"],
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "land_tier"], "L4"],
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "land_tier"], "L4"],
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
            minzoom: PIN_SPLIT_ZOOM,
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "site_id"], ""]],
            paint: { "circle-radius": 15, "circle-color": "#e7f0ea", "circle-stroke-color": "#1e4636", "circle-stroke-width": 3 },
          },
          {
            id: "sites",
            type: "symbol",
            source: "sites",
            minzoom: PIN_SPLIT_ZOOM,
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["all", ["has", "linked_deal_id"], ["!=", ["get", "linked_deal_id"], ""]],
            paint: { "circle-radius": 11, "circle-color": "transparent", "circle-stroke-color": "#f7f3ea", "circle-stroke-width": 2 },
          },
          {
            id: "deal-halo",
            type: "circle",
            source: "deals",
            minzoom: PIN_SPLIT_ZOOM,
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "deal_id"], ""],
            paint: { "circle-radius": 15, "circle-color": "#e7f0ea", "circle-stroke-color": "#1e4636", "circle-stroke-width": 3 },
          },
          {
            id: "deals-pipe",
            type: "symbol",
            source: "deals",
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "kind"], "pipeline"],
            layout: { "icon-image": ["concat", "sq-", ["get", "stage_group"]], "icon-size": 0.9, "icon-allow-overlap": true },
          },
          {
            id: "deal-site-badge",
            type: "symbol",
            source: "deals",
            minzoom: PIN_SPLIT_ZOOM,
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
            minzoom: PIN_SPLIT_ZOOM,
            filter: ["==", ["get", "kind"], "land"],
            layout: { "icon-image": ["concat", "sq-", ["get", "stage_group"]], "icon-size": 0.9, "icon-allow-overlap": true },
          },
          {
            id: "deal-pills",
            type: "symbol",
            source: "deal-labels",
            minzoom: PIN_SPLIT_ZOOM,
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
          {
            id: "area-labels",
            type: "symbol",
            source: "area-labels",
            minzoom: PIN_SPLIT_ZOOM,
            layout: {
              "text-field": ["get", "name"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 13,
              "text-max-width": 12,
              "text-anchor": "left",
              "text-offset": [0.2, 0],
              "text-justify": "left",
              "text-allow-overlap": false,
              "text-optional": true,
              "text-padding": 6,
            },
            paint: { "text-color": "#f7f3ea", "text-halo-color": "#1c1914", "text-halo-width": 2 },
          },
          {
            id: "nearby-washes",
            type: "circle",
            source: "washes",
            paint: {
              "circle-radius": 5.5,
              "circle-color": "#fffdf8",
              "circle-stroke-color": "#1c1914",
              "circle-stroke-width": 2,
            },
          },
          {
            id: "nearby-wash-labels",
            type: "symbol",
            source: "washes",
            layout: {
              "text-field": ["get", "name"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 11,
              "text-offset": [0, 1.15],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "text-optional": true,
            },
            paint: { "text-color": "#1c1914", "text-halo-color": "#fffdf8", "text-halo-width": 1.4 },
          },
          { id: "measure-fill", type: "fill", source: "measure", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#1e4636", "fill-opacity": 0.28 } },
          { id: "measure", type: "line", source: "measure", paint: { "line-color": "#fffdf8", "line-width": 2 } },
          {
            id: "pin-singles",
            type: "symbol",
            source: "pins",
            maxzoom: PIN_SPLIT_ZOOM,
            filter: ["!", ["has", "point_count"]],
            layout: {
              "icon-image": [
                "case",
                ["==", ["get", "pin_kind"], "deal"], ["concat", "sq-", ["coalesce", ["get", "stage_group"], "sourced"]],
                ["==", ["get", "pin_kind"], "off"], "dia-stone",
                ["all", ["==", ["get", "verdict"], "PASS"], ["==", ["get", "network_status"], "held"]], "dia-held",
                ["==", ["get", "verdict"], "PASS"], "dia-moss",
                ["==", ["get", "verdict"], "MAYBE"], "dia-amber",
                ["==", ["get", "verdict"], "UNRESOLVED"], "dia-clay",
                ["==", ["get", "verdict"], "FAIL"], "dia-clay",
                ["==", ["get", "verdict"], "NOT_A_WASH"], "dia-clay",
                "dia-stone",
              ],
              "icon-size": 0.92,
              "icon-allow-overlap": true,
            },
          },
          {
            id: "focus-ring",
            type: "circle",
            source: "focus-pin",
            maxzoom: PIN_SPLIT_ZOOM,
            paint: { "circle-radius": 18, "circle-color": "#e7f0ea", "circle-stroke-color": "#1e4636", "circle-stroke-width": 3 },
          },
          {
            id: "focus-pin",
            type: "symbol",
            source: "focus-pin",
            maxzoom: PIN_SPLIT_ZOOM,
            layout: {
              "icon-image": [
                "case",
                ["==", ["get", "pin_kind"], "deal"], ["concat", "sq-", ["coalesce", ["get", "stage_group"], "sourced"]],
                ["==", ["get", "pin_kind"], "off"], "dia-stone",
                ["all", ["==", ["get", "verdict"], "PASS"], ["==", ["get", "network_status"], "held"]], "dia-held",
                ["==", ["get", "verdict"], "PASS"], "dia-moss",
                ["==", ["get", "verdict"], "MAYBE"], "dia-amber",
                ["==", ["get", "verdict"], "UNRESOLVED"], "dia-clay",
                ["==", ["get", "verdict"], "FAIL"], "dia-clay",
                ["==", ["get", "verdict"], "NOT_A_WASH"], "dia-clay",
                "dia-stone",
              ],
              "icon-size": 0.92,
              "icon-allow-overlap": true,
            },
          },
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
    let tipEl: HTMLDivElement | null = null;
    let observer: ResizeObserver | null = null;
    let resizeTimer = 0;
    let resizeStop = 0;
    let areaDwell = 0;
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
    let canDraw = false;
    try {
      const canvas = document.createElement("canvas");
      canDraw = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      canDraw = false;
    }
    if (!canDraw) {
      setMapFailed("This browser cannot draw the map. Try the latest Chrome, Edge, or Safari.");
      propsRef.current.onMapFailed?.("This browser cannot draw the map. Try the latest Chrome, Edge, or Safari.");
      return;
    }
    const kept = keptCamera.current;
    let map: Map;
    try {
      map = new Map({
      container: node.current,
      style,
      center: kept?.center ?? [props.focusLng, props.focusLat],
      zoom: kept?.zoom ?? props.focusZoom,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 0,
    });
    } catch {
      setMapFailed("This browser cannot draw the map. Try the latest Chrome, Edge, or Safari.");
      propsRef.current.onMapFailed?.("This browser cannot draw the map. Try the latest Chrome, Edge, or Safari.");
      return;
    }
    setMapFailed("");
    propsRef.current.onMapFailed?.("");
    active = map;
    keptCamera.current = null;
    heldView.current = kept;
    if (kept) {
      skipViewReset.current = true;
      freezeCamera.current = true;
    }
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
    const icons: Record<string, Uint8Array> = { depot: image };
    const pinColors: Record<string, [number, number, number]> = {
      stone: [138, 129, 115],
      amber: [168, 113, 27],
      moss: [56, 113, 86],
      clay: [158, 75, 62],
      held: [29, 78, 137],
    };
    for (const [name, rgb] of Object.entries(pinColors)) icons[`dia-${name}`] = marker("diamond", rgb);
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
    for (const [name, rgb] of Object.entries(squares)) icons[`sq-${name}`] = square(rgb);
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
    const addIcon = (id: string) => {
      const data = icons[id];
      if (!data || map.hasImage(id)) return;
      map.addImage(id, { width: size, height: size, data });
    };
    map.on("styleimagemissing", (event) => addIcon(event.id));
    map.on("load", () => {
      for (const id of Object.keys(icons)) addIcon(id);
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
      const raiseGroups = () => {
        for (const id of ["clusters-halo", "clusters", "cluster-count", "pin-singles", "focus-ring", "focus-pin"]) {
          if (map.getLayer(id)) map.moveLayer(id);
        }
      };
      raiseGroups();
      let hideGroupTip = () => undefined as void;
      const openGroup = (clusterId: number) => {
        holdCamera.current = true;
        hideGroupTip();
        const source = map.getSource("pins") as GeoJSONSource;
        source.getClusterLeaves(clusterId, 10000, 0).then((leaves) => {
          const bounds = leafBounds(leaves as PinFeature[]);
          if (!bounds) return;
          const phone = window.matchMedia("(max-width: 767px)").matches;
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          fitMap(map, bounds, {
            padding: phone
              ? { top: 96, bottom: 120, left: 28, right: 28 }
              : { top: 72, bottom: 64, left: 48, right: Math.max(48, drawerInset(map)) },
            maxZoom: 16,
            duration: reduce ? 0 : 450,
          });
        }).catch(() => undefined);
      };
      const groupAt = (point: { x: number; y: number }) => {
        const layers = ["clusters", "cluster-count", "clusters-halo"].filter((id) => map.getLayer(id));
        const hit = layers.length ? map.queryRenderedFeatures([point.x, point.y], { layers })[0] : undefined;
        const clusterId = hit?.properties?.cluster_id;
        return clusterId == null ? null : Number(clusterId);
      };
      map.on("click", (event) => {
        const point = (event as MapMouseEvent).point;
        if (!point) return;
        const clusterId = groupAt(point);
        if (clusterId == null) return;
        (event as MapMouseEvent).originalEvent?.preventDefault();
        openGroup(clusterId);
      });
      map.on("dragstart", () => {
        holdCamera.current = true;
      });
      map.on("zoomstart", (event) => {
        if ((event as { originalEvent?: Event }).originalEvent) holdCamera.current = true;
      });
      const lotAt = (event: MapLayerMouseEvent | MapMouseEvent) => {
        const id = spaceIdAt(map, event.point, event.lngLat, propsRef.current.spaceShapes || []);
        if (!id) return false;
        propsRef.current.onSpaceSelect?.(id);
        return true;
      };
      map.on("click", "pin-singles", (event: MapLayerMouseEvent) => {
        if (measureRef.current || event.originalEvent.defaultPrevented || propsRef.current.spaceDrawing || groupAt(event.point) != null) return;
        const props = event.features?.[0]?.properties;
        const id = props?.site_id || props?.deal_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "focus-pin", (event: MapLayerMouseEvent) => {
        if (measureRef.current || event.originalEvent.defaultPrevented || propsRef.current.spaceDrawing || groupAt(event.point) != null) return;
        const props = event.features?.[0]?.properties;
        const id = props?.site_id || props?.deal_id || props?.listing_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "sites", (event: MapLayerMouseEvent) => {
        if (measureRef.current || event.originalEvent.defaultPrevented || propsRef.current.spaceDrawing || groupAt(event.point) != null) return;
        if (lotAt(event)) return;
        const feature = event.features?.[0];
        const id = feature?.properties?.site_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "offmarket", (event: MapLayerMouseEvent) => {
        if (measureRef.current || groupAt(event.point) != null) return;
        if (lotAt(event)) return;
        const id = event.features?.[0]?.properties?.site_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "review-marks", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "deals-pipe", (event: MapLayerMouseEvent) => {
        if (measureRef.current || groupAt(event.point) != null) return;
        const id = event.features?.[0]?.properties?.deal_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "deals-land", (event: MapLayerMouseEvent) => {
        if (measureRef.current || groupAt(event.point) != null) return;
        const id = event.features?.[0]?.properties?.deal_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "unscreened", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.listing_id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      map.on("click", "nearby-washes", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") propsRef.current.onSelect(id);
      });
      const tip = document.createElement("div");
      tip.className = "map-tip-fixed";
      tip.dataset.hidden = "1";
      document.body.appendChild(tip);
      tipEl = tip;
      const tipLayers = ["clusters", "cluster-count", "focus-pin", "sites", "offmarket", "deals-pipe", "deals-land", "unscreened", "depots", "nearby-washes", ...RING_LAYER_IDS, ...AREA_LAYER_IDS];
      const areaLayers = new Set([...AREA_LAYER_IDS, ...RING_LAYER_IDS]);
      let shownKey = "";
      let request = 0;
      let tipPoint: { x: number; y: number } | undefined;
      const clearDwell = () => {
        window.clearTimeout(areaDwell);
        areaDwell = 0;
      };
      const hideTip = () => {
        clearDwell();
        shownKey = "";
        request += 1;
        tip.dataset.hidden = "1";
        map.getCanvas().style.cursor = "";
      };
      hideGroupTip = hideTip;
      const chromeBoxes = (): TipBox[] => ["aside.drawer", "aside.layers.open", ".map-float", ".maplibregl-ctrl-top-right"].flatMap((selector) => {
        const node = document.querySelector(selector);
        if (!node) return [];
        const rect = node.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return [];
        return [{ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }];
      });
      const placeTip = (point?: { x: number; y: number }, above = false) => {
        const box = map.getContainer().getBoundingClientRect();
        const cursor = point
          ? { x: box.left + point.x, y: box.top + point.y }
          : { x: box.left + box.width / 2, y: box.top + 72 };
        const placed = placeReadableTip({
          cursor,
          bounds: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
          obstacles: chromeBoxes(),
          widths: [248, 200, 168],
          above,
          measure: (width) => {
            tip.style.width = `${width}px`;
            return { width: tip.offsetWidth || width, height: tip.offsetHeight || 72 };
          },
        });
        tip.style.left = `${placed.left}px`;
        tip.style.top = `${placed.top}px`;
        tip.style.width = `${placed.width}px`;
        tip.dataset.hidden = "0";
      };
      const showTip = (key: string, _lngLat: { lng: number; lat: number }, model: TipModel, point?: { x: number; y: number }, above = false) => {
        if (shownKey !== key) {
          shownKey = key;
          tip.innerHTML = tipHtml(model);
        }
        if (point) tipPoint = point;
        placeTip(point || tipPoint, above);
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
        const pointHit = hits.find((item) => !areaLayers.has(item.layer.id));
        const ringHit = hits.find((item) => RING_LAYER_IDS.includes(item.layer.id));
        const feature = pointHit || ringHit || hits[0];
        if (!feature) {
          hideTip();
          return;
        }
        const layer = feature.layer.id;
        map.getCanvas().style.cursor = areaLayers.has(layer) ? "" : "pointer";
        const props = (feature.properties || {}) as Record<string, unknown>;
        if (AREA_LAYER_IDS.includes(layer)) {
          clearDwell();
          shownKey = "";
          request += 1;
          tip.dataset.hidden = "1";
          const point = { x: event.point.x, y: event.point.y };
          const model = areaTip(props);
          const key = `${layer}:${String(props.id || "")}`;
          areaDwell = window.setTimeout(() => {
            showTip(key, event.lngLat, model, point, true);
          }, AREA_TIP_DWELL_MS);
          return;
        }
        clearDwell();
        if (layer === "clusters" || layer === "cluster-count" || layer === "clusters-halo") {
          const count = Number(props.point_count) || 0;
          showTip(`cluster:${props.cluster_id}`, event.lngLat, { title: clusterBubbleLabel(count), marks: [] }, event.point);
          return;
        }
        const model = layer === "focus-pin"
          ? (props.pin_kind === "deal" ? dealTip(props) : siteTip(props, props.pin_kind === "off"))
          : layer === "unscreened"
          ? { title: String(props.name || props.address || props.listing_id || "Listing"), marks: [{ swatch: "listing", label: "Listed, not yet screened" }] }
          : layer === "offmarket"
          ? siteTip(props, true)
          : layer === "sites"
            ? siteTip(props)
            : layer === "deals-pipe" || layer === "deals-land"
              ? dealTip(props)
              : layer === "depots"
                ? depotTip(props)
                : layer === "nearby-washes" || layer === "nearby-wash-labels"
                  ? washTip(props)
                  : RING_LAYER_IDS.includes(layer)
                    ? ringTip(props)
                    : areaTip(props);
        const key = `${layer}:${String(props.site_id || props.deal_id || props.id || "")}`;
        showTip(key, event.lngLat, model, event.point);
      });
      map.on("mouseout", hideTip);
      map.on("dragstart", hideTip);
      map.on("click", (event: MapMouseEvent) => {
        if (!propsRef.current.spaceDrawing && !measureRef.current && lotAt(event)) return;
        if (propsRef.current.spaceDrawing || event.originalEvent.defaultPrevented) return;
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
        paint("areas-current", "fill-opacity", 0.38);
        paint("areas-current-line", "line-color", AREA_PAINT.currentLine);
        paint("areas-current-line", "line-width", 2.4);
        paint("areas-launch", "fill-opacity", 0.46);
        paint("areas-launch-line", "line-color", AREA_PAINT.launchLine);
        paint("areas-launch-line", "line-width", 2.4);
        paint("areas-later", "line-color", AREA_PAINT.laterLine);
        paint("areas-later", "line-width", 2.4);
        paint("areas-priority", "fill-opacity", 0.4);
        paint("areas-priority-line", "line-color", AREA_PAINT.priorityLine);
        paint("areas-priority-line", "line-width", 2.2);
        paint("areas-future", "line-color", AREA_PAINT.futureLine);
        paint("areas-future", "line-width", 3.6);
        paint("area-labels", "text-color", "#3d3832");
        paint("area-labels", "text-halo-color", "#f6f3ec");
        paint("area-labels", "text-halo-width", 1.8);
        paint("depot-labels", "text-color", "#1d4e89");
        paint("depot-labels", "text-halo-color", "#fffdf8");
        paint("rings-5-case", "line-color", "#fffdf8");
        paint("rings-5-case", "line-width", 7);
        paint("rings-5", "line-color", "#1e4636");
        paint("rings-5", "line-width", 3.4);
        paint("rings-10-case", "line-color", "#fffdf8");
        paint("rings-10-case", "line-width", 6);
        paint("rings-10", "line-color", "#1d4e89");
        paint("rings-10", "line-width", 2.8);
      } else {
        paint("areas-current", "fill-opacity", phoneScreen ? 0.1 : 0.18);
        paint("areas-current-line", "line-color", AREA_PAINT.currentLineSatellite);
        paint("areas-current-line", "line-width", 2.6);
        paint("areas-launch", "fill-opacity", phoneScreen ? 0.22 : 0.32);
        paint("areas-launch-line", "line-color", AREA_PAINT.launchLineSatellite);
        paint("areas-launch-line", "line-width", 2.6);
        paint("areas-later", "line-color", AREA_PAINT.laterLineSatellite);
        paint("areas-later", "line-width", 2.2);
        paint("areas-priority", "fill-opacity", phoneScreen ? 0.16 : 0.24);
        paint("areas-priority-line", "line-color", AREA_PAINT.priorityLineSatellite);
        paint("areas-priority-line", "line-width", 2.2);
        paint("areas-future", "line-color", AREA_PAINT.futureLineSatellite);
        paint("areas-future", "line-width", 3.6);
        paint("rings-5-case", "line-color", "#1c1914");
        paint("rings-5-case", "line-width", 6.5);
        paint("rings-5", "line-color", "#f7f3ea");
        paint("rings-5", "line-width", 3.2);
        paint("rings-10-case", "line-color", "#1c1914");
        paint("rings-10-case", "line-width", 5.5);
        paint("rings-10", "line-color", "#f7e2a8");
        paint("rings-10", "line-width", 2.6);
        paint("area-labels", "text-color", "#f7f3ea");
        paint("area-labels", "text-halo-color", "#1c1914");
        paint("area-labels", "text-halo-width", 1.6);
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
        paint("clusters", "circle-color", "#1e4636");
        paint("clusters", "circle-stroke-color", "#fffdf8");
        paint("clusters", "circle-stroke-width", 3);
        paint("clusters-halo", "circle-color", "#1e4636");
        paint("clusters-halo", "circle-opacity", 0.28);
        paint("clusters-halo", "circle-stroke-color", "#1c1914");
        paint("clusters-halo", "circle-stroke-width", 2);
        paint("cluster-count", "text-color", "#fffdf8");
        paint("cluster-count", "text-halo-color", "#1e4636");
        paint("cluster-count", "text-halo-width", 1);
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
      map.on("moveend", (event) => {
        markZoomBand(map);
        const user = Boolean((event as { originalEvent?: Event }).originalEvent);
        propsRef.current.onBounds(map.getBounds(), { user });
      });
      applyClusterChrome(map);
      markZoomBand(map);
      propsRef.current.onBounds(map.getBounds(), { user: false });
    });
    const observed = node.current;
    const preserveView = Boolean(kept);
    const recenter = () => {
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
      if (preserveView || !map.isStyleLoaded()) return;
      map.resize();
      if (propsRef.current.spaceDrawing) return;
      const center = map.getCenter();
      const pad = pointPadding(map);
      const padded = Math.abs((map.getPadding().right ?? 0) - pad.right) < 1;
      const near = padded && Math.abs(center.lng - pin[0]) < 0.01 && Math.abs(center.lat - pin[1]) < 0.01 && map.getZoom() >= 13;
      if (!holdCamera.current && !near) map.jumpTo({ center: pin, zoom: 15, padding: pad });
    };
    observer = new ResizeObserver(() => {
      applyClusterChrome(map);
      map.resize();
    });
    observer.observe(observed);
    resizeTimer = window.setInterval(recenter, 250);
    resizeStop = window.setTimeout(() => window.clearInterval(resizeTimer), 12000);
    mapRef.current = map;
    (window as Window & { __sitesMap?: Map }).__sitesMap = map;
    if (!cancelled) setMapGeneration((value) => value + 1);
    };
    void boot();
    return () => {
      cancelled = true;
      window.clearInterval(resizeTimer);
      window.clearTimeout(resizeStop);
      window.clearTimeout(areaDwell);
      observer?.disconnect();
      if (active) {
        const center = active.getCenter();
        keptCamera.current = { center: [center.lng, center.lat], zoom: active.getZoom() };
      }
      tipEl?.remove();
      active?.remove();
      mapRef.current = null;
      if (active && (window as Window & { __sitesMap?: Map }).__sitesMap === active) delete (window as Window & { __sitesMap?: Map }).__sitesMap;
    };
    // Recreate the map when the basemap changes. Later effects push data in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.basemap]);

  const reviewFocusRef = useRef(props.reviewFocus);
  reviewFocusRef.current = props.reviewFocus;
  const focusToken = `${props.focusLng},${props.focusLat},${props.focusZoom}`;
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
      if (!map.getSource("sites") || !map.getSource("deals") || !map.getSource("offmarket") || !map.getSource("unscreened") || !map.getSource("pins") || !map.getSource("focus-pin")) {
        if (mapRef.current === map) map.once("idle", push);
        return;
      }
      if (preserveCamera.current !== undefined && preserveCamera.current !== props.preserveCamera) holdCamera.current = true;
      if (props.preserveCamera !== undefined) preserveCamera.current = props.preserveCamera;
      clusterLeaves.current.clear();
      const siteFeatures = props.sites.filter((feature) => feature.geometry).map((feature) => ({
        ...feature,
        properties: { ...feature.properties, pin_kind: "site" },
      }));
      const offFeatures = props.offMarket.filter((feature) => feature.geometry).map((feature) => ({
        ...feature,
        properties: { ...feature.properties, pin_kind: "off" },
      }));
      const dealFeatures = props.deals.filter((feature) => feature.geometry).map((feature) => ({
        ...feature,
        properties: { ...publicDeal(feature.properties), pin_kind: "deal" },
      }));
      (map.getSource("sites") as GeoJSONSource).setData({ type: "FeatureCollection", features: siteFeatures });
      (map.getSource("offmarket") as GeoJSONSource).setData({ type: "FeatureCollection", features: offFeatures });
      (map.getSource("deals") as GeoJSONSource).setData({ type: "FeatureCollection", features: dealFeatures });
      const groupedSelection = Boolean(props.reviewFocus) || (props.reviewMarkers || []).length > 0;
      const counted = countedPins({
        group: props.groupPins === "sites" ? "sites" : "deals",
        sites: siteFeatures,
        offMarket: offFeatures,
        deals: dealFeatures,
      });
      const split = takeSolo(counted, groupedSelection ? null : props.selectedId);
      (map.getSource("pins") as GeoJSONSource).setData({ type: "FeatureCollection", features: split.grouped });
      (map.getSource("focus-pin") as GeoJSONSource).setData({ type: "FeatureCollection", features: split.solo ? [split.solo] : [] });
      const shell = map.getContainer().closest(".stage-map");
      if (shell instanceof HTMLElement) {
        shell.dataset.solo = split.solo ? String(props.selectedId || "") : "";
        shell.dataset.groupCount = String(counted.length);
      }
      for (const id of ["clusters-halo", "clusters", "cluster-count", "pin-singles", "focus-ring", "focus-pin"]) {
        if (map.getLayer(id)) map.moveLayer(id);
      }
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
          minzoom: PIN_SPLIT_ZOOM,
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
        features: dealLabelFeatures(props.deals, props.pinLabel ?? "asking"),
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
          minzoom: PIN_SPLIT_ZOOM,
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
      (map.getSource("areas") as GeoJSONSource).setData({ type: "FeatureCollection", features: presentAreas(props.areas) });
      (map.getSource("depots") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.depots });
      (map.getSource("rings") as GeoJSONSource).setData({ type: "FeatureCollection", features: depotRingFeatures(props.depots) });
      const washSource = map.getSource("washes") as GeoJSONSource | undefined;
      const washData = {
        type: "FeatureCollection" as const,
        features: (props.washPoints || []).map((point) => ({
          type: "Feature" as const,
          properties: { id: point.id, name: point.name, miles: point.miles, band: point.band },
          geometry: { type: "Point" as const, coordinates: point.coordinates },
        })),
      };
      if (washSource) washSource.setData(washData);
      (map.getSource("parcels") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.parcels });
      (map.getSource("area-labels") as GeoJSONSource).setData({ type: "FeatureCollection", features: areaLabels(props.areas) });
      if (map.getLayer("parcels-selected")) {
        map.setFilter("parcels-selected", ["all", ["==", ["get", "site_id"], props.selectedId || ""], ["!=", ["get", "role"], "adjoining"]]);
      }
      if (map.getLayer("offmarket-selected")) map.setFilter("offmarket-selected", ["==", ["get", "site_id"], props.selectedId || ""]);
      if (map.getLayer("offmarket-halo")) map.setFilter("offmarket-halo", ["==", ["get", "site_id"], props.selectedId || ""]);
      map.setFilter("selected", ["==", ["get", "site_id"], props.selectedId || ""]);
      if (map.getLayer("selected-halo")) map.setFilter("selected-halo", ["==", ["get", "site_id"], props.selectedId || ""]);
      if (map.getLayer("deal-halo")) map.setFilter("deal-halo", ["==", ["get", "deal_id"], props.selectedId || ""]);
      if (map.getLayer("deal-ring")) map.setFilter("deal-ring", ["==", ["get", "deal_id"], props.selectedId || ""]);
      if (map.getLayer("unscreened-selected")) map.setFilter("unscreened-selected", ["==", ["get", "listing_id"], props.selectedId || ""]);
      map.resize();
      const phone = window.matchMedia("(max-width: 767px)").matches;
      const reviewing = Boolean(props.reviewFocus) || (props.reviewMarkers || []).length > 0;
      const drawing = Boolean(propsRef.current.spaceDrawing);
      const phonePad = phone && !reviewing && !drawing;
      const padKey = phonePad ? "clear" : "flush";
      map.setPadding(phonePad ? { top: 176, bottom: 168, left: 16, right: 20 } : pointPadding(map));
      const drawFly = propsRef.current.spaceFly;
      if (drawing && drawFly && map.getZoom() < 17) {
        map.jumpTo({ center: [drawFly.lng, drawFly.lat], zoom: 18, padding: pointPadding(map) });
      }
      if ((props.basemap || "satellite") === "satellite") {
        if (map.getLayer("areas-current")) map.setPaintProperty("areas-current", "fill-opacity", phone ? 0.1 : 0.18);
        if (map.getLayer("areas-launch")) map.setPaintProperty("areas-launch", "fill-opacity", phone ? 0.22 : 0.32);
        if (map.getLayer("areas-priority")) map.setPaintProperty("areas-priority", "fill-opacity", phone ? 0.16 : 0.24);
      }
      const clearedSelection = Boolean(sawSelection.current) && !props.selectedId;
      if (props.selectedId) sawSelection.current = props.selectedId;
      else if (clearedSelection) holdCamera.current = true;
      const finiteFit = (props.fitPoints || []).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
      const fitKey = finiteFit.map((point) => point.join(",")).join("|");
      if (!props.fitAll && String(appliedFit.current).startsWith("all:")) appliedFit.current = "";
      if (reviewToken) {
        appliedReview.current = reviewToken;
        appliedPad.current = "flush";
      } else if (freezeCamera.current) {
        freezeCamera.current = false;
        const held = heldView.current;
        heldView.current = null;
        if (held) map.jumpTo({ center: held.center, zoom: held.zoom });
        appliedFit.current = props.fitAll ? `all:${fitKey}:${padKey}` : fitKey;
        appliedPad.current = padKey;
        appliedFocus.current = focusToken;
      } else if (!holdCamera.current && !propsRef.current.spaceDrawing && !props.selectedId && props.fitAll && fitKey && appliedFit.current !== `all:${fitKey}:${padKey}`) {
        appliedFit.current = `all:${fitKey}:${padKey}`;
        appliedPad.current = padKey;
        appliedFocus.current = focusToken;
        if (!frameSites(map, finiteFit, phone)) glide(map, [props.focusLng, props.focusLat], props.focusZoom);
      } else if (!holdCamera.current && !props.fitAll && !propsRef.current.spaceDrawing && !props.selectedId && phone && fitKey && (appliedFit.current !== fitKey || appliedPad.current !== padKey)) {
        appliedFit.current = fitKey;
        appliedPad.current = padKey;
        appliedFocus.current = focusToken;
        const lngs = finiteFit.map((point) => point[0]);
        const lats = finiteFit.map((point) => point[1]);
        fitMap(
          map,
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 176, bottom: 168, left: 72, right: 36 }, maxZoom: 12.4, duration: 0 },
        );
      } else if (!holdCamera.current && !props.fitAll && !propsRef.current.spaceDrawing && !props.selectedId && appliedFocus.current !== focusToken) {
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
  }, [mapGeneration, props.sites, props.deals, props.areas, props.depots, props.parcels, props.offMarket, props.unscreened, props.selectedId, props.groupPins, props.pinLabel, props.fitPoints, props.fitAll, props.preserveCamera, props.overlayPoints, props.washPoints, props.gridFeatures, props.queueIds, focusToken, reviewToken, props.focusLng, props.focusLat, props.focusZoom, props.reviewFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const vis = (id: string, on: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      };
      for (const id of AREA_LAYER_IDS) vis(id, props.showAreas);
      const depotsOn = props.showDepots || props.showRings;
      vis("depots", depotsOn);
      vis("depot-labels", depotsOn);
      for (const id of RING_LAYER_IDS) vis(id, props.showRings);
      vis("sites", props.showSites);
      vis("clusters", true);
      vis("clusters-halo", true);
      vis("cluster-count", true);
      vis("focus-pin", true);
      vis("focus-ring", true);
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
  }, [mapGeneration, props.showAreas, props.showDepots, props.showRings, props.showSites]);

  function viewBox(map: Map): LngLatBounds {
    const bounds = map.getBounds();
    return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
  }

  function frameRingView() {
    const map = mapRef.current;
    if (!map || freezeCamera.current) return;
    const center = map.getCenter();
    const coords = ringFrameCoordinates(propsRef.current.depots, [center.lng, center.lat], viewBox(map));
    if (coords.length < 2) return;
    const lngs = coords.map((point) => point[0]);
    const lats = coords.map((point) => point[1]);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    fitMap(
      map,
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: { top: 72, bottom: 96, left: 48, right: 72 }, maxZoom: 12.2, duration: reduce ? 0 : 450 },
    );
  }

  useEffect(() => {
    propsRef.current.registerFrameRings?.(frameRingView);
    return () => propsRef.current.registerFrameRings?.(null);
  }, [mapGeneration]);

  const ringsWereOn = useRef<boolean | null>(null);
  const ringsOutside = useRef<boolean | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancel = false;
    const publish = (outside: boolean) => {
      if (ringsOutside.current === outside) return;
      ringsOutside.current = outside;
      propsRef.current.onRingsOutside?.(outside);
    };
    const check = () => {
      if (cancel || mapRef.current !== map) return;
      const on = propsRef.current.showRings;
      if (!on) {
        ringsWereOn.current = false;
        publish(false);
        return;
      }
      if (!map.isStyleLoaded() || !propsRef.current.depots.length) return;
      const meets = ringStrokeMeets(propsRef.current.depots, viewBox(map));
      const previous = ringsWereOn.current;
      ringsWereOn.current = true;
      publish(!meets);
      if (previous === false && !meets && !freezeCamera.current) frameRingView();
    };
    map.on("moveend", check);
    map.on("idle", check);
    if (map.isStyleLoaded()) check();
    else map.once("idle", check);
    return () => {
      cancel = true;
      map.off("moveend", check);
      map.off("idle", check);
    };
  }, [mapGeneration, props.showRings, props.depots]);

  const selectedOnMap =
    props.sites.some((feature) => feature.properties.site_id === props.selectedId) ||
    props.offMarket.some((feature) => feature.properties.site_id === props.selectedId) ||
    props.deals.some((feature) => feature.properties.deal_id === props.selectedId);
  const gridToken = (props.gridFeatures || []).map((feature) => String(feature.properties?.deal_id || feature.properties?.site_id || "")).join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (skipViewReset.current || freezeCamera.current) {
      skipViewReset.current = false;
      const id = props.selectedId;
      const deal = id ? propsRef.current.deals.find((feature) => feature.properties.deal_id === id) : undefined;
      const site = id ? propsRef.current.sites.find((feature) => feature.properties.site_id === id) : undefined;
      const off = id ? propsRef.current.offMarket.find((feature) => feature.properties.site_id === id) : undefined;
      const geometry = deal?.geometry || site?.geometry || off?.geometry;
      if (id && geometry?.type === "Point") {
        const pin = geometry.coordinates as [number, number];
        if (Number.isFinite(pin[0]) && Number.isFinite(pin[1])) markCentered(map, id, pin[0], pin[1]);
      }
      return;
    }
    let cancel = false;
    const go = () => {
      if (cancel || reviewFocusRef.current) return;
      if (propsRef.current.spaceDrawing && propsRef.current.spaceFly) {
        const fly = propsRef.current.spaceFly;
        map.jumpTo({ center: [fly.lng, fly.lat], zoom: 18, padding: pointPadding(map) });
        return;
      }
      if (!props.selectedId) {
        if (props.fitAll || holdCamera.current) return;
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
    if (props.spaceDrawing && props.spaceFly) {
      map.jumpTo({ center: [props.spaceFly.lng, props.spaceFly.lat], zoom: 18, padding: pointPadding(map) });
      return;
    }
    if (props.selectedId && !selectedOnMap) {
      glide(map, [props.focusLng, props.focusLat], props.focusZoom);
      return;
    }
    go();
    if (props.selectedId) map.once("idle", go);
    return () => {
      cancel = true;
      map.off("idle", go);
    };
  }, [mapGeneration, props.selectedId, selectedOnMap, props.focusLng, props.focusLat, props.focusZoom, props.fitAll, props.spaceDrawing, props.spaceFly, props.reviewFocus, gridToken]);

  useEffect(() => {
    const map = mapRef.current;
    const focus = props.reviewFocus;
    if (!map || !focus) return;
    let cancel = false;
    const go = () => {
      if (cancel || !mapRef.current) return;
      const pad = pointPadding(map);
      const center = map.getCenter();
      const padded = Math.abs((map.getPadding().right ?? 0) - pad.right) < 1;
      const near = padded && Math.abs(map.getZoom() - focus.zoom) < 0.4
        && Math.abs(center.lng - focus.lng) < 0.02
        && Math.abs(center.lat - focus.lat) < 0.02;
      markCentered(map, propsRef.current.selectedId || "", focus.lng, focus.lat);
      if (!near) map.jumpTo({ center: [focus.lng, focus.lat], zoom: focus.zoom, padding: pad });
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
      set("clusters-halo", "circle-opacity", dimmed ? 0.08 : 0.22);
      set("cluster-count", "text-opacity", dimmed ? 0.3 : 1);
      set("focus-pin", "icon-opacity", dimmed ? 0 : 1);
      set("focus-ring", "circle-opacity", dimmed ? 0 : 1);
      set("focus-ring", "circle-stroke-opacity", dimmed ? 0 : 1);
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

  function sendDraw(type: "undo" | "cancel" | "finish") {
    drawSeq.current += 1;
    setDrawCommand({ id: drawSeq.current, type });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      if (propsRef.current.spaceDrawing) {
        event.preventDefault();
        sendDraw("cancel");
        return;
      }
      if (measureRef.current) setMeasure(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const fly = props.spaceFly;
    if (!map || !fly) return;
    const go = () => {
      try {
        map.jumpTo({ center: [fly.lng, fly.lat], zoom: 18, padding: pointPadding(map) });
      } catch {
        // The style is still settling. The load listener below retries.
      }
    };
    go();
    map.on("load", go);
    return () => {
      map.off("load", go);
    };
  }, [mapGeneration, props.spaceFly]);

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
      <div className={`stage-map${mapFailed ? " map-unavailable" : ""}`} data-basemap={props.basemap || "satellite"}>
      <div ref={node} className="map" />
      {mapGeneration && mapRef.current ? (
        <SpaceTools
          map={mapRef.current}
          spaces={props.spaceShapes || []}
          visible={props.showSpaces !== false}
          drawing={Boolean(props.spaceDrawing)}
          selectedId={props.selectedSpaceId || ""}
          names={props.spaceNames || {}}
          commentedIds={props.commentedSpaceIds || []}
          threadOpen={Boolean(props.threadSpaceId) && props.threadSpaceId === props.selectedSpaceId}
          onThreadClose={props.onThreadClose}
          onSelect={(id) => props.onSpaceSelect?.(id)}
          onCreate={(box) => props.onSpaceCreate?.(box)}
          onChange={(space) => props.onSpaceChange?.(space)}
          onDelete={(space) => props.onSpaceDelete?.(space)}
          onCloseDraw={() => props.onSpaceDone?.()}
          drawCommand={drawCommand}
          onDraftPoints={setDraftPoints}
          requestDelete={deleteAsk}
        />
      ) : null}
      {mapFailed ? (
        <div className="map-empty" role="status" data-testid="map-error">
          <p>{mapFailed}</p>
          {props.onShowList ? <button type="button" className="paper-btn" data-testid="map-switch-list" onClick={props.onShowList}>Switch to list</button> : null}
        </div>
      ) : null}
      <div className="map-float">
        <div className="segmented map-basemap only-desktop" role="group" aria-label="Basemap" data-testid="basemap-desktop">
          <button type="button" className={`segmented ${(props.basemap || "satellite") === "satellite" ? "on" : ""}`} onClick={() => props.onBasemap?.("satellite")}>Satellite</button>
          <button type="button" className={`segmented ${(props.basemap || "satellite") === "positron" ? "on" : ""}`} onClick={() => props.onBasemap?.("positron")}>Map</button>
        </div>
        <div className="measure-row">
          {props.spaceDrawing ? (
            <div className="measure-bar" data-testid="space-draw-bar" role="toolbar" aria-label="Draw a lot">
              <button type="button" className="paper-btn" data-testid="space-undo" onClick={() => sendDraw("undo")} disabled={draftPoints < 1}>Undo point</button>
              <button type="button" className="paper-btn" data-testid="space-cancel" onClick={() => sendDraw("cancel")}>Cancel</button>
              <button type="button" className="primary" data-testid="space-finish" onClick={() => sendDraw("finish")}>Finish</button>
              {props.selectedSpaceId ? <button type="button" className="paper-btn" data-testid="space-draw-delete" onClick={() => setDeleteAsk((value) => value + 1)}>Delete</button> : null}
            </div>
          ) : props.canDrawLots ? (
            <button type="button" className="primary" data-testid="mark-space" title="Outline open land or parking a charger could use." onClick={() => props.onDrawLots?.()}>Draw available lots</button>
          ) : null}
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
