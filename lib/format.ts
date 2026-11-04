import type { DealProps } from "./types";

const LISTING_SITES = /\b(bizbuysell|loopnet|crexi|realmo|carwashbrokers|matthews)\b/i;

export function formatRecordedDate(value?: string | null) {
  const text = (value || "").trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text;
}

/** A removed name can leave a bare "'s" in a note. */
export function cleanNote(value?: string | null) {
  return (value || "").replace(/(?<![A-Za-z])'s\b/g, "").replace(/\s{2,}/g, " ").trim();
}

export function isListingSite(value?: string | null) {
  return LISTING_SITES.test(value || "");
}

export function shownBroker(deal: DealProps) {
  if (!deal.broker || isListingSite(deal.broker)) return "";
  return deal.broker;
}

export function shownFirm(deal: DealProps) {
  if (!deal.firm || /^not shown$/i.test(deal.firm)) return "";
  if (isListingSite(deal.firm) && !deal.broker) return "";
  return deal.firm;
}

export function shownPriceSource(deal: DealProps) {
  const source = (deal.asking_price_source || "").trim();
  if (source && !/^not shown$/i.test(source)) return source;
  if (deal.source_line && !/^not shown$/i.test(deal.source_line)) return deal.source_line;
  if (isListingSite(deal.broker)) return deal.broker;
  if (shownFirm(deal)) return shownFirm(deal);
  return "";
}
