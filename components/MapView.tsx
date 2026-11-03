"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map, NavigationControl, Popup, setWorkerUrl, type MapLayerMouseEvent, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DealFeature, GeoFeature, SiteFeature } from "@/lib/types";

type Props = {
  sites: SiteFeature[];
  deals: DealFeature[];
  areas: GeoFeature[];
  depots: GeoFeature[];
  parcels: GeoFeature[];
  selectedId: string | null;
  showAreas: boolean;
  showDepots: boolean;
  showSites: boolean;
  focusLng: number;
  focusLat: number;
  focusZoom: number;
  onSelect: (id: string) => void;
  onBounds: (bounds: { contains: (lnglat: [number, number]) => boolean }) => void;
};

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

export default function MapView(props: Props) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
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
          sites: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          deals: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          depots: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          measure: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "imagery", type: "raster", source: "imagery" },
          { id: "labels", type: "raster", source: "labels", layout: { visibility: "none" } },
          { id: "areas-op", type: "fill", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "fill-color": "#7dffa8", "fill-opacity": 0.16 } },
          { id: "areas-op-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "line-color": "#e9fff1", "line-width": 2.5 } },
          { id: "expansion-fill", type: "fill", source: "areas", filter: ["==", ["get", "group"], "expansion"], paint: { "fill-color": "#9bb7d4", "fill-opacity": 0.06 } },
          { id: "expansion-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "expansion"], paint: { "line-color": "#e7f1fb", "line-dasharray": [1.2, 1.2], "line-width": 2, "line-opacity": 0.9 } },
          { id: "parcels", type: "fill", source: "parcels", paint: { "fill-color": "#ffd0c8", "fill-opacity": 0.35 } },
          { id: "parcels-line", type: "line", source: "parcels", paint: { "line-color": "#fff7f4", "line-width": 3 } },
          { id: "parcels-line-inner", type: "line", source: "parcels", paint: { "line-color": "#8d3b32", "line-width": 1.5 } },
          {
            id: "sites",
            type: "circle",
            source: "sites",
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
            layout: {
              "text-field": ["get", "id"],
              "text-font": ["Noto Sans Regular"],
              "text-size": 11,
              "text-offset": [0, 1.15],
              "text-anchor": "top",
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#f7f3ea", "text-halo-color": "#1c1914", "text-halo-width": 1.2 },
          },
          { id: "measure", type: "line", source: "measure", paint: { "line-color": "#f4efe6", "line-width": 2 } },
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
      if (!map.hasImage("depot")) map.addImage("depot", { width: size, height: size, data: image });
      const squares: Record<string, [number, number, number]> = {
        sourced: [36, 88, 166],
        desk: [196, 132, 29],
        contacted: [31, 122, 77],
        later: [107, 76, 154],
        dropped: [122, 46, 40],
      };
      for (const [name, rgb] of Object.entries(squares)) {
        const id = `sq-${name}`;
        if (!map.hasImage(id)) map.addImage(id, { width: size, height: size, data: square(rgb) });
      }
      if (!map.hasImage("tri-land")) map.addImage("tri-land", { width: size, height: size, data: triangle });
      map.on("click", "sites", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const feature = event.features?.[0];
        const id = feature?.properties?.site_id;
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
      map.on("click", "depots", (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const address = feature?.properties?.address || "Depot";
        const status = feature?.properties?.status || "operating";
        const confidence = feature?.properties?.confidence || "";
        new Popup({ closeButton: false })
          .setLngLat(event.lngLat)
          .setHTML(`<strong>Depot</strong><br>${address}<br>${status}${confidence ? ` · ${confidence}` : ""}`)
          .addTo(map);
      });
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
      map.on("mouseenter", "sites", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "sites", () => { map.getCanvas().style.cursor = ""; });
      map.on("moveend", () => propsRef.current.onBounds(map.getBounds()));
      propsRef.current.onBounds(map.getBounds());
    });
    const observed = node.current;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(observed);
    mapRef.current = map;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map is created once. Later effects push data in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusToken = `${props.focusLng},${props.focusLat},${props.focusZoom}`;
  const appliedFocus = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const push = () => {
      (map.getSource("sites") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.sites.filter((f) => f.geometry) });
      (map.getSource("deals") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.deals.filter((f) => f.geometry) });
      (map.getSource("areas") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.areas });
      (map.getSource("depots") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.depots });
      const parcel = props.parcels.filter((feature) => feature.properties.site_id === props.selectedId);
      (map.getSource("parcels") as GeoJSONSource).setData({ type: "FeatureCollection", features: parcel });
      map.setFilter("selected", ["==", ["get", "site_id"], props.selectedId || ""]);
      if (appliedFocus.current !== focusToken) {
        appliedFocus.current = focusToken;
        map.jumpTo({ center: [props.focusLng, props.focusLat], zoom: props.focusZoom });
      }
    };
    if (map.isStyleLoaded()) push();
    else map.once("load", push);
  }, [props.sites, props.deals, props.areas, props.depots, props.parcels, props.selectedId, focusToken, props.focusLng, props.focusLat, props.focusZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const vis = (id: string, on: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      };
      vis("areas-op", props.showAreas);
      vis("areas-op-line", props.showAreas);
      vis("expansion-fill", props.showAreas);
      vis("expansion-line", props.showAreas);
      vis("depots", props.showDepots);
      vis("depot-labels", props.showDepots);
      vis("sites", props.showSites);
      vis("linked", props.showSites);
      vis("selected", props.showSites);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [props.showAreas, props.showDepots, props.showSites]);

  const selectedOnMap =
    props.sites.some((feature) => feature.properties.site_id === props.selectedId) ||
    props.deals.some((feature) => feature.properties.deal_id === props.selectedId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancel = false;
    const go = () => {
      if (cancel) return;
      if (!props.selectedId) {
        map.jumpTo({ center: [props.focusLng, props.focusLat], zoom: props.focusZoom });
        return;
      }
      const site = propsRef.current.sites.find((feature) => feature.properties.site_id === props.selectedId);
      const deal = propsRef.current.deals.find((feature) => feature.properties.deal_id === props.selectedId);
      const geometry = site?.geometry || deal?.geometry;
      if (!geometry) return;
      map.jumpTo({ center: geometry.coordinates, zoom: 16 });
    };
    if (props.selectedId && !selectedOnMap) return;
    go();
    if (props.selectedId) map.once("idle", go);
    return () => {
      cancel = true;
    };
  }, [props.selectedId, selectedOnMap, props.focusLng, props.focusLat, props.focusZoom]);

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
