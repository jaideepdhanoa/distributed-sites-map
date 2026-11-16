import { stageKey } from "@/lib/stageOverlay";
import { CANONICAL_STAGES, MARKETS, SERVICE_AREA_CLASSES, type CanonicalStage, type Market, type ServiceAreaClass } from "./vocab";

const BY_KEY: Record<string, CanonicalStage> = {
  desk: "1 Desk screen",
  financial: "2 Financial screen",
  checks: "3 Site checks",
  close: "4 Offer and close",
  dropped: "Dropped",
};

/** Numbered workbook label. Unnumbered labels such as "Financial screen" map too. */
export function canonicalStageName(value: string): CanonicalStage | null {
  const raw = value.trim();
  if ((CANONICAL_STAGES as readonly string[]).includes(raw)) return raw as CanonicalStage;
  return BY_KEY[stageKey(raw)] || null;
}

export function marketCode(stored: string, siteId: string): Market | null {
  const fromRow = stored.trim().toUpperCase();
  if ((MARKETS as readonly string[]).includes(fromRow)) return fromRow as Market;
  const token = siteId.split("-")[1] || "";
  if ((MARKETS as readonly string[]).includes(token)) return token as Market;
  return null;
}

export function serviceAreaCode(stored: string): ServiceAreaClass | "" {
  const value = stored.trim();
  if ((SERVICE_AREA_CLASSES as readonly string[]).includes(value)) return value as ServiceAreaClass;
  return "";
}
