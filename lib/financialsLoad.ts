import fs from "node:fs";
import path from "node:path";
import { panelFromDeal, panelFromStored, type FinancialPanel } from "./financials";
import type { DealProps } from "./types";

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
