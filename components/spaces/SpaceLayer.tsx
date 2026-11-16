"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { GeoJSONSource, Map, setWorkerUrl, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MentionChips, MentionField, type MentionAccount } from "../actions/MentionField";
import "../actions/actions.css";
import { formatPacific } from "@/lib/actions/time";
import {
  axisAlignedBox,
  boxContains,
  formatArea,
  formatFeet,
  fromLocalFeet,
  moveBox,
  rectanglePolygon,
  resizeBox,
  rotateBox,
  type GroundBox,
  type LngLat,
} from "@/lib/spaces/measure";
import { estimateLabel, estimateSlots } from "@/lib/spaces/slots";
import {
  SPACE_LAYOUTS,
  SPACE_TYPES,
  spaceLayout,
  spaceTypeLabel,
  type SpaceLayout,
  type SpaceType,
} from "@/lib/spaces/vocab";

type SpaceView = {
  id: string;
  version: number;
  box: GroundBox;
  type: SpaceType;
  layout: SpaceLayout;
  author: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

type Drag =
  | { kind: "draw"; start: LngLat }
  | { kind: "move"; id: string; from: LngLat; origin: GroundBox }
  | { kind: "resize"; id: string; sx: number; sy: number; origin: GroundBox }
  | { kind: "rotate"; id: string; origin: GroundBox };

const CAUTION = "Aerial imagery can be months old and slightly skewed. Counts stay Estimated until someone checks them on the ground.";

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function asLngLat(value: { lng: number; lat: number }): LngLat {
  return { lng: value.lng, lat: value.lat };
}

function toView(row: {
  id: string;
  version: number;
  center: LngLat;
  lengthFt: number;
  widthFt: number;
  rotationDeg: number;
  type: SpaceType;
  layout: SpaceLayout;
  author: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}): SpaceView {
  return {
    id: row.id,
    version: row.version,
    box: { center: row.center, lengthFt: row.lengthFt, widthFt: row.widthFt, rotationDeg: row.rotationDeg },
    type: row.type,
    layout: row.layout,
    author: row.author,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export default function SpaceLayer({
  siteId,
  lat,
  lng,
  focusId,
  tabs,
}: {
  siteId: string;
  lat: number;
  lng: number;
  focusId?: string;
  tabs: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spacesRef = useRef<SpaceView[]>([]);
  const drawingRef = useRef(false);
  const [spaces, setSpaces] = useState<SpaceView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<GroundBox | null>(null);
  const [handles, setHandles] = useState<{ corners: { sx: number; sy: number; x: number; y: number }[]; rotate: { x: number; y: number } | null }>({ corners: [], rotate: null });
  const [mapFailed, setMapFailed] = useState("");
  const [mapReady, setMapReady] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  spacesRef.current = spaces;
  drawingRef.current = drawing;
  const [names, setNames] = useState<Record<string, string>>({});
  const selected = spaces.find((space) => space.id === selectedId) || null;
  const nameOf = (id: string) => names[id] || id;

  useEffect(() => {
    let cancel = false;
    void fetch("/api/actions/accounts", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { accounts: [] })
      .then((body: { accounts?: { id: string; name: string }[] }) => {
        if (cancel) return;
        const next: Record<string, string> = {};
        for (const account of body.accounts || []) next[account.id] = account.name;
        setNames(next);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    void fetch(`/api/data/spaces?site=${encodeURIComponent(siteId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        return response.json() as Promise<{ spaces?: Parameters<typeof toView>[0][] }>;
      })
      .then((body) => {
        if (cancel) return;
        const next = (body.spaces || []).map(toView);
        setSpaces(next);
        if (focusId && next.some((space) => space.id === focusId)) setSelectedId(focusId);
      })
      .catch(() => {
        if (!cancel) setError("Marked spaces could not be loaded.");
      });
    return () => {
      cancel = true;
    };
  }, [siteId, focusId]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    setWorkerUrl("/maplibre-gl-worker.js");
    let map: Map;
    try {
      const canvas = document.createElement("canvas");
      if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) {
        setMapFailed("This browser cannot draw the aerial.");
        return;
      }
      map = new Map({
        container: node,
        style: {
          version: 8,
          sources: {
            imagery: { type: "raster", tiles: [IMAGERY], tileSize: 256, attribution: "Powered by Esri", maxzoom: 19 },
          },
          layers: [{ id: "imagery", type: "raster", source: "imagery" }],
        },
        center: [lng, lat],
        zoom: 18,
        maxZoom: 19,
        minZoom: 15,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 0,
      });
    } catch {
      setMapFailed("This browser cannot draw the aerial.");
      return;
    }
    mapRef.current = map;
    map.on("load", () => {
      map.resize();
      map.addSource("spaces", { type: "geojson", data: emptyCollection() });
      map.addLayer({
        id: "space-fill",
        type: "fill",
        source: "spaces",
        paint: {
          "fill-color": "#1e4636",
          "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.42, 0.28],
        },
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
        paint: {
          "line-color": "#fffdf8",
          "line-width": 2,
        },
      });
      setMapReady((value) => value + 1);
    });

    const point = (event: MapLayerMouseEvent) => asLngLat(event.lngLat);

    function onDown(event: MapLayerMouseEvent) {
      if (dragRef.current) return;
      if (drawingRef.current) {
        map.dragPan.disable();
        dragRef.current = { kind: "draw", start: point(event) };
        setDraft(null);
        return;
      }
      const hit = [...spacesRef.current].reverse().find((space) => boxContains(space.box, point(event)));
      if (!hit) {
        setSelectedId("");
        return;
      }
      setSelectedId(hit.id);
      setConfirmDelete(false);
      map.dragPan.disable();
      dragRef.current = { kind: "move", id: hit.id, from: point(event), origin: hit.box };
    }

    function onMove(event: MapLayerMouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const cursor = point(event);
      if (drag.kind === "draw") {
        setDraft(axisAlignedBox(drag.start, cursor));
        return;
      }
      if (drag.kind === "move") {
        setSpaces((current) => current.map((space) => space.id === drag.id ? { ...space, box: moveBox(drag.origin, drag.from, cursor) } : space));
      }
    }

    function onUp(event: MapLayerMouseEvent) {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drawingRef.current) map.dragPan.enable();
      if (!drag) return;
      const cursor = point(event);
      if (drag.kind === "draw") {
        const box = axisAlignedBox(drag.start, cursor);
        setDraft(null);
        if (box.lengthFt >= 4 && box.widthFt >= 4) {
          const pending: SpaceView = {
            id: `pending-${Date.now()}`,
            version: 0,
            box,
            type: "excess_parking",
            layout: "stalls_90",
            author: "",
            updatedBy: "",
            createdAt: "",
            updatedAt: "",
          };
          setDrawing(false);
          setSelectedId(pending.id);
          setSpaces((current) => [...current, pending]);
          void persist(pending);
        }
        return;
      }
      if (drag.kind === "move") {
        const space = spacesRef.current.find((item) => item.id === drag.id);
        if (!space) return;
        const next = { ...space, box: moveBox(drag.origin, drag.from, cursor) };
        setSpaces((current) => current.map((item) => item.id === next.id ? next : item));
        void persist(next);
      }
    }

    map.on("mousedown", onDown);
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    map.on("touchstart", (event) => onDown(event as unknown as MapLayerMouseEvent));
    map.on("touchmove", (event) => onMove(event as unknown as MapLayerMouseEvent));
    map.on("touchend", (event) => onUp(event as unknown as MapLayerMouseEvent));

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(node);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map is built once per site. Later edits go through the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, lat, lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (drawing) {
      map.dragPan.disable();
      map.getCanvas().style.cursor = "crosshair";
    } else if (!dragRef.current) {
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
    }
  }, [drawing, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("spaces") as GeoJSONSource | undefined;
    if (!source) return;
    const features = spaces.map((space) => ({
      type: "Feature" as const,
      properties: { id: space.id, selected: space.id === selectedId },
      geometry: rectanglePolygon(space.box),
    }));
    if (draft && draft.lengthFt >= 1 && draft.widthFt >= 1) {
      features.push({
        type: "Feature",
        properties: { id: "draft", selected: true },
        geometry: rectanglePolygon(draft),
      });
    }
    source.setData({ type: "FeatureCollection", features });
  }, [spaces, selectedId, draft, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selected) {
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
      const knob = fromLocalFeet(selected.box.center, selected.box.rotationDeg, 0, selected.box.widthFt / 2 + 48);
      const rotate = map.project([knob.lng, knob.lat]);
      setHandles({ corners, rotate: { x: rotate.x, y: rotate.y } });
    };
    place();
    map.on("move", place);
    return () => {
      map.off("move", place);
    };
  }, [selected, mapReady, spaces]);

  async function reload(selectId?: string) {
    const response = await fetch(`/api/data/spaces?site=${encodeURIComponent(siteId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("load");
    const body = await response.json() as { spaces?: Parameters<typeof toView>[0][] };
    const next = (body.spaces || []).map(toView);
    setSpaces(next);
    if (selectId) setSelectedId(selectId);
    else setSelectedId((current) => next.some((space) => space.id === current) ? current : "");
  }

  async function persist(space: SpaceView, deleted = false) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/changes", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          changes: [{
            entity_type: "site_space",
            site_id: siteId,
            ...(space.version > 0 ? { entity_id: space.id } : {}),
            expected_version: space.version,
            source: "Site aerial",
            payload: deleted
              ? { deleted: true }
              : {
                  center_lng: space.box.center.lng,
                  center_lat: space.box.center.lat,
                  length_ft: space.box.lengthFt,
                  width_ft: space.box.widthFt,
                  rotation_deg: space.box.rotationDeg,
                  type: space.type,
                  layout: space.layout,
                },
          }],
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; results?: { entity_id?: string }[] };
      if (!response.ok) throw new Error(body.error || "That area could not be saved.");
      const id = body.results?.[0]?.entity_id;
      await reload(deleted ? "" : id || space.id);
      if (deleted) setConfirmDelete(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That area could not be saved.");
      try {
        await reload();
      } catch {
        // The message above is the one to show.
      }
    } finally {
      setSaving(false);
    }
  }

  function updateSelected(next: Partial<Pick<SpaceView, "type" | "layout">> & { box?: GroundBox }) {
    if (!selected) return;
    const updated = { ...selected, ...next, box: next.box || selected.box };
    setSpaces((current) => current.map((space) => space.id === selected.id ? updated : space));
    void persist(updated);
  }

  function onHandleDown(event: ReactPointerEvent<HTMLButtonElement>, drag: Extract<Drag, { kind: "resize" | "rotate" }>) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = drag;
    let latest = drag.origin;
    mapRef.current?.dragPan.disable();
    const move = (pointer: PointerEvent) => {
      const map = mapRef.current;
      const current = dragRef.current;
      if (!map || !current || (current.kind !== "resize" && current.kind !== "rotate")) return;
      const rect = map.getContainer().getBoundingClientRect();
      const projected = map.unproject([pointer.clientX - rect.left, pointer.clientY - rect.top]);
      const cursor = asLngLat(projected);
      const box = current.kind === "rotate" ? rotateBox(current.origin, cursor) : resizeBox(current.origin, current.sx, current.sy, cursor);
      if (box.lengthFt < 4 || box.widthFt < 4) return;
      latest = box;
      setSpaces((list) => list.map((item) => item.id === current.id ? { ...item, box } : item));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const current = dragRef.current;
      dragRef.current = null;
      if (!drawingRef.current) mapRef.current?.dragPan.enable();
      if (!current || (current.kind !== "resize" && current.kind !== "rotate")) return;
      const space = spacesRef.current.find((item) => item.id === current.id);
      if (space) void persist({ ...space, box: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const count = selected ? estimateSlots(selected.box.lengthFt, selected.box.widthFt, selected.layout) : 0;
  const unit = selected ? spaceLayout(selected.layout).unit : "stall";

  return (
    <div className="space-layer" data-testid="space-layer">
      <div className="hero-slot">
        <div className="hero-frame is-spaces">
          <div className="space-stage" data-testid="space-aerial">
            <div className="space-map" ref={stageRef} />
          </div>
          {mapFailed ? <p className="map-fail" role="alert">{mapFailed}</p> : null}
          {handles.rotate && !drawing ? (
            <button
              type="button"
              className="icon-btn space-handle"
              style={{ left: handles.rotate.x, top: handles.rotate.y }}
              aria-label="Rotate area"
              data-testid="space-rotate"
              onPointerDown={(event) => selected && onHandleDown(event, { kind: "rotate", id: selected.id, origin: selected.box })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 7a6 6 0 1 0 1.5 4" /><path d="M16 3v4h4" /></svg>
            </button>
          ) : null}
          {selected && !drawing ? handles.corners.map((corner) => (
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
        </div>
        <div className="hero-chrome">
          {tabs}
          <button
            type="button"
            className={drawing ? "tool on space-mark" : "tool space-mark"}
            aria-pressed={drawing}
            data-testid="mark-space"
            onClick={() => {
              setDrawing((value) => !value);
              setDraft(null);
            }}
          >
            Mark space
          </button>
        </div>
      </div>
      <div className="space-panel" data-testid="space-panel">
        {error ? <p className="note" role="alert" data-testid="space-error">{error}</p> : null}
        {selected ? (
          <>
            <p className="eyebrow">Marked space</p>
            <div className="space-types only-desktop" role="group" aria-label="Space type">
              {SPACE_TYPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={selected.type === item.id ? "chip on" : "chip"}
                  aria-pressed={selected.type === item.id}
                  data-testid={`space-type-${item.id}`}
                  onClick={() => updateSelected({ type: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="space-layout only-mobile">
              Type
              <select
                className="secondary"
                aria-label="Space type"
                data-testid="space-type"
                value={selected.type}
                onChange={(event) => updateSelected({ type: event.target.value as SpaceType })}
              >
                {SPACE_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <p className="space-measure" data-testid="space-measure">
              {formatFeet(selected.box.lengthFt)} ft × {formatFeet(selected.box.widthFt)} ft · {formatArea(selected.box.lengthFt * selected.box.widthFt)}
            </p>
            <label className="space-layout">
              Layout
              <select
                className="secondary"
                aria-label="Layout"
                data-testid="space-layout"
                value={selected.layout}
                onChange={(event) => updateSelected({ layout: event.target.value as SpaceLayout })}
              >
                {SPACE_LAYOUTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <p className="space-estimate" data-testid="space-estimate">{estimateLabel(count, unit)}</p>
            <p className="note">
              Marked by {selected.author ? nameOf(selected.author) : "you"}
              {selected.updatedBy && selected.updatedBy !== selected.author ? ` · Updated by ${nameOf(selected.updatedBy)}` : ""}
            </p>
            {confirmDelete ? (
              <button type="button" className="text-link" data-testid="space-delete" onClick={() => void persist(selected, true)}>Confirm delete</button>
            ) : (
              <button type="button" className="text-link" data-testid="space-delete" onClick={() => setConfirmDelete(true)}>Delete area</button>
            )}
            {selected.id.startsWith("SS-") ? <SpaceThread spaceId={selected.id} /> : null}
          </>
        ) : (
          <p className="note">{mapFailed ? "Marked spaces can still be opened from the list below." : "Drag a rectangle on the aerial, then rotate it to line up with the parking rows."}</p>
        )}
        {mapFailed ? (
          <div className="space-types" role="group" aria-label="Marked spaces">
            {spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                className={space.id === selectedId ? "chip on" : "chip"}
                onClick={() => setSelectedId(space.id)}
              >
                {spaceTypeLabel(space.type)}
              </button>
            ))}
          </div>
        ) : null}
        <p className="note" data-testid="space-caution">{CAUTION}</p>
        {saving ? <p className="note">Saving</p> : null}
      </div>
    </div>
  );
}

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function SpaceThread({ spaceId }: { spaceId: string }) {
  const [accounts, setAccounts] = useState<MentionAccount[]>([]);
  const [notes, setNotes] = useState<{ id: string; body: string; authorId: string; createdAt: string; mentions: MentionAccount[] }[]>([]);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<MentionAccount[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function load() {
    const response = await fetch(`/api/actions/notes?targetKind=site_space&targetId=${encodeURIComponent(spaceId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { notes?: { id: string; body: string; authorId: string; createdAt: string; mentions?: MentionAccount[]; deleted?: boolean }[] };
    setNotes((payload.notes || []).filter((note) => note.body && !note.deleted).map((note) => ({
      id: note.id,
      body: note.body,
      authorId: note.authorId,
      createdAt: note.createdAt,
      mentions: note.mentions || [],
    })));
  }

  useEffect(() => {
    void fetch("/api/actions/accounts", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { accounts: [] })
      .then((payload: { accounts?: MentionAccount[] }) => setAccounts(payload.accounts || []))
      .catch(() => setAccounts([]));
    void load();
    // load is stable for this space id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  return (
    <section className="act" data-testid="space-thread">
      <div className="act-threads">
        {notes.map((note) => (
          <article key={note.id} className="act-thread" data-testid="space-note">
            <p className="note-copy">{note.body}</p>
            {note.mentions.length ? <p className="note">Mentioned <MentionChips mentions={note.mentions} /></p> : null}
            <p className="note"><strong>{accounts.find((account) => account.id === note.authorId)?.name || note.authorId}</strong> · {formatPacific(note.createdAt)}</p>
          </article>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim() || pending) return;
          setPending(true);
          setError("");
          void fetch("/api/actions/notes", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              targetKind: "site_space",
              targetId: spaceId,
              body,
              mentions: mentions.map((item) => item.id),
            }),
          }).then(async (response) => {
            if (!response.ok) {
              const payload = await response.json().catch(() => ({})) as { error?: string };
              throw new Error(payload.error || "That comment could not be saved.");
            }
            setBody("");
            setMentions([]);
            await load();
          }).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "That comment could not be saved.");
          }).finally(() => setPending(false));
        }}
      >
        <MentionField
          label=""
          placeholder="Comment or @mention…"
          value={body}
          onChange={setBody}
          mentions={mentions}
          onMentions={setMentions}
          accounts={accounts}
          testId="space-note-body"
          rows={3}
          maxLength={2000}
        />
        <p className="hint">Type @ to mention someone.</p>
        <div className="act-row">
          <button type="submit" className="menu-item" disabled={pending}>Comment</button>
        </div>
      </form>
      {error ? <p className="note" role="alert">{error}</p> : null}
    </section>
  );
}
