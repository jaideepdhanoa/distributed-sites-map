"use client";

import { useEffect } from "react";

const PIN =
  "M32 6.5C22.6 6.5 15 14 15 23.2C15 35.2 32 58 32 58C32 58 49 35.2 49 23.2C49 14 41.4 6.5 32 6.5Z";
const MONOGRAM =
  "M29.39 28.4H25.16V16.4H29.43Q31.23 16.4 32.53 17.12Q33.83 17.84 34.53 19.18Q35.23 20.52 35.23 22.39Q35.23 24.27 34.53 25.61Q33.83 26.96 32.52 27.68Q31.21 28.4 29.39 28.4ZM27.62 26.28H29.26Q31 26.28 31.89 25.35Q32.79 24.41 32.79 22.39Q32.79 20.38 31.89 19.45Q31 18.52 29.28 18.52H27.62Z M38.84 16.4V28.4H36.38V16.4Z";

export default function Wordmark({
  level = "h1",
  view,
}: {
  level?: "h1" | "p";
  view?: "map" | "list";
}) {
  useEffect(() => {
    if (!view) return;
    document.title = `${view === "list" ? "List" : "Map"} · Distributed Sites`;
  }, [view]);

  const Tag = level;
  return (
    <Tag className="word">
      <span className="mark" aria-hidden="true">
        <svg viewBox="14 5 36 54">
          <path fill="#1e4636" d={PIN} />
          <path fill="#f3efe6" d={MONOGRAM} />
        </svg>
      </span>
      <span className="name">
        Distributed <br className="compact-break" />Sites
      </span>
    </Tag>
  );
}
