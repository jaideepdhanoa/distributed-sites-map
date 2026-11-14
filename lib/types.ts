export type SitePhoto = {
  role: string;
  source?: string;
  as_of?: string;
  file_id?: string;
  view_url?: string;
  caption?: string;
  attribution?: string;
  visibility?: string;
};

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
  also_known_as?: string;
  summary_why?: string;
  address: string;
  apn: string;
  coord_status: string;
  site_class: string;
  in_area: boolean;
  /** R-099 class. edge_legacy is "edge (not re-measured)" and still passes. */
  service_area_class?: "inside" | "near_0_5" | "near_5_10" | "outside" | "edge_legacy" | "unknown";
  service_area_distance_mi?: number | null;
  service_area_polygon?: string;
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
  cap_a_substation_mi?: number | null;
  cap_a_line_ft?: number | null;
  cap_a_source?: string | null;
  cap_a_as_of?: string | null;
  cap_a_confidence?: string | null;
  cap_b_feeder?: string | null;
  cap_b_frontage?: number | null;
  cap_b_nearby?: number | null;
  cap_b_horizon?: string | null;
  cap_b_source?: string | null;
  cap_b_as_of?: string | null;
  cap_b_confidence?: string | null;
  land_control: string;
  network_status: string | null;
  reconciliation_tier: string;
  second_review_verdict: string | null;
  serving_utility?: string;
  serving_utility_source?: string;
  owner_mail?: string;
  assessed_value_display?: string;
  full_cash_value_display?: string;
  last_sale_date?: string;
  last_sale_price_display?: string;
  year_built?: string;
  assessor_source?: string;
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
  /** Accepted stage that is not in the workbook yet. Names stay on the signed-in card. */
  stage_pending?: string;
  pipeline_id: string | null;
  land_only: boolean;
  on_land_tab: boolean;
  quarantine: boolean;
  flood_zone: string;
  zoning: string;
  zoning_source?: string;
  aadt_count?: string;
  aadt_road?: string;
  aadt_year?: string;
  aadt_source?: string;
  phone?: string;
  phone_source?: string;
  website?: string;
  website_source?: string;
  place_note?: string;
  place_note_source?: string;
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
  /** Workbook Folder column, copied from the linked deal. */
  folder_url?: string;
  research_sources?: string;
  research_note?: string;
  business_type?: string;
  evidence: string;
  operating: string;
  agreement: string;
  land_use?: string;
  lead_source?: string;
  county_url: string;
  street_view_url: string;
  photos?: SitePhoto[];
  photo_status?: string;
  photo_diligence_count?: number | null;
  photo_listing_count?: number | null;
  photos_checked?: string;
  photo_notes?: string;
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
  stage_group: "sourced" | "desk" | "financial" | "checks" | "close" | "contacted" | "later" | "dropped";
  /** Accepted stage that is not in the workbook yet. Names stay on the signed-in card. */
  stage_pending?: string;
  /** Knock-out rationale. Present only while Stage is not Dropped. */
  suggested_drop?: string;
  broker_contacted?: boolean;
  last_broker_contact?: string;
  lead_source?: string;
  broker: string;
  firm: string;
  listing_url: string;
  /** Workbook Folder column. Empty when the row has no site folder. */
  folder_url?: string;
  /** Signed-in package link. Absent unless the reader can see financials. */
  package_href?: string;
  street_view_url?: string;
  photos?: SitePhoto[];
  photo_status?: string;
  photo_diligence_count?: number | null;
  photo_listing_count?: number | null;
  photos_checked?: string;
  photo_notes?: string;
  listing_removed?: boolean;
  asking_price: number | null;
  asking_price_display: string | null;
  asking_price_source: string;
  next_step: string;
  universe_id: string;
  coord_status: string;
  miles_to_depot: number | null;
  /** Passes the location gate: inside, either Near band, or legacy edge. */
  in_area?: boolean;
  service_area_class?: "inside" | "near_0_5" | "near_5_10" | "outside" | "edge_legacy" | "unknown";
  service_area_distance_mi?: number | null;
  service_area_polygon?: string;
  listed: boolean;
  parcel_match?: string;
  parcel_acres?: number | null;
  source_line: string;
  source_kind?: string;
  business_type?: string;
  /** Derived at build time. Hidden until the C-stores filter is on. */
  is_c_store?: boolean;
  land_acres?: number | null;
  land_acres_basis?: "Verified" | "Estimated" | "Unknown" | "";
  open_land_sqft?: number | null;
  open_land_basis?: "Estimated" | "";
  checked_live?: string;
  stated_revenue?: number | null;
  stated_revenue_display?: string | null;
  stated_cash_flow?: number | null;
  stated_cash_flow_display?: string | null;
  figures_source?: string;
  figures_basis?: "Claimed" | "Documented" | "Verified" | "Unknown" | "";
  figures_status?: "shown" | "withheld" | "vacant" | "absent";
  cash_flow_label?: string;
  package_status?: string;
  /** Broker-stated, Documented, Verified, or Normalized. */
  claim_word?: string;
  /** Package on file, Partial package, Package asked for, or blank. */
  package_line?: string;
  /** False for land, no business, and Financials status Not needed. */
  financials_open?: boolean;
  bays_that_fit?: number | null;
  trade_aadt?: number | null;
  trade_aadt_road?: string;
  trade_aadt_m?: number | null;
  trade_aadt_max?: number | null;
  trade_population?: number | null;
  trade_growth?: number | null;
  trade_income?: number | null;
  trade_washes_1mi?: number | null;
  trade_washes_3mi?: number | null;
  /** Deprecated grade. The map does not render it. */
  site_capacity?: string;
  cap_a_substation_mi?: number | null;
  cap_a_line_ft?: number | null;
  cap_a_source?: string | null;
  cap_a_as_of?: string | null;
  cap_a_confidence?: string | null;
  cap_b_feeder?: string | null;
  cap_b_frontage?: number | null;
  cap_b_nearby?: number | null;
  cap_b_horizon?: string | null;
  cap_b_source?: string | null;
  cap_b_as_of?: string | null;
  cap_b_confidence?: string | null;
  cap_c_amps?: number | null;
  cap_c_volts?: number | null;
  cap_c_phase?: string | null;
  cap_c_panels?: number | null;
  cap_c_source?: string | null;
  cap_c_as_of?: string | null;
  cap_c_confidence?: string | null;
  cap_d_peak?: number | null;
  cap_d_year?: number | null;
  cap_d_source?: string | null;
  cap_d_as_of?: string | null;
  cap_d_confidence?: string | null;
  price_per_acre?: number | null;
  price_per_acre_display?: string | null;
  cash_multiple?: number | null;
  cash_multiple_display?: string | null;
  revenue_basis?: string;
  revenue_period?: string;
  earnings_basis?: string;
  earnings_period?: string;
  county_value?: number | null;
  county_value_display?: string | null;
  county_value_basis?: string;
  land_estimate?: number | null;
  land_estimate_display?: string | null;
  land_estimate_basis?: string;
  land_estimate_tip?: string;
  land_estimate_reason?: string;
  business_value_reason?: string;
  revenue_multiple_reason?: string;
  earnings_multiple_reason?: string;
  business_multiple_reason?: string;
  comp_median_per_acre?: number | null;
  comp_median_tip?: string;
  comp_count?: number | null;
  business_value?: number | null;
  business_value_display?: string | null;
  revenue_multiple?: number | null;
  revenue_multiple_display?: string;
  revenue_multiple_basis?: string;
  earnings_multiple?: number | null;
  earnings_multiple_display?: string;
  earnings_multiple_basis?: string;
  earnings_multiple_which?: string;
  business_multiple?: number | null;
  business_multiple_display?: string;
  business_multiple_basis?: string;
  pricing_eligible?: boolean;
  access_notes?: string;
  score?: number | null;
  /** Workbook Location points cell. Not recomputed from the service-area class. */
  location_points?: number | null;
  apn?: string;
  /** Site mirror of NDA Register. Blank ID means Not required. */
  nda_id?: string;
  nda_status?: string;
  nda_waiting_on?: string;
  nda_gates?: string;
  nda_days_open?: number | null;
  nda_days_in_court?: number | null;
  /** Typed stage blocker. "—" means the stage is not blocked. */
  stage_blocker?: string;
  stage_blocker_since?: string;
};

export type UnscreenedProps = {
  listing_id: string;
  city: string;
  name: string;
  address: string;
  kind: "Listing" | "Land";
  asking_price_display: string | null;
  asking_price_source: string;
  acres: number | null;
  acres_text: string;
  listing_url: string;
  pinned: boolean;
  approximate: boolean;
};

export type UnscreenedFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] } | null;
  properties: UnscreenedProps;
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
    workbook_as_of?: string;
    stages: FunnelStage[];
  };
};

export type GeoFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
};
