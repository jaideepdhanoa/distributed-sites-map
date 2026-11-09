"use client";

import { useEffect } from "react";
import { PREVIEW_CHROME_SELECTOR, applyPreviewChrome, type ChromeBox } from "@/lib/previewChrome";

function readBox(): ChromeBox {
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const shell = document.querySelector(".shell");
  const drawer = document.querySelector("aside.drawer");
  const rect = drawer?.getBoundingClientRect();
  const open = Boolean(shell?.classList.contains("drawer-open"));
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    drawerLeft: open && rect ? rect.left : null,
    drawerTop: open && rect ? rect.top : null,
    phone,
    abovePeek: Boolean(open && phone && shell && !shell.classList.contains("sheet-peek")),
  };
}

export default function PreviewChrome() {
  useEffect(() => {
    const run = () => {
      const box = readBox();
      document.querySelectorAll(PREVIEW_CHROME_SELECTOR).forEach((node) => {
        if (node instanceof HTMLElement) applyPreviewChrome(node, box);
      });
    };
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
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
