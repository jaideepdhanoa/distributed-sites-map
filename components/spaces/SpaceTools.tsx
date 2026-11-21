"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GeoJSONSource, Map, MapLayerMouseEvent } from "maplibre-gl";
import {
  axisAlignedBox,
  boxContains,
  fromLocalFeet,
  moveBox,
  rectanglePolygon,
  resizeBox,
  rotateBox,
  type GroundBox,
  type LngLat,
} from "@/lib/spaces/measure";
import { applyDrawCommand, draftFromDrag, emptyDraft, type DrawDraft } from "@/lib/spaces/draw";
import { estimateSlots } from "@/lib/spaces/slots";
import { spaceMapLabel } from "@/lib/spaces/slots";
import type { SpaceShape } from "./SpacePopover";
import SpacePopover from "./SpacePopover";

type Drag =
  | { kind: "draw"; start: LngLat }
  | { kind: "move"; id: string; from: LngLat; origin: GroundBox }
  | { kind: "resize"; id: string; sx: number; sy: number; origin: GroundBox }
  | { kind: "rotate"; id: string; origin: GroundBox };

function asLngLat(value: { lng: number; lat: number }): LngLat {
  return { lng: value.lng, lat: value.lat };
}

/** The lot under a map click. A pixel query can miss when the camera has an inset, so the lot rectangle is checked too. */
export function spaceIdAt(
  map: Map,
  point: { x: number; y: number },
  lngLat: { lng: number; lat: number },
  spaces: SpaceShape[],
): string {
  const layers = ["space-fill", "space-line"].filter((id) => map.getLayer(id));
  if (layers.length) {
    const hits = map.queryRenderedFeatures(
      [[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]],
      { layers },
    );
    const id = String(hits.find((hit) => hit.properties?.id && hit.properties.id !== "draft")?.properties?.id || "");
    if (id) return id;
  }
  return spaces.find((space) => boxContains(space.box, lngLat))?.id || "";
}

function collection(spaces: SpaceShape[], draft: GroundBox | null, selectedId: string) {
  const features = spaces.map((space) => ({
    type: "Feature" as const,
    properties: {
      id: space.id,
      selected: space.id === selectedId,
      label: spaceMapLabel(space.box.lengthFt, space.box.widthFt, space.estSlots || estimateSlots(space.box.lengthFt, space.box.widthFt, space.layout)),
    },
    geometry: rectanglePolygon(space.box),
  }));
  if (draft && draft.lengthFt >= 1 && draft.widthFt >= 1) {
    features.push({
      type: "Feature",
      properties: { id: "draft", selected: true, label: "" },
      geometry: rectanglePolygon(draft),
    });
  }
  return { type: "FeatureCollection" as const, features };
}

