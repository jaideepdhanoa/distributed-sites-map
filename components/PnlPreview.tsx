"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import FinancialsPanel from "./FinancialsPanel";
import { sampleStatement } from "@/lib/pnl/fixture";
import type { FinancialPanel } from "@/lib/financials";

const statement = sampleStatement();

const panel: FinancialPanel = {
  open: true,
  packageStatus: "Received",
  packageLine: "Sample package",
  packageHref: "",
  headline: { text: "$1,000,000", metric: "Revenue", claim: "Reported", packageLine: "Sample package" },
  figures: [{
    figure: "Revenue",
    period: "Latest",
    periodLabel: "2024",
    text: "$1,000,000",
    metric: "Revenue",
    claim: "Reported",
    sourceName: "Sample package",
    sourceHref: "",
    page: "4",
    recast: "Reported",
    state: "On file",
    since: "",
    why: "",
  }],
  bridge: [],
  ending: null,
  claims: [],
  checklist: [],
  listed: [],
  pnl: statement,
};

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
        {open ? <FinancialsPanel dealId="PIPE-LAS-9001" initial={panel} onClose={() => setOpen(false)} /> : null}
      </section>
    </main>
  );
}
