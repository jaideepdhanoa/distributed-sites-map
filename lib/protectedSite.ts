import { isExcludedSite } from "./alerts/excluded";

/** The quarantined pipeline row. It is never shown and never linked. */
export function isProtectedId(id: string | null | undefined): boolean {
  return isExcludedSite(id);
}

type DealFeature = { properties?: { deal_id?: string | null } | null };
type SiteFeature = {
  properties?: {
    site_id?: string | null;
    linked_deal_id?: string | null;
    linked_deal_ids?: string[] | null;
  } | null;
};

export function omitProtectedDeals<T extends DealFeature>(features: T[]): T[] {
  return features.filter((feature) => !isProtectedId(feature.properties?.deal_id));
}

export function omitProtectedSites<T extends SiteFeature>(features: T[]): T[] {
  return features.filter((feature) => {
    const props = feature.properties;
    if (!props) return true;
    if (isProtectedId(props.site_id) || isProtectedId(props.linked_deal_id)) return false;
    return !props.linked_deal_ids?.some((id) => isProtectedId(id));
  });
}
