"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import PnlOverlay from "./PnlOverlay";
import { sampleStatement } from "@/lib/pnl/fixture";

const statement = sampleStatement();

export default function PnlPreview() {
  const [open, setOpen] = useState(false);
  return (
    <main className="pnl-preview">
      <p className="eyebrow">Synthetic preview</p>
      <section className="key-strip packet" data-testid="pnl-preview">
        <h3 className="job">Attractiveness</h3>
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
      {open ? <PnlOverlay statement={statement} onClose={() => setOpen(false)} /> : null}
    </main>
  );
}
