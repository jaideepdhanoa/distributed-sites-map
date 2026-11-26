"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  LngLatBounds,
  Marker,
  type GeoJSONSource,
  type Map,
  type ExpressionSpecification,
  type FilterSpecification,
} from "maplibre-gl";

import { outlineId } from "@/lib/spaces/outlineAnchor";
import { kinds, worldPoint, type Option, type Aerial, type Point } from "@/lib/spaces/options";
import type { MapSpaceSite, MapZone } from "@/lib/spaces/mapCatalog";

const sourceId = "analyzed-spaces";
const layers = [
  "space-site-halo",
  "space-site-count",
  "space-proposal-fill",
  "space-proposal-line",
  "space-team-line",
];
const palette: ExpressionSpecification = [
  "case",
  ["get", "focused"],
  "#ffc34c",
  ["match", ["get", "kind"], "clear", "#f3eee3", "bay", "#fac477", "#53d9af"],
];
type Props = {
  map: Map | null;
  sites: MapSpaceSite[];
  site?: MapSpaceSite;
  active?: MapZone;
  draft: Point[] | null;
  image?: Aerial;
  workspace: boolean;
  muted: boolean;
  edit: boolean;
  layout: Option;
  overlays: boolean;
  onPick: (site: string, area?: string) => void;
  onPoint: (point: Point, index: number) => void;
};

