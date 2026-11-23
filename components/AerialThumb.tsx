"use client";

import { aerialTile } from "@/lib/aerial";

export default function AerialThumb({ lat, lng, compact = false }: { lat?: number | null; lng?: number | null; compact?: boolean }) {
  const frame = aerialTile(lat, lng);
  if (!frame) return null;
  return (
    <figure className={compact ? "aerial-thumb compact" : "aerial-thumb"} data-testid="aerial-thumb" data-compact={compact ? "1" : "0"}>
      <img src={frame.url} alt="" />
      <figcaption>Esri</figcaption>
    </figure>
  );
}
