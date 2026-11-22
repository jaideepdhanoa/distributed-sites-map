"use client";

import { aerialTile } from "@/lib/aerial";

export default function AerialThumb({ lat, lng }: { lat?: number | null; lng?: number | null }) {
  const tile = aerialTile(lat, lng);
  if (!tile) return null;
  return (
    <figure className="aerial-thumb" data-testid="aerial-thumb">
      <img src={tile.url} alt="" style={{ left: tile.left, top: tile.top }} />
      <figcaption>Esri</figcaption>
    </figure>
  );
}
