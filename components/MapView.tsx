"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map, NavigationControl, Popup, setWorkerUrl, type MapLayerMouseEvent, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { areaTip, clusterTip, dealTip, depotTip, siteTip, tipHtml, type TipModel } from "@/lib/markerTip";
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
  onSelect: (id: string) => void;
  onBounds: (bounds: { contains: (lnglat: [number, number]) => boolean }) => void;
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
  const measureRef = useRef(false);
  measureRef.current = measure;
  const [readout, setReadout] = useState("");
  const points = useRef<[number, number][]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!node.current || mapRef.current) return;
    setWorkerUrl("/maplibre-gl-worker.js");
    const map = new Map({
      container: node.current,
      style: {
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
          { id: "areas-op", type: "fill", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "fill-color": "#b7f0c8", "fill-opacity": 0.14 } },
          { id: "areas-op-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "line-color": "#f4fff7", "line-width": 2.4 } },
          { id: "area-labels", type: "symbol", source: "area-labels", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-allow-overlap": true }, paint: { "text-color": "#f7f3ea", "text-halo-color": "#1c1914", "text-halo-width": 1.2 } },
          { id: "parcels-line", type: "line", source: "parcels", minzoom: 14, filter: ["!=", ["get", "role"], "adjoining"], paint: { "line-color": "#f7f3ea", "line-width": 1.1 } },
          { id: "parcels-adjoining", type: "line", source: "parcels", minzoom: 14, filter: ["==", ["get", "role"], "adjoining"], paint: { "line-color": "#8eb7ff", "line-width": 1.4 } },
          { id: "parcels-selected", type: "line", source: "parcels", minzoom: 14, filter: ["all", ["==", ["get", "site_id"], ""], ["!=", ["get", "role"], "adjoining"]], paint: { "line-color": "#ffb4a8", "line-width": 2.6 } },
          {
            id: "missing-parcel",
            type: "circle",
            source: "sites",
            minzoom: 14,
            filter: ["==", ["get", "parcel_match"], "none"],
            paint: { "circle-radius": 13, "circle-color": "transparent", "circle-stroke-color": "#e0a100", "circle-stroke-width": 2 },
          },
          {
            id: "missing-parcel-deals",
            type: "circle",
            source: "deals",
            minzoom: 14,
            filter: ["==", ["get", "parcel_match"], "none"],
            paint: { "circle-radius": 14, "circle-color": "transparent", "circle-stroke-color": "#e0a100", "circle-stroke-width": 2 },
          },
          {
            id: "offmarket",
            type: "circle",
            source: "offmarket",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 8],
              "circle-color": "#5c4d8a",
              "circle-stroke-color": "#f4efe6",
              "circle-stroke-width": 2,
            },
          },
          {
            id: "offmarket-selected",
            type: "circle",
            source: "offmarket",
            filter: ["==", ["get", "site_id"], ""],
            paint: { "circle-radius": 11, "circle-color": "transparent", "circle-stroke-color": "#faf7f1", "circle-stroke-width": 3 },
          },
          {
            id: "clusters",
            type: "circle",
            source: "sites",
            filter: ["has", "point_count"],
            paint: { "circle-color": "#1d4e89", "circle-radius": ["step", ["get", "point_count"], 16, 20, 20, 80, 26], "circle-stroke-color": "#faf7f1", "circle-stroke-width": 2, "circle-opacity": 0.92 },
          },
          {
            id: "cluster-count",
            type: "symbol",
            source: "sites",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
            paint: { "text-color": "#faf7f1" },
          },
          {
            id: "tier-large-halo",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "land_tier"], "L10"]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 14, 12, 20, 15, 28],
              "circle-color": "transparent",
              "circle-stroke-color": "#f4f7fb",
              "circle-stroke-width": 6,
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
              "circle-stroke-color": "#3e4d60",
              "circle-stroke-width": 2.6,
            },
          },
          {
            id: "tier-small-halo",
            type: "circle",
            source: "sites",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "land_tier"], "L4"]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 11, 15, 14],
              "circle-color": "transparent",
              "circle-stroke-color": "#f4f7fb",
              "circle-stroke-width": 5,
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
              "circle-stroke-color": "#3e4d60",
              "circle-stroke-width": 2.2,
            },
          },
          {
            id: "sites",
            type: "circle",
            source: "sites",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 12, 7, 15, 10],
              "circle-color": [
                "case",
                ["all", ["==", ["get", "verdict"], "PASS"], ["==", ["get", "network_status"], "held"]], "#2f6f9f",
                ["==", ["get", "verdict"], "PASS"], "#1f7a4d",
                ["==", ["get", "verdict"], "MAYBE"], "#c4841d",
                ["==", ["get", "verdict"], "UNRESOLVED"], "#b85c38",
                ["==", ["get", "verdict"], "FAIL"], "#7a2e28",
                ["==", ["get", "verdict"], "NOT_A_WASH"], "#5c574f",
                "#f4efe6",
              ],
              "circle-stroke-color": "#1c1914",
              "circle-stroke-width": ["case", ["==", ["get", "verdict"], "UNRESOLVED"], 3, ["!", ["has", "verdict"]], 1.6, 1.2],
              "circle-opacity": 0.95,
            },
          },
          {
            id: "selected",
            type: "circle",
            source: "sites",
            filter: ["==", ["get", "site_id"], ""],
            paint: { "circle-radius": 11, "circle-color": "transparent", "circle-stroke-color": "#faf7f1", "circle-stroke-width": 3 },
          },
          {
            id: "linked",
            type: "circle",
            source: "sites",
            filter: ["all", ["has", "linked_deal_id"], ["!=", ["get", "linked_deal_id"], ""]],
            paint: { "circle-radius": 11, "circle-color": "transparent", "circle-stroke-color": "#f7f3ea", "circle-stroke-width": 2 },
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
            layout: { "icon-image": "tri-land", "icon-size": 0.95, "icon-allow-overlap": true },
          },
          {
            id: "depots",
            type: "symbol",
            source: "depots",
            layout: { "icon-image": "depot", "icon-size": 1, "icon-allow-overlap": true },
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
      },
      center: [props.focusLng, props.focusLat],
      zoom: props.focusZoom,
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const size = 36;
    const image = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = Math.abs(x - 17.5) / 15;
        const dy = Math.abs(y - 17.5) / 15;
        const diamond = dx + dy;
        if (diamond <= 1) {
          const i = (y * size + x) * 4;
          const edge = diamond > 0.72;
          image[i] = edge ? 29 : 244;
          image[i + 1] = edge ? 78 : 239;
          image[i + 2] = edge ? 137 : 230;
          image[i + 3] = 255;
        }
      }
    }
    const square = (rgb: [number, number, number]) => {
      const pixels = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (x < 5 || y < 5 || x > 30 || y > 30) continue;
          const i = (y * size + x) * 4;
          const edge = x < 8 || y < 8 || x > 27 || y > 27;
          pixels[i] = edge ? 28 : rgb[0];
          pixels[i + 1] = edge ? 25 : rgb[1];
          pixels[i + 2] = edge ? 20 : rgb[2];
          pixels[i + 3] = 255;
        }
      }
      return pixels;
    };
    const triangle = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = (x - 17.5) / 16;
        const ny = (y - 28) / 26;
        if (ny <= 0 && Math.abs(nx) <= -ny * 0.55) {
          const i = (y * size + x) * 4;
          const edge = ny > -0.18;
          triangle[i] = edge ? 28 : 91;
          triangle[i + 1] = edge ? 25 : 61;
          triangle[i + 2] = edge ? 20 : 138;
          triangle[i + 3] = 255;
        }
      }
    }
    map.on("load", () => {
      map.resize();
      requestAnimationFrame(() => map.resize());
      if (!map.hasImage("depot")) map.addImage("depot", { width: size, height: size, data: image });
      const squares: Record<string, [number, number, number]> = {
        sourced: [36, 88, 166],
        desk: [196, 132, 29],
        financial: [31, 122, 77],
        checks: [47, 111, 138],
        close: [107, 76, 154],
        contacted: [31, 122, 77],
        later: [107, 76, 154],
        dropped: [122, 46, 40],
      };
      for (const [name, rgb] of Object.entries(squares)) {
        const id = `sq-${name}`;
        if (!map.hasImage(id)) map.addImage(id, { width: size, height: size, data: square(rgb) });
      }
      node.current?.setAttribute("data-deal-markers", "square");
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
      map.on("moveend", () => propsRef.current.onBounds(map.getBounds()));
      propsRef.current.onBounds(map.getBounds());
    });
    const observed = node.current;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(observed);
    mapRef.current = map;
    (window as Window & { __sitesMap?: Map }).__sitesMap = map;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      if ((window as Window & { __sitesMap?: Map }).__sitesMap === map) delete (window as Window & { __sitesMap?: Map }).__sitesMap;
    };
    // The map is created once. Later effects push data in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reviewFocusRef = useRef(props.reviewFocus);
  reviewFocusRef.current = props.reviewFocus;
  const focusToken = `${props.focusLng},${props.focusLat},${props.focusZoom}`;
  const reviewToken = props.reviewFocus ? `${props.reviewFocus.lng},${props.reviewFocus.lat},${props.reviewFocus.zoom}` : "";
  const appliedFocus = useRef("");
  const appliedReview = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancel = false;
    const push = () => {
      if (cancel) return;
      clusterLeaves.current.clear();
      (map.getSource("sites") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.sites.filter((f) => f.geometry) });
      (map.getSource("offmarket") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.offMarket.filter((f) => f.geometry) });
      (map.getSource("deals") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.deals.filter((f) => f.geometry) });
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
      map.setFilter("selected", ["==", ["get", "site_id"], props.selectedId || ""]);
      if (map.getLayer("unscreened-selected")) map.setFilter("unscreened-selected", ["==", ["get", "listing_id"], props.selectedId || ""]);
      map.resize();
      if (reviewToken) {
        appliedReview.current = reviewToken;
      } else if (appliedFocus.current !== focusToken) {
        appliedFocus.current = focusToken;
        appliedReview.current = "";
        map.jumpTo({ center: [props.focusLng, props.focusLat], zoom: props.focusZoom });
      }
    };
    if (map.isStyleLoaded()) push();
    else map.once("load", push);
    return () => {
      cancel = true;
      map.off("load", push);
    };
  }, [props.sites, props.deals, props.areas, props.depots, props.parcels, props.offMarket, props.unscreened, props.selectedId, focusToken, reviewToken, props.focusLng, props.focusLat, props.focusZoom, props.reviewFocus]);

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
      vis("cluster-count", props.showSites);
      vis("tier-large", props.showSites);
      vis("tier-large-halo", props.showSites);
      vis("tier-small", props.showSites);
      vis("tier-small-halo", props.showSites);
      vis("linked", props.showSites);
      vis("selected", props.showSites);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [props.showAreas, props.showDepots, props.showSites]);

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
        map.jumpTo({ center: [props.focusLng, props.focusLat], zoom: props.focusZoom });
        return;
      }
      const site = propsRef.current.sites.find((feature) => feature.properties.site_id === props.selectedId);
      const off = propsRef.current.offMarket.find((feature) => feature.properties.site_id === props.selectedId);
      const deal = propsRef.current.deals.find((feature) => feature.properties.deal_id === props.selectedId);
      const geometry = site?.geometry || off?.geometry || deal?.geometry;
      if (!geometry) return;
      map.jumpTo({ center: geometry.coordinates, zoom: 16 });
    };
    if (props.reviewFocus) return;
    if (props.selectedId && !selectedOnMap) return;
    go();
    if (props.selectedId) map.once("idle", go);
    return () => {
      cancel = true;
      map.off("idle", go);
    };
  }, [props.selectedId, selectedOnMap, props.focusLng, props.focusLat, props.focusZoom, props.reviewFocus]);

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
  }, [reviewToken, props.reviewFocus]);

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
      set("sites", "circle-opacity", dimmed ? 0.3 : 0.95);
      set("offmarket", "circle-opacity", dimmed ? 0.3 : 1);
      set("clusters", "circle-opacity", dimmed ? 0.3 : 0.88);
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
  }, [props.reviewMarkers]);

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
  }, [props.reviewMarkers]);

  return (
    <div className="stage-map">
      <div ref={node} className="map" />
      <div className="map-tools">
        <button className={measure ? "on" : ""} type="button" onClick={() => { setMeasure((value) => !value); points.current = []; setReadout(""); }}>
          Measure acres
        </button>
        {readout ? <span className="map-readout">{readout}</span> : null}
      </div>
      <div className="map-attrib">Powered by Esri · Earthstar Geographics, Maxar</div>
    </div>
  );
}