export default function SpaceGeography(props: Props) {
  const { map, sites, site, active, draft, image, edit, workspace, muted, layout, overlays } = props;
  const latest = useRef(props);
  latest.current = props;
  const collection = useMemo(() => {
    const features: {
      type: "Feature";
      geometry: { type: "Point"; coordinates: Point } | { type: "Polygon"; coordinates: Point[][] };
      properties: Record<string, string | boolean | number>;
    }[] = [];
    for (const item of sites) {
      const selected = item.id === site?.id;
      if (workspace && item.center)
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: item.center },
          properties: {
            site: item.id,
            count: item.zones.filter((zone) => zone.kind !== "clear").length,
            aligned: Boolean(item.frame.bounds),
          },
        });
      if (!item.frame.bounds || (workspace && !overlays)) continue;
      for (const zone of item.zones) {
        if (zone.kind === "clear" && !selected) continue;
        if (selected && zone.kind !== "clear" && kinds[zone.kind].option !== layout) continue;
        const id = outlineId(zone);
        const focused = selected && active && id === outlineId(active);
        const points = focused && draft ? draft : zone.points;
        const ring = points.map((p) => worldPoint(p, item.frame.bounds!));
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
          properties: {
            site: item.id,
            area: id,
            kind: zone.kind,
            focused: Boolean(focused),
            solid: zone.edited || zone.kind === "clear",
          },
        });
      }
    }
    return { type: "FeatureCollection" as const, features };
  }, [sites, site, active, draft, workspace, layout, overlays]);
  const data = useRef(collection);
  data.current = collection;
  useEffect(() => {
    if (!map || muted) return;
    function install() {
      if (!map || map.getSource(sourceId)) return;
      map.addSource(sourceId, { type: "geojson", data: data.current });
      const points: FilterSpecification = ["==", ["geometry-type"], "Point"];
      map.addLayer({
        id: layers[0],
        type: "circle",
        source: sourceId,
        filter: points,
        paint: {
          "circle-radius": 12,
          "circle-color": "#1d4e3d",
          "circle-stroke-color": "#f8f4e9",
          "circle-stroke-width": 2,
          "circle-opacity": ["step", ["zoom"], 0.92, 16, ["case", ["get", "aligned"], 0, 0.92]],
          "circle-stroke-opacity": ["step", ["zoom"], 1, 16, ["case", ["get", "aligned"], 0, 1]],
        },
      });
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 48;
      const context = canvas.getContext("2d");
      if (context) {
        for (let n = 1; n <= 30; n++) {
          const id = "space-total-" + n;
          if (map.hasImage(id)) continue;
          context.clearRect(0, 0, 48, 48);
          context.font = "bold 25px sans-serif";
          context.fillStyle = "#fff";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(n), 24, 25);
          map.addImage(id, context.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
        }
        map.addLayer({
          id: layers[1],
          type: "symbol",
          source: sourceId,
          maxzoom: 16,
          filter: points,
          layout: {
            "icon-image": ["concat", "space-total-", ["to-string", ["get", "count"]]],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      }
      map.addLayer({
        id: layers[2],
        type: "fill",
        minzoom: 15,
        source: sourceId,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": palette, "fill-opacity": ["case", ["get", "focused"], 0.52, 0.28] },
      });
      for (const solid of [false, true])
        map.addLayer({
          id: layers[solid ? 4 : 3],
          type: "line",
          minzoom: 15,
          source: sourceId,
          filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "solid"], solid]],
          paint: {
            "line-color": palette,
            "line-width": ["case", ["get", "focused"], 4, 2.5],
            ...(solid ? {} : { "line-dasharray": [3, 2] }),
          },
        });
    }
    if (map.isStyleLoaded() || map.getSource("sites") || map.getSource(sourceId)) install();
    else map.once("style.load", install);
    const canvas = map.getCanvasContainer();
    function pick(event: MouseEvent) {
      if (!map || !map.getLayer(layers[2])) return;
      const rect = map.getCanvas().getBoundingClientRect();
      const hits = map.queryRenderedFeatures([event.clientX - rect.left, event.clientY - rect.top], {
        layers: [layers[2], layers[0]],
      });
      const hit = hits.find(
        (f) =>
          f.properties.kind !== "clear" &&
          (f.geometry.type !== "Point" || !f.properties.aligned || map.getZoom() < 16),
      );
      if (!hit && !latest.current.workspace) return;
      event.stopImmediatePropagation();
      if (hit && !latest.current.edit) latest.current.onPick(hit.properties.site, hit.properties.area);
    }
    canvas.addEventListener("click", pick, true);
    return () => {
      canvas.removeEventListener("click", pick, true);
      map.off("style.load", install);
      if (!map.getStyle()) return;
      for (const layer of [...layers].reverse()) if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, muted]);
  useEffect(() => {
    (map?.getSource(sourceId) as GeoJSONSource | undefined)?.setData(collection);
  }, [map, collection, muted]);
  const [west, north, east, south] = site?.frame.bounds || [];
  const bounds = useMemo(
    () =>
      west === undefined ? undefined : ([west, north!, east!, south!] as [number, number, number, number]),
    [west, north, east, south],
  );
  const extent =
    !site && workspace
      ? sites.reduce<number[] | null>((box, item) => {
          if (!item.center) return box;
          const [x, y] = item.center;
          return box
            ? [Math.min(box[0], x), Math.max(box[1], y), Math.max(box[2], x), Math.min(box[3], y)]
            : [x, y, x, y];
        }, null)
      : null;
  const selectedBounds = useMemo(() => {
    if (!bounds || !active?.points.length) return bounds;
    const footprint = new LngLatBounds();
    for (const point of active.points) footprint.extend(worldPoint(point, bounds));
    // Keep the approach and the neighboring aisle visible around the selected footprint.
    const context = LngLatBounds.fromLngLat(footprint.getSouthWest(), 15);
    context.extend(LngLatBounds.fromLngLat(footprint.getNorthEast(), 15));
    return [context.getWest(), context.getNorth(), context.getEast(), context.getSouth()];
  }, [bounds, active]);
  const cameraBounds = (selectedBounds || extent)?.join(",");
  useEffect(() => {
    if (!map || !cameraBounds || !workspace || muted) return;
    const [w, n, e, s] = cameraBounds.split(",").map(Number);
    function focus() {
      if (!map) return;
      map.resize();
      const phone = map.getContainer().clientWidth < 760;
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        {
          maxZoom: site ? 20 : 14,
          padding: phone
            ? {
                top: 76,
                bottom: Math.round(map.getContainer().clientHeight * (site ? 0.34 : 0.54)),
                left: 20,
                right: 20,
              }
            : { top: 86, bottom: 45, left: 45, right: 340 },
          duration: 0,
        },
      );
    }
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [map, cameraBounds, Boolean(site), workspace, muted]);
  useEffect(() => {
    if (!map || !image?.bounds || !workspace || muted) return;
    const [w, n, e, s] = image.bounds,
      src = image.src;
    function install() {
      if (!map || map.getSource("space-evidence-image")) return;
      map.addSource("space-evidence-image", {
        type: "image",
        url: src,
        coordinates: [
          [w, n],
          [e, n],
          [e, s],
          [w, s],
        ],
      });
      map.addLayer(
        {
          id: "space-evidence-image",
          type: "raster",
          source: "space-evidence-image",
          paint: { "raster-fade-duration": 0 },
        },
        // The filed frame fills missing satellite tiles. Its printed markings belong in source inspection.
        map.getLayer("imagery") ? "imagery" : map.getLayer(layers[0]) ? layers[0] : undefined,
      );
    }
    if (map.isStyleLoaded() || map.getSource("sites") || map.getSource(sourceId)) install();
    else map.once("style.load", install);
    return () => {
      map.off("style.load", install);
      if (!map.getStyle()) return;
      if (map.getLayer("space-evidence-image")) map.removeLayer("space-evidence-image");
      if (map.getSource("space-evidence-image")) map.removeSource("space-evidence-image");
    };
  }, [map, image, workspace, muted]);
  useEffect(() => {
    if (!map || !site || !bounds || muted || !overlays || edit) return;
    const names = site.zones
      .filter((z) => z.kind === "clear" || z === active)
      .map((z) => {
        const where = z.points.reduce(
          ([x, y], p) => [x + p[0] / z.points.length, y + p[1] / z.points.length] as Point,
          [0, 0] as Point,
        );
        const element = document.createElement("span");
        element.className = "space-feature-label" + (z.kind === "clear" ? " keep-clear" : "");
        element.textContent = z.kind === "clear" ? "Keep clear" : z.label;
        return new Marker({ element, anchor: "top", offset: [0, 5] })
          .setLngLat(worldPoint(where, bounds))
          .addTo(map);
      });
    return () => {
      for (const name of names) name.remove();
    };
  }, [map, site, active, bounds, muted, overlays, edit]);
  const markers = useRef<Marker[]>([]);
  const count = active?.points.length || 0;
  useEffect(() => {
    if (!map || !bounds || !edit || muted || !active) return;
    const [w, n, e, s] = bounds;
    markers.current = active.points.map((point, index) => {
      const element = document.createElement("span");
      element.className = "map-outline-corner";
      element.title = "Corner " + (index + 1);
      const marker = new Marker({ element, draggable: true })
        .setLngLat(worldPoint(point, bounds))
        .addTo(map);
      marker.on("drag", () => {
        const { lng, lat } = marker.getLngLat();
        const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v * 1000) / 10));
        latest.current.onPoint([pct((lng - w) / (e - w)), pct((lat - n) / (s - n))], index);
      });
      return marker;
    });
    return () => {
      for (const marker of markers.current) marker.remove();
      markers.current = [];
    };
  }, [map, bounds, active, edit, muted, count]);
  useEffect(() => {
    if (bounds && draft) draft.forEach((p, i) => markers.current[i]?.setLngLat(worldPoint(p, bounds)));
  }, [draft, bounds]);
  return null;
}
