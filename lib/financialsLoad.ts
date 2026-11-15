import { panelFromDeal, panelFromStored, safePackageHref, type FinancialPanel } from "./financials";
import { readGeneratedOptional } from "./snapshot/read";
import type { DealProps } from "./types";

type FinancialFile = { sites?: Record<string, Record<string, unknown>> };

function financialFile(): FinancialFile | null {
  const payload = readGeneratedOptional("financials.json");
  if (!payload || typeof payload !== "object") return null;
  return payload as FinancialFile;
}

/** Package links only. The rest of the financials file stays on the signed-in panel. */
export function packageHrefMap(): Record<string, string> {
  try {
    const payload = financialFile();
    const out: Record<string, string> = {};
    for (const [id, row] of Object.entries(payload?.sites || {})) {
      const href = safePackageHref(typeof row?.packageHref === "string" ? row.packageHref : undefined, true);
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
  try {
    const stored = financialFile()?.sites?.[deal.deal_id];
    if (!stored) return panelFromDeal(deal);
    return panelFromStored(stored, true) || panelFromDeal(deal);
  } catch {
    return panelFromDeal(deal);
  }
}
