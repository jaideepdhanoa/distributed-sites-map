"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map, NavigationControl, Popup, setWorkerUrl, type MapLayerMouseEvent, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoFeature, SiteFeature } from "@/lib/types";

type Props = {
  sites: SiteFeature[];
  areas: GeoFeature[];
  depots: GeoFeature[];
  parcels: GeoFeature[];
  selectedId: string | null;
  showExpansion: boolean;
  showLabels: boolean;
  showRings: boolean;
  onSelect: (id: string) => void;
  onBounds: (bounds: { contains: (lnglat: [number, number]) => boolean }) => void;
};

function circle(lon: number, lat: number, miles: number) {
  const coords: [number, number][] = [];
  const radius = miles / 3958.8;
  for (let i = 0; i <= 64; i += 1) {
    const bearing = (2 * Math.PI * i) / 64;
    const lat1 = (lat * Math.PI) / 180;
    const lon1 = (lon * Math.PI) / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(radius) + Math.cos(lat1) * Math.sin(radius) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(radius) * Math.cos(lat1), Math.cos(radius) - Math.sin(lat1) * Math.sin(lat2));
    coords.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return coords;
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
          depots: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          rings: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          measure: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "imagery", type: "raster", source: "imagery" },
          { id: "labels", type: "raster", source: "labels", layout: { visibility: "none" } },
          { id: "areas-fill", type: "fill", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "fill-color": "#1e4636", "fill-opacity": 0.14 } },
          { id: "areas-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "service"], paint: { "line-color": "#1e4636", "line-width": 1.2 } },
          { id: "expansion-fill", type: "fill", source: "areas", filter: ["==", ["get", "group"], "expansion"], layout: { visibility: "none" }, paint: { "fill-color": "#1d4e89", "fill-opacity": 0.08 } },
          { id: "expansion-line", type: "line", source: "areas", filter: ["==", ["get", "group"], "expansion"], layout: { visibility: "none" }, paint: { "line-color": "#1d4e89", "line-dasharray": [2, 1.5], "line-width": 1.4 } },
          { id: "future", type: "line", source: "areas", filter: ["==", ["get", "group"], "future"], layout: { visibility: "none" }, paint: { "line-color": "#6d655b", "line-dasharray": [1, 1] } },
          { id: "rings", type: "line", source: "rings", layout: { visibility: "none" }, paint: { "line-color": "#f4efe6", "line-width": 1, "line-opacity": 0.8 } },
          { id: "parcels", type: "fill", source: "parcels", paint: { "fill-color": "#8d3b32", "fill-opacity": 0.25 } },
          { id: "parcels-line", type: "line", source: "parcels", paint: { "line-color": "#8d3b32", "line-width": 2 } },
          {
            id: "sites",
            type: "circle",
            source: "sites",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 12, 7],
              "circle-color": [
                "case",
                ["==", ["get", "land_tier"], "L10"], "#1f6b45",
                ["==", ["get", "land_tier"], "L4"], "#c4841d",
                ["==", ["get", "verdict"], "NOT_A_WASH"], "#8a847c",
                ["==", ["get", "verdict"], "FAIL"], "#9c3b32",
                ["==", ["get", "in_area"], true], "#4d625c",
                "#d5cec2",
              ],
              "circle-stroke-color": [
                "case",
                ["==", ["get", "network_status"], "held"], "#1d4e89",
                ["==", ["get", "verification"], "aerial only, pending verification"], "#f4efe6",
                "#1c1914",
              ],
              "circle-stroke-width": ["case", ["==", ["get", "site_id"], ""], 1, 1.4],
              "circle-opacity": 0.92,
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
            id: "depots",
            type: "circle",
            source: "depots",
            paint: {
              "circle-radius": 7,
              "circle-color": [
                "match", ["get", "status"],
                "planned", "#5c6b7a",
                "candidate", "#8d6a2f",
                "#1d4e89",
              ],
              "circle-opacity": ["case", ["==", ["get", "confidence"], "low"], 0, 0.95],
              "circle-stroke-color": "#faf7f1",
              "circle-stroke-width": 2,
            },
          },
          { id: "measure", type: "line", source: "measure", paint: { "line-color": "#f4efe6", "line-width": 2 } },
        ],
      },
      center: [-98.5, 32.5],
      zoom: 3.4,
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.on("click", "sites", (event: MapLayerMouseEvent) => {
        if (measureRef.current) return;
        const feature = event.features?.[0];
        const id = feature?.properties?.site_id;
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const push = () => {
      (map.getSource("sites") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.sites.filter((f) => f.geometry) });
      (map.getSource("areas") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.areas });
      (map.getSource("depots") as GeoJSONSource).setData({ type: "FeatureCollection", features: props.depots });
      const parcel = props.parcels.filter((feature) => feature.properties.site_id === props.selectedId);
      (map.getSource("parcels") as GeoJSONSource).setData({ type: "FeatureCollection", features: parcel });
      const rings = props.depots
        .filter((feature) => feature.geometry?.type === "Point")
        .flatMap((feature) => {
          const [lon, lat] = feature.geometry!.coordinates as [number, number];
          return [1, 2, 3].map((miles) => ({
            type: "Feature" as const,
            properties: { miles },
            geometry: { type: "LineString" as const, coordinates: circle(lon, lat, miles) },
          }));
        });
      (map.getSource("rings") as GeoJSONSource).setData({ type: "FeatureCollection", features: rings });
      map.setFilter("selected", ["==", ["get", "site_id"], props.selectedId || ""]);
      map.setLayoutProperty("expansion-fill", "visibility", props.showExpansion ? "visible" : "none");
      map.setLayoutProperty("expansion-line", "visibility", props.showExpansion ? "visible" : "none");
      map.setLayoutProperty("labels", "visibility", props.showLabels ? "visible" : "none");
      map.setLayoutProperty("rings", "visibility", props.showRings ? "visible" : "none");
    };
    if (map.isStyleLoaded()) push();
    else map.once("load", push);
  }, [props.sites, props.areas, props.depots, props.parcels, props.selectedId, props.showExpansion, props.showLabels, props.showRings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.selectedId) return;
    const go = () => {
      const site = propsRef.current.sites.find((feature) => feature.properties.site_id === propsRef.current.selectedId);
      if (!site?.geometry) return;
      map.jumpTo({ center: site.geometry.coordinates, zoom: Math.max(map.getZoom(), 15) });
    };
    if (map.loaded()) go();
    else map.once("load", go);
  }, [props.selectedId]);

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
