"use client";

import { GripVertical } from "lucide-react";
import { useId, useLayoutEffect, useRef, type PointerEvent } from "react";

type Position = { x: number; y: number };
type Drag = { pointer: number; start: Position; origin: Position; previous: Position | null; moved: boolean };
const desktop = "(min-width: 768px)";
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const corners = [
  ["Top left", 0, 0], ["Top right", 1, 0],
  ["Bottom left", 0, 1], ["Bottom right", 1, 1],
] as const;

// Store fractions of the travel available to this panel so a saved corner stays
// in reach when the map resizes or the panel changes height.
function travel(panel: HTMLElement) {
  const stage = panel.closest(".map-stage")!.getBoundingClientRect();
  const header = panel.closest(".space-map-open")?.querySelector(".space-map-header")?.getBoundingClientRect();
  const top = Math.max(stage.top, header?.bottom ?? 0, 0) + 8;
  const left = Math.max(stage.left, 0) + 8;
  const space = Math.max(0, Math.min(stage.bottom, window.innerHeight) - 8 - top);
  panel.style.setProperty("--panel-room", space + "px");
  const box = panel.getBoundingClientRect();
  return { left, top,
    width: Math.max(0, Math.min(stage.right, window.innerWidth) - 8 - left - box.width),
    height: Math.max(0, space - box.height),
  };
}

function place(panel: HTMLElement, position: Position | null) {
  if (!position) {
    delete panel.dataset.placed;
    panel.style.removeProperty("--panel-left");
    panel.style.removeProperty("--panel-top");
    panel.style.removeProperty("--panel-room");
    return;
  }
  panel.dataset.placed = "true";
  const range = travel(panel);
  panel.style.setProperty("--panel-left", Math.round(range.left + position.x * range.width) + "px");
  panel.style.setProperty("--panel-top", Math.round(range.top + position.y * range.height) + "px");
}

export default function MapPanelGrip({ label }: { label: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement | null>(null);
  const position = useRef<Position | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const menuId = useId();
  const storageKey = "map-panel-position/v1/" + label;

  useLayoutEffect(() => {
    const element = button.current!.closest<HTMLElement>("[data-map-panel]")!;
    panel.current = element;
    position.current = null;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        position.current = { x: clamp(saved.x), y: clamp(saved.y) };
      }
    } catch {}
    const media = window.matchMedia(desktop);
    const fit = () => {
      if (!media.matches) menu.current?.hidePopover();
      place(element, media.matches ? position.current : null);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    observer.observe(element.closest(".map-stage")!);
    const header = element.closest(".space-map-open")?.querySelector(".space-map-header");
    if (header) observer.observe(header);
    media.addEventListener("change", fit);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", fit);
      window.removeEventListener("resize", fit);
      place(element, null);
    };
  }, [storageKey]);

  function save(value: Position | null) {
    position.current = value;
    place(panel.current!, value);
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {}
  }

  function start(e: PointerEvent<HTMLButtonElement>) {
    if (!e.isPrimary || e.button !== 0) return;
    const box = panel.current!.getBoundingClientRect();
    suppressClick.current = false;
    drag.current = { pointer: e.pointerId, start: { x: e.clientX, y: e.clientY },
      origin: { x: box.left, y: box.top }, previous: position.current, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    const range = travel(panel.current!);
    position.current = {
      x: clamp((d.origin.x + dx - range.left) / (range.width || 1)),
      y: clamp((d.origin.y + dy - range.top) / (range.height || 1)),
    };
    place(panel.current!, position.current);
  }

  function end(e: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    suppressClick.current = d.moved;
    if (d.moved) save(cancelled ? d.previous : position.current);
  }

  function choose(value: Position | null) {
    menu.current?.hidePopover();
    save(value);
    button.current?.focus({ preventScroll: true });
  }

  return <>
    <button ref={button} className="tool panel-grip" type="button" aria-label={"Move " + label}
      title={"Drag " + label + " or click to choose a position"} popoverTarget={menuId}
      onPointerDown={start} onPointerMove={move} onPointerUp={e => end(e, false)}
      onPointerCancel={e => end(e, true)} onLostPointerCapture={e => end(e, true)}
      onClick={e => {
        if (suppressClick.current && e.detail !== 0) { e.preventDefault(); }
        suppressClick.current = false;
      }}>
      <GripVertical size={17} aria-hidden="true" />
    </button>
    <div ref={menu} id={menuId} popover="auto" role="group" aria-label={label + " position"}
      className="panel-position-menu" onToggle={e => {
        if (e.newState !== "open") return;
        const grip = button.current!.getBoundingClientRect(), pop = e.currentTarget;
        const left = Math.max(8, Math.min(grip.left, window.innerWidth - pop.offsetWidth - 8));
        const top = grip.bottom + pop.offsetHeight + 8 <= window.innerHeight ? grip.bottom + 4 : grip.top - pop.offsetHeight - 4;
        pop.style.left = left + "px";
        pop.style.top = Math.max(8, top) + "px";
        pop.querySelector("button")?.focus({ preventScroll: true });
      }} onKeyDown={e => {
        if (e.key === "Escape") { e.stopPropagation(); menu.current?.hidePopover(); button.current?.focus({ preventScroll: true }); }
      }}>
      <span className="eyebrow">Move {label}</span>
      <div className="panel-position-grid">{corners.map(([name, x, y]) =>
        <button className="paper-btn" type="button" key={name} onClick={() => choose({ x, y })}>{name}</button>
      )}</div>
      <button className="text-link" type="button" onClick={() => choose(null)}>Restore default position</button>
    </div>
  </>;
}
