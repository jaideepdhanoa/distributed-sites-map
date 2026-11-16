"use client";

import { useEffect, useState, type RefObject } from "react";

/** Cards when the viewport or the list pane is phone-width, including a zoomed desktop. */
export function useNarrowList(pane?: RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      const viewport = Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth);
      const paneWidth = pane?.current?.getBoundingClientRect().width ?? viewport;
      setNarrow(query.matches || viewport <= 767 || paneWidth <= 760);
    };
    apply();
    query.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    const observer = new ResizeObserver(apply);
    if (pane?.current) observer.observe(pane.current);
    return () => {
      query.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      observer.disconnect();
    };
  }, [pane]);
  return narrow;
}