export default function SpaceTools({
  map,
  spaces,
  visible,
  drawing,
  selectedId,
  names,
  commentedIds = [],
  threadOpen = false,
  onThreadClose,
  onSelect,
  onCreate,
  onChange,
  onDelete,
  onCloseDraw,
  drawCommand,
  onDraftPoints,
  requestDelete = 0,
}: {
  map: Map;
  spaces: SpaceShape[];
  visible: boolean;
  drawing: boolean;
  selectedId: string;
  names: Record<string, string>;
  commentedIds?: string[];
  threadOpen?: boolean;
  onThreadClose?: () => void;
  onSelect: (id: string) => void;
  onCreate: (box: GroundBox) => void;
  onChange: (space: SpaceShape) => void;
  onDelete: (space: SpaceShape) => void;
  onCloseDraw: () => void;
  drawCommand: { id: number; type: "undo" | "cancel" | "finish" } | null;
  onDraftPoints: (count: number) => void;
  requestDelete?: number;
}) {
  const spacesRef = useRef(spaces);
  const drawingRef = useRef(drawing);
  const dragRef = useRef<Drag | null>(null);
  const draftState = useRef<DrawDraft>(emptyDraft());
  const [draft, setDraft] = useState<GroundBox | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [handles, setHandles] = useState<{ corners: { sx: number; sy: number; x: number; y: number }[]; rotate: { x: number; y: number } | null }>({ corners: [], rotate: null });
  const [marks, setMarks] = useState<{ id: string; x: number; y: number }[]>([]);
  const onSelectRef = useRef(onSelect);
  const onCreateRef = useRef(onCreate);
  const onChangeRef = useRef(onChange);
  const onDeleteRef = useRef(onDelete);
  const onCloseDrawRef = useRef(onCloseDraw);
  const onDraftPointsRef = useRef(onDraftPoints);
  onSelectRef.current = onSelect;
  onCreateRef.current = onCreate;
  onChangeRef.current = onChange;
  onDeleteRef.current = onDelete;
  onCloseDrawRef.current = onCloseDraw;
  onDraftPointsRef.current = onDraftPoints;
  spacesRef.current = spaces;
  drawingRef.current = drawing;
  const selected = spaces.find((space) => space.id === selectedId) || null;

  useEffect(() => {
    const point = (event: MapLayerMouseEvent) => asLngLat(event.lngLat);
    const held = { id: "", x: 0, y: 0, from: { lng: 0, lat: 0 }, origin: null as GroundBox | null, moved: false };
    const onDown = (event: MapLayerMouseEvent) => {
      const id = spaceIdAt(map, event.point, event.lngLat, spacesRef.current);
      if (id) {
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
        onSelectRef.current(id);
        const space = spacesRef.current.find((item) => item.id === id);
        if (!space) return;
        map.dragPan.disable();
        held.id = id;
        held.x = event.point.x;
        held.y = event.point.y;
        held.from = point(event);
        held.origin = space.box;
        held.moved = false;
        dragRef.current = null;
        return;
      }
      held.id = "";
      if (!drawingRef.current) return;
      event.originalEvent.preventDefault();
      map.dragPan.disable();
      dragRef.current = { kind: "draw", start: point(event) };
      setDraft(null);
    };
    const onMove = (event: MapLayerMouseEvent) => {
      if (held.id && held.origin && !held.moved) {
        const distance = Math.hypot(event.point.x - held.x, event.point.y - held.y);
        if (distance > 6) {
          held.moved = true;
          dragRef.current = { kind: "move", id: held.id, from: held.from, origin: held.origin };
        }
      }
      const drag = dragRef.current;
      if (!drag) return;
      const cursor = point(event);
      if (drag.kind === "draw") setDraft(axisAlignedBox(drag.start, cursor));
      if (drag.kind === "move") {
        const next = moveBox(drag.origin, drag.from, cursor);
        const source = map.getSource("spaces") as GeoJSONSource | undefined;
        source?.setData(collection(spacesRef.current.map((space) => space.id === drag.id ? { ...space, box: next } : space), null, drag.id));
      }
    };
    const onUp = (event: MapLayerMouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      held.id = "";
      map.dragPan.enable();
      if (!drag) return;
      const cursor = point(event);
      if (drag.kind === "draw") {
        const next = draftFromDrag(drag.start, cursor);
        draftState.current = next;
        setDraft(next.box);
        onDraftPointsRef.current(next.points.length);
        return;
      }
      if (drag.kind === "move") {
        const space = spacesRef.current.find((item) => item.id === drag.id);
        if (space) onChangeRef.current({ ...space, box: moveBox(drag.origin, drag.from, cursor) });
      }
    };
    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    const onTouchStart = (event: unknown) => onDown(event as MapLayerMouseEvent);
    const onTouchMove = (event: unknown) => onMove(event as MapLayerMouseEvent);
    const onTouchEnd = (event: unknown) => onUp(event as MapLayerMouseEvent);
    map.on("touchstart", onTouchStart);
    map.on("touchmove", onTouchMove);
    map.on("touchend", onTouchEnd);
    return () => {
      map.off("mousedown", onDown);
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      map.off("touchstart", onTouchStart);
      map.off("touchmove", onTouchMove);
      map.off("touchend", onTouchEnd);
    };
  }, [map]);

  useEffect(() => {
    setAdjusting(false);
  }, [selectedId]);

  useEffect(() => {
    if (!drawCommand) return;
    dragRef.current = null;
    const result = applyDrawCommand(draftState.current, drawCommand.type === "cancel" ? "cancel" : drawCommand.type);
    draftState.current = result.draft;
    setDraft(result.draft.box);
    onDraftPointsRef.current(result.draft.points.length);
    if (result.commit) onCreateRef.current(result.commit);
    if (result.close) onCloseDrawRef.current();
  }, [drawCommand]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const publish = () => {
      if (cancelled || running) return;
      running = true;
      try {
        if (!map.getSource("spaces")) {
          map.addSource("spaces", { type: "geojson", data: collection([], null, "") });
          map.addLayer({
            id: "space-fill",
            type: "fill",
            source: "spaces",
            paint: { "fill-color": "#1e4636", "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.42, 0.28] },
          });
          map.addLayer({
            id: "space-line-halo",
            type: "line",
            source: "spaces",
            paint: { "line-color": "#1c1914", "line-width": 5 },
          });
          map.addLayer({
            id: "space-line",
            type: "line",
            source: "spaces",
            paint: { "line-color": "#fffdf8", "line-width": 2 },
          });
        }
        if (!map.getLayer("space-label")) {
          try {
            map.addLayer({
              id: "space-label",
              type: "symbol",
              source: "spaces",
              layout: {
                "text-field": ["get", "label"],
                "text-font": ["Noto Sans Regular"],
                "text-size": 12,
                "text-allow-overlap": true,
              },
              paint: { "text-color": "#fffdf8", "text-halo-color": "#1c1914", "text-halo-width": 1.4 },
            });
          } catch {
            // Glyphs can still be loading. The fill is enough to hit the shape.
          }
        }
        const source = map.getSource("spaces") as GeoJSONSource | undefined;
        if (!source) return;
        source.setData(visible ? collection(spaces, draft, selectedId) : collection([], null, ""));
        for (const id of ["space-fill", "space-line", "space-line-halo", "space-label"]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
        map.off("idle", publish);
      } catch {
        // The style is still settling. The next idle or load retries.
      } finally {
        running = false;
      }
    };
    publish();
    map.on("load", publish);
    map.on("idle", publish);
    return () => {
      cancelled = true;
      map.off("load", publish);
      map.off("idle", publish);
    };
  }, [map, spaces, draft, selectedId, visible]);

  useEffect(() => {
    if (!selected || !visible) {
      setHandles({ corners: [], rotate: null });
      return;
    }
    const place = () => {
      const signs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const corners = signs.map(([sx, sy]) => {
        const corner = fromLocalFeet(selected.box.center, selected.box.rotationDeg, sx * selected.box.lengthFt / 2, sy * selected.box.widthFt / 2);
        const projected = map.project([corner.lng, corner.lat]);
        return { sx, sy, x: projected.x, y: projected.y };
      });
      const knob = fromLocalFeet(selected.box.center, selected.box.rotationDeg, 0, selected.box.widthFt / 2 + 28);
      const rotate = map.project([knob.lng, knob.lat]);
      setHandles({ corners, rotate: { x: rotate.x, y: rotate.y } });
    };
    place();
    map.on("move", place);
    return () => {
      map.off("move", place);
    };
  }, [map, selected, visible, spaces]);

  useEffect(() => {
    if (!visible) {
      setMarks([]);
      return undefined;
    }
    const place = () => {
      setMarks(spaces.filter((space) => commentedIds.includes(space.id)).map((space) => {
        const projected = map.project([space.box.center.lng, space.box.center.lat]);
        return { id: space.id, x: projected.x, y: projected.y };
      }));
    };
    place();
    map.on("move", place);
    return () => {
      map.off("move", place);
    };
  }, [map, spaces, commentedIds, visible]);

  function onHandleDown(event: ReactPointerEvent<HTMLButtonElement>, drag: Extract<Drag, { kind: "resize" | "rotate" }>) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = drag;
    let latest = drag.origin;
    map.dragPan.disable();
    const move = (pointer: PointerEvent) => {
      const current = dragRef.current;
      if (!current || (current.kind !== "resize" && current.kind !== "rotate")) return;
      const rect = map.getContainer().getBoundingClientRect();
      const projected = map.unproject([pointer.clientX - rect.left, pointer.clientY - rect.top]);
      const cursor = asLngLat(projected);
      const box = current.kind === "rotate" ? rotateBox(current.origin, cursor) : resizeBox(current.origin, current.sx, current.sy, cursor);
      if (box.lengthFt < 4 || box.widthFt < 4) return;
      latest = box;
      const source = map.getSource("spaces") as GeoJSONSource | undefined;
      source?.setData(collection(spacesRef.current.map((item) => item.id === current.id ? { ...item, box } : item), null, current.id));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
      map.dragPan.enable();
      const space = spacesRef.current.find((item) => item.id === drag.id);
      if (space) onChangeRef.current({ ...space, box: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (!visible && !drawing) return null;
  const showHandles = Boolean(adjusting && selected);
  return (
    <>
      {showHandles && handles.rotate && selected ? (
        <button
          type="button"
          className="icon-btn space-handle"
          style={{ left: handles.rotate.x, top: handles.rotate.y }}
          aria-label="Rotate area"
          data-testid="space-rotate"
          onPointerDown={(event) => onHandleDown(event, { kind: "rotate", id: selected.id, origin: selected.box })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 7a6 6 0 1 0 1.5 4" /><path d="M16 3v4h4" /></svg>
        </button>
      ) : null}
      {showHandles && selected ? handles.corners.map((corner) => (
        <button
          key={`${corner.sx}-${corner.sy}`}
          type="button"
          className="icon-btn space-handle"
          style={{ left: corner.x, top: corner.y }}
          aria-label="Resize area"
          onPointerDown={(event) => onHandleDown(event, { kind: "resize", id: selected.id, sx: corner.sx, sy: corner.sy, origin: selected.box })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /></svg>
        </button>
      )) : null}
      {marks.map((mark) => (
        <i key={mark.id} className="space-comment-mark" style={{ left: mark.x, top: mark.y }} data-testid="space-comment-mark" aria-label="Open comment" />
      ))}
      {selected ? (
        <SpacePopover
          space={selected}
          names={names}
          threadOpen={threadOpen}
          onChange={onChange}
          onClose={() => onSelect("")}
          onEdit={() => setAdjusting(true)}
          onDelete={() => onDeleteRef.current(selected)}
          onThreadClose={onThreadClose}
          requestDelete={requestDelete}
        />
      ) : null}
    </>
  );
}

export function spaceHit(map: Map, point: { x: number; y: number }, lngLat?: { lng: number; lat: number }, spaces: SpaceShape[] = []): boolean {
  return Boolean(spaceIdAt(map, point, lngLat || { lng: 0, lat: 0 }, spaces));
}
