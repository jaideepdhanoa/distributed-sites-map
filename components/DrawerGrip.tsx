"use client";

import { useEffect, useState } from "react";
import { DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, DRAWER_WIDTH_KEY, clampDrawerWidth } from "@/lib/drawerWidth";

function shellOf(node: HTMLElement) {
  return node.closest(".shell") as HTMLElement | null;
}

function stageOf(node: HTMLElement) {
  return node.closest(".map-stage") as HTMLElement | null;
}

function readWidth(shell: HTMLElement) {
  const current = parseFloat(shell.style.getPropertyValue("--drawer-width"));
  return Number.isFinite(current) ? current : DRAWER_DEFAULT;
}

function writeWidth(shell: HTMLElement, width: number) {
  const next = clampDrawerWidth(width, window.innerWidth);
  shell.style.setProperty("--drawer-width", `${next}px`);
  shell.dataset.drawerWidth = String(next);
  return next;
}

export default function DrawerGrip() {
  const [width, setWidth] = useState(DRAWER_DEFAULT);

  useEffect(() => {
    const stored = Number(localStorage.getItem(DRAWER_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) setWidth(clampDrawerWidth(stored, window.innerWidth));
  }, []);

  function remember(shell: HTMLElement, next: number) {
    setWidth(next);
    localStorage.setItem(DRAWER_WIDTH_KEY, String(next));
    shell.dataset.drawerWidth = String(next);
  }

  return (
    <div
      className="drawer-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={DRAWER_MIN}
      aria-valuemax={DRAWER_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const shell = shellOf(event.currentTarget);
        if (!shell) return;
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? 24 : -24;
        remember(shell, writeWidth(shell, readWidth(shell) + delta));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const handle = event.currentTarget;
        const shell = shellOf(handle);
        const stage = stageOf(handle);
        if (!shell || !stage) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        shell.classList.add("drawer-resizing");
        const move = (pointer: PointerEvent) => {
          const next = writeWidth(shell, stage.getBoundingClientRect().right - pointer.clientX);
          setWidth(next);
        };
        const end = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("pointercancel", end);
          shell.classList.remove("drawer-resizing");
          remember(shell, readWidth(shell));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      }}
    />
  );
}
