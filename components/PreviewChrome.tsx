"use client";

import { useEffect } from "react";
import { PREVIEW_CHROME_SELECTOR, applyPreviewChrome, commentButtonCovered, type ChromeBox } from "@/lib/previewChrome";

function readBox(): ChromeBox {
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const shell = document.querySelector(".shell");
  const drawer = document.querySelector("aside.drawer");
  const rect = drawer?.getBoundingClientRect();
  const open = Boolean(shell?.classList.contains("drawer-open"));
  const covered = shell ? commentButtonCovered({
    phone,
    drawerOpen: open,
    filtersOpen: shell.classList.contains("filters-open"),
    listOpen: shell.classList.contains("list-open"),
    stepsOpen: shell.classList.contains("steps-open"),
    tableOpen: shell.classList.contains("table-open"),
    layersOpen: Boolean(document.querySelector("aside.layers.open")),
    menuOpen: Boolean(document.querySelector(".menu-sheet")),
    popoverOpen: Boolean(document.querySelector(".popover")),
    ndaOpen: shell.classList.contains("nda-open"),
    loopsOpen: shell.classList.contains("loops-open"),
  }) : false;
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    drawerLeft: open && rect ? rect.left : null,
    drawerTop: open && rect ? rect.top : null,
    phone,
    abovePeek: Boolean(open && phone && shell && !shell.classList.contains("sheet-peek")),
    covered,
  };
}

export default function PreviewChrome() {
  useEffect(() => {
    let watchedShell = false;
    const run = () => {
      const box = readBox();
      document.querySelectorAll(PREVIEW_CHROME_SELECTOR).forEach((node) => {
        if (node instanceof HTMLElement) applyPreviewChrome(node, box);
      });
      if (watchedShell) return;
      const shell = document.querySelector(".shell");
      if (!shell) return;
      watchedShell = true;
      observer.observe(shell, { attributes: true, attributeFilter: ["class"] });
      const layers = document.querySelector("aside.layers");
      if (layers) observer.observe(layers, { attributes: true, attributeFilter: ["class"] });
    };
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    run();
    window.addEventListener("resize", run);
    const timer = window.setInterval(run, 500);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", run);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
