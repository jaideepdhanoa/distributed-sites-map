"use client";

import { useLayoutEffect } from "react";

function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select")));
}

/** Capture Ctrl+K, Cmd+K, and / before the browser address bar, including while Ask is focused. */
function onKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const command = (event.metaKey || event.ctrlKey) && (key === "k" || event.code === "KeyK");
  const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target);
  if (!command && !slash) return;
  event.preventDefault();
  event.stopPropagation();
  window.dispatchEvent(new Event("sites-open-command"));
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", onKey, true);
}

export default function CommandHotkey() {
  useLayoutEffect(() => {
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return null;
}
