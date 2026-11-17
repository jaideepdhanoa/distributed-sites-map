import { POWER_RATING } from "./site";

/**
 * A Google Sheet cell holds 50,000 characters. These are the mirrored
 * columns whose API write cap is shorter than that. Postgres stores the
 * columns as text, so the cap is the write schema, not a varchar.
 * Comms summary is capped at 50,000 and is not in this list.
 * Observed sheet prose runs about 1,500 to 1,870 characters, which is
 * past the 300 and 400 character caps.
 */
export const SHEET_CELL_MAX = 50_000;

export type MirroredTextCap = {
  /** Tab the mirror writes. Site columns are on both Pipeline and Land Sites. */
  sheet: "Pipeline" | "Activity" | "Comms Log";
  header: string;
  field: string;
  max: number;
};

export const MIRRORED_TEXT_CAPS: readonly MirroredTextCap[] = [
  { sheet: "Pipeline", header: "Broker", field: "broker", max: 120 },
  { sheet: "Pipeline", header: "Next step", field: "notes", max: 400 },
  { sheet: "Pipeline", header: "Listing link", field: "listing_url", max: 400 },
  { sheet: "Pipeline", header: "Value basis", field: "county_value_basis", max: 300 },
  { sheet: "Pipeline", header: "Service area polygon", field: "service_area_polygon", max: 80 },
  { sheet: "Pipeline", header: "Land basis", field: "land_acres_basis", max: 500 },
  { sheet: "Pipeline", header: "AADT road", field: "trade_aadt_road", max: 500 },
  { sheet: "Pipeline", header: "Photo status", field: "photo_status", max: 40 },
  { sheet: "Pipeline", header: "Photos checked", field: "photos_checked", max: 40 },
  { sheet: "Pipeline", header: "Photo notes", field: "photo_notes", max: 400 },
  { sheet: "Pipeline", header: "Last checked live", field: "checked_live", max: 500 },
  { sheet: "Pipeline", header: "Power rating", field: POWER_RATING, max: 500 },
  { sheet: "Pipeline", header: "Power rating (derived)", field: "power_rating", max: 20 },
  { sheet: "Pipeline", header: "pwr_a_source_type", field: "cap_a_source", max: 500 },
  { sheet: "Pipeline", header: "pwr_a_as_of", field: "cap_a_as_of", max: 500 },
  { sheet: "Pipeline", header: "pwr_a_confidence", field: "cap_a_confidence", max: 500 },
  { sheet: "Pipeline", header: "pwr_b_feeder_id", field: "cap_b_feeder", max: 500 },
  { sheet: "Pipeline", header: "pwr_b_hosting_horizon", field: "cap_b_horizon", max: 500 },
  { sheet: "Pipeline", header: "pwr_b_source_type", field: "cap_b_source", max: 500 },
  { sheet: "Pipeline", header: "pwr_b_as_of", field: "cap_b_as_of", max: 500 },
  { sheet: "Pipeline", header: "pwr_b_confidence", field: "cap_b_confidence", max: 500 },
  { sheet: "Pipeline", header: "pwr_c_service_phase", field: "cap_c_phase", max: 500 },
  { sheet: "Pipeline", header: "pwr_c_source_type", field: "cap_c_source", max: 500 },
  { sheet: "Pipeline", header: "pwr_c_as_of", field: "cap_c_as_of", max: 500 },
  { sheet: "Pipeline", header: "pwr_c_confidence", field: "cap_c_confidence", max: 500 },
  { sheet: "Pipeline", header: "pwr_d_source_type", field: "cap_d_source", max: 500 },
  { sheet: "Pipeline", header: "pwr_d_as_of", field: "cap_d_as_of", max: 500 },
  { sheet: "Pipeline", header: "pwr_d_confidence", field: "cap_d_confidence", max: 500 },
  { sheet: "Activity", header: "Summary", field: "summary", max: 300 },
  { sheet: "Activity", header: "Source link", field: "source_link", max: 500 },
  { sheet: "Comms Log", header: "Date/time", field: "at", max: 40 },
  { sheet: "Comms Log", header: "Counterparty person", field: "person", max: 200 },
  { sheet: "Comms Log", header: "Counterparty firm", field: "firm", max: 200 },
  { sheet: "Comms Log", header: "Channel", field: "channel", max: 80 },
  { sheet: "Comms Log", header: "Subject", field: "subject", max: 2000 },
];
