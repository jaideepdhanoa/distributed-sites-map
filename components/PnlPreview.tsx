"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import { suggestBrokerQuestion, type CommentAnchor } from "@/lib/comments/anchor";
import PnlOverlay from "./PnlOverlay";
import CommentChip from "./comments/CommentChip";
import type { ThreadNote } from "./comments/CommentThread";
import { sampleStatement } from "@/lib/pnl/fixture";

const statement = sampleStatement();
const SITE = "PIPE-LAS-9001";
const cellAnchor: CommentAnchor = { type: "pnl_cell", siteId: SITE, line: "ga", period: "2023", spaceId: "", label: "" };
const lotAnchor: CommentAnchor = { type: "space", siteId: SITE, line: "", period: "", spaceId: "SS-000001", label: "Excess parking" };
const previewNotes: ThreadNote[] = [{
  id: "NT-000001",
  parentId: null,
  body: "The sample line needs a second look.",
  authorId: "reviewer",
  createdAt: "2026-03-01T15:00:00-07:00",
  resolvedAt: null,
  anchor: { ...cellAnchor, line: "labor", period: "2024" },
  tag: "ask_broker",
  version: 1,
  brokerQuestion: suggestBrokerQuestion({ ...cellAnchor, line: "labor", period: "2024" }),
}];

export default function PnlPreview() {
  const [open, setOpen] = useState(false);
  return (
    <main className="pnl-preview">
      <p className="eyebrow">Synthetic preview</p>
      <section className="key-strip packet" data-testid="pnl-preview">
        <h3 className="job">Attractiveness</h3>
        <div className="act-row">
          <CommentChip anchor={cellAnchor} />
          <CommentChip anchor={lotAnchor} />
        </div>
        <div className="metrics">
          <article className="wide">
            <button type="button" className="fin-tile" data-testid="preview-revenue" onClick={() => setOpen(true)}>
              <span><Banknote size={15} strokeWidth={1.75} aria-hidden="true" /> Revenue</span>
              <strong>$1,000,000</strong>
              <small>2024 · Sample package</small>
              <em>Reported</em>
            </button>
          </article>
        </div>
        <p className="pnl-note">Sample wash. These figures are not a site.</p>
      </section>
      {open ? (
        <PnlOverlay
          statement={statement}
          siteId={SITE}
          comments={[{ type: "pnl_cell", line: "labor", period: "2024" }, { type: "pnl_line", line: "chemicals", period: "" }]}
          focus={{ type: "pnl_cell", line: "labor", period: "2024" }}
          previewNotes={previewNotes}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </main>
  );
}
