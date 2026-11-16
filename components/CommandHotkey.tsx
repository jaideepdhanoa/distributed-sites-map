"use client";

import { useLayoutEffect } from "react";

/** Capture Ctrl+K and Cmd+K before the browser address bar, including while Ask is focused. */
export default function CommandHotkey() {
  useLayoutEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "k" && event.code !== "KeyK") return;
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new Event("sites-open-command"));
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return null;
}
