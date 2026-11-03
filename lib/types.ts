export type FieldDot = { status: string; source: string; date: string };

export type Review = {
  reviewer: string;
  kind: string;
  verdict: string | null;
  provisional?: boolean;
  spare_ac_own: number | null;
  spare_ac_adjoining: number | null;
  confidence: string;
  date: string;
  note: string;
  tier_label?: string;
};

export type SiteProps = {
  site_id: string;
  city: string;
  name: string;
  address: string;
  apn: string;
  coord_status: string;
  site_class: string;
  in_area: boolean;
  service_ring: string;
  expansion_horizon: boolean;
  duplicate_of: string | null;
  counts_as_site: boolean;
  lot_ac: number | null;
  owner: string;
  tenure: string;
  spare_ac_own: number | null;
  spare_ac_own_text: string;
  spare_ac_adjoining: number | null;
  spare_ac_adjoining_text: string;
  verdict: string | null;
  land_tier: "L10" | "L4" | null;
  land_control: string;
  network_status: string | null;
  reconciliation_tier: string;
  muse_verdict: string | null;
  verdict_disagreement: boolean;
  acreage_note: string;
  scale_note: string;
  confidence: string;
  listed: boolean;
  contacted: boolean;
  asking_price: number | null;
  asking_price_display: string | null;
  asking_price_source: string;
  asking_price_url: string;
  asking_price_date: string;
  asking_price_status: string | null;
  pipeline_stage: string | null;
  pipeline_id: string | null;
  land_only: boolean;
  on_land_tab: boolean;
  quarantine: boolean;
  flood_zone: string;
  zoning: string;
  tank_status: string;
  utility_proximity: string;
  aerial_fit: string;
  verification: string;
  elimination_reason: string;
  tenure_fail: boolean;
  is_held_fit: boolean;
  tier_from_adjoining: boolean;
  is_candidate: boolean;
  miles_to_depot: number | null;
  linked_deal_id?: string;
  linked_deal_name?: string;
  linked_deal_stage?: string;
  parcel_match?: string;
  parcel_acres?: number | null;
  lot_ac_source?: string;
  listing_url?: string;
  research_sources?: string;
  research_note?: string;
  evidence: string;
  operating: string;
  agreement: string;
  county_url: string;
  street_view_url: string;
  why_stopped: string;
  fields: Record<string, FieldDot>;
  reviews: Review[];
  origin: string;
};

export type DealProps = {
  deal_id: string;
  kind: "pipeline" | "land";
  name: string;
  address: string;
  city: string;
  stage: string;
  stage_group: "sourced" | "desk" | "contacted" | "later" | "dropped";
  broker: string;
  firm: string;
  listing_url: string;
  asking_price: number | null;
  asking_price_display: string | null;
  asking_price_source: string;
  next_step: string;
  universe_id: string;
  coord_status: string;
  miles_to_depot: number | null;
  listed: boolean;
  parcel_match?: string;
  parcel_acres?: number | null;
  source_line: string;
  source_kind?: string;
};

export type DealFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] } | null;
  properties: DealProps;
};

export type SiteFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] } | null;
  properties: SiteProps;
};

export type FunnelStage = {
  id: string;
  name: string;
  unit: string;
  total: number;
  by_city?: Record<string, number>;
  note?: string;
  L10?: { total: number; by_city: Record<string, number>; county_checked: number };
  L4?: { total: number; by_city: Record<string, number>; county_checked: number };
  eliminated_not_a_wash?: { total: number; by_reason: Record<string, number> };
  held_fits?: { total: number; L10: number; L4: number };
  county_checked?: number;
  pending?: number;
  outcomes?: Record<string, { total: number; by_city: Record<string, number> }>;
  of?: number;
  pipeline_any?: number;
};

export type AppData = {
  sites: { type: "FeatureCollection"; features: SiteFeature[] };
  areas: { type: "FeatureCollection"; features: GeoFeature[] };
  depots: { type: "FeatureCollection"; features: GeoFeature[] };
  parcels: { type: "FeatureCollection"; features: GeoFeature[] };
  deals: { type: "FeatureCollection"; features: DealFeature[] };
  funnel: {
    generated_at: string;
    muse_reference: { in_area_sites: number; by_city: Record<string, number>; note: string };
    stages: FunnelStage[];
  };
};

export type GeoFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
};
