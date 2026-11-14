import fs from "node:fs";
import path from "node:path";
import { panelFromDeal, panelFromStored, safePackageHref, type FinancialPanel } from "./financials";
import type { DealProps } from "./types";

/** Package links only. The rest of the financials file stays on the signed-in panel. */
export function packageHrefMap(): Record<string, string> {
  const file = path.join(process.cwd(), "data", "generated", "financials.json");
  if (!fs.existsSync(file)) return {};
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as { sites?: Record<string, { packageHref?: string }> };
    const out: Record<string, string> = {};
    for (const [id, row] of Object.entries(payload.sites || {})) {
      const href = safePackageHref(row?.packageHref, true);
      if (href) out[id] = href;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadFinancialPanel(deal: DealProps, signedIn: boolean): FinancialPanel {
  const closed = panelFromDeal({ ...deal, financials_open: false });
  if (!signedIn || !deal.deal_id) return closed;
  const file = path.join(process.cwd(), "data", "generated", "financials.json");
  if (!fs.existsSync(file)) return panelFromDeal(deal);
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as { sites?: Record<string, Record<string, unknown>> };
    const stored = payload.sites?.[deal.deal_id];
    if (!stored) return panelFromDeal(deal);
    return panelFromStored(stored, true) || panelFromDeal(deal);
  } catch {
    return panelFromDeal(deal);
  }
}
