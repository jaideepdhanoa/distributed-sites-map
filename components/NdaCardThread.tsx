"use client";

import CommentThread from "./comments/CommentThread";
import { ndaAnchor } from "@/lib/comments/anchor";

export default function NdaCardThread({ ndaId, onOpen }: { ndaId: string; onOpen: (id: string) => void }) {
  if (!ndaId) return null;
  return (
    <section className="nda-site-thread" data-testid="nda-site-thread">
      <CommentThread siteId={ndaId} anchor={ndaAnchor(ndaId)} variant="inline" source="NDA" compact />
      <button type="button" className="text-link" data-testid="nda-view-all" onClick={() => onOpen(ndaId)}>View all in NDA</button>
    </section>
  );
}
