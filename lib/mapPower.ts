import { cleanFactText, type CapacityRecord } from "./keyNumbers";
import { explicitMw, lineVolts, phaseKind, serviceAmps } from "./score/power-rating";

export type ServiceFilter = "all" | "broker" | "documented" | "unknown";
export type HostingFilter = "all" | "with" | "without";
type Reading = CapacityRecord & { folder_url?: string };
export const serviceFilters: Record<ServiceFilter, string> = {
  all: "All service records", broker: "Broker reported", documented: "Documented service", unknown: "Service unknown",
};
export const hostingFilters: Record<HostingFilter, string> = {
  all: "Any utility coverage", with: "Estimate on file", without: "No estimate on file",
};

function numeric(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function source(value: unknown) {
  const raw = String(value || "").trim();
  const href = /^https:\/\/[^\s]+$/i.test(raw) ? raw : "";
  return { label: cleanFactText(raw) || (href ? "Source document" : ""), href };
}

function propertyReading(row: Reading) {
  const amps = serviceAmps(row.cap_c_amps);
  const volts = lineVolts(row.cap_c_volts);
  const phase = phaseKind(row.cap_c_phase);
  const panels = numeric(row.cap_c_panels);
  const statedMw = explicitMw(row.cap_c_amps) ?? explicitMw(row.cap_c_volts) ?? explicitMw(row.cap_c_phase);
  const evidence = source(row.cap_c_source);
  const verified = String(row.cap_c_confidence).toLowerCase() === "verified";
  const utilityStudy = /will[- ]serve|capacity study|load study|utility letter/i.test(evidence.label);
  const available = verified && utilityStudy && /available|spare|additional load|charging headroom/i.test([evidence.label,row.cap_c_amps,row.cap_c_volts,row.cap_c_phase].join(" ")) && statedMw != null && statedMw >= 0 ? statedMw : null;
  const facts = [amps != null ? amps.toLocaleString()+" A" : "", volts != null ? volts+" V" : "",
    phase === "three" ? "3-phase" : phase === "single" ? "Single-phase" : "",
    panels != null ? panels+" "+(panels === 1 ? "panel" : "panels") : "",
    statedMw != null && statedMw >= 0 ? statedMw+" MW stated" : ""].filter(Boolean);
  if (!facts.length) return null;
  const broker = /\bbroker\b/i.test(evidence.label);
  const documented = verified && Boolean(evidence.href || /bill|photo|nameplate|panel label|permit|one.line|engineering|electrician|study|letter|will[- ]serve/i.test(evidence.label));
  return { amps, volts, phase, panels, statedMw, available, facts:facts.join(" · "), broker, documented, evidence,
    status:documented ? "Documented service" : broker ? "Broker reported" : verified && evidence.label ? "Verified reading" : "Recorded service",
    date:row.cap_c_as_of || "", confidence:row.cap_c_confidence || "", folder:row.folder_url || "" };
}

function hostingReading(row: Reading) {
  const frontage = numeric(row.cap_b_frontage), nearby = numeric(row.cap_b_nearby);
  if (frontage == null && nearby == null) return null;
  return { frontage, nearby, horizon:String(row.cap_b_horizon || ""), feeder:cleanFactText(row.cap_b_feeder),
    evidence:source(row.cap_b_source), date:row.cap_b_as_of || "", confidence:row.cap_b_confidence || "" };
}

function unique<T>(readings: (T | null)[]) {
  const seen = new Set<string>();
  return readings.filter((reading): reading is T => {
    if (!reading) return false;
    const key = JSON.stringify(reading);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mapPower(...inputs: (Reading | null | undefined)[]) {
  const rows = inputs.filter((r): r is Reading => Boolean(r));
  const service = unique(rows.map(propertyReading));
  const street = unique(rows.map(hostingReading));
  const distances = unique(rows.map(r => {
    const sub = numeric(r.cap_a_substation_mi), line = numeric(r.cap_a_line_ft);
    return sub == null && line == null ? null : { sub, line, source:source(r.cap_a_source), date:r.cap_a_as_of || "" };
  }));
  const load = unique(rows.map(r => {
    const peak = numeric(r.cap_d_peak), annual = numeric(r.cap_d_year);
    return peak == null && annual == null ? null : {peak, annual, source:source(r.cap_d_source), date:r.cap_d_as_of || ""};
  }));
  const differing = (["amps","volts","phase","panels","statedMw"] as const).some(key =>
    new Set(service.map(s => s[key]).filter(x => x != null && x !== "")).size > 1);
  const first = service[0];
  const next = differing ? "Reconcile the two service readings with a dated panel photo."
    : !first ? "Request the main panel label and service details."
    : first.available != null ? "Check the utility study’s conditions and service date."
    : first.amps == null ? "Get a photo of the main breaker label."
    : !first.volts || !first.phase ? "Confirm the service voltage and phase."
    : !load.some(r => r.peak != null) ? "Request a utility bill with peak demand."
    : "Confirm spare charging capacity with the utility.";
  return { service, street, distances, load, differing, next };
}

/** The matrix, record and citations retain the same linked readings as the pin. */
export function comparisonPower(...records: (Reading | undefined | null)[]) {
  const {service, street, differing} = mapPower(...records);
  const provenance = (r: (typeof service)[number] | (typeof street)[number]) =>
    [r.evidence.label || "Source not recorded", r.confidence, r.date].filter(Boolean).join(" · ");
  const readings = service.map(r => ({
    value: r.facts.replace(" MW stated", " MW"),
    source: provenance(r),
    complete: r.statedMw != null || (r.amps != null && r.volts != null && Boolean(r.phase)),
    verified: Boolean(r.evidence.label) && r.confidence.toLowerCase() === "verified",
  }));
  const values = [...new Set(readings.map(r => r.value))];
  const forecasts = street.filter(r => r.frontage != null);
  const forecastValues = forecasts.map(r => r.frontage!.toLocaleString() + " MW" + (r.horizon ? " · " + r.horizon + " estimate" : ""));
  const horizons = [...new Set(forecasts.map(r => r.horizon || "Forecast year unknown"))].sort().join(" / ");
  return {
    differing,
    service: readings.length ? {
      value: differing ? "Sources disagree" : values.join(" / "),
      source: readings.map(r => (readings.length > 1 ? r.value + " · " : "") + r.source).join(" / "),
      complete: readings.some(r => r.complete),
      verified: !differing && readings.some(r => r.complete && r.verified),
    } : undefined,
    frontage: forecasts.length ? {
      value: [...new Set(forecastValues)].join(" / "), basis: horizons,
      source: forecasts.map((r,i) => (forecasts.length > 1 ? forecastValues[i] + " · " : "") + provenance(r)).join(" / "),
    } : undefined,
  };
}

export function matchesMapPower(power: ReturnType<typeof mapPower>, service: ServiceFilter, hosting: HostingFilter) {
  const serviceMatch = service === "all" || (service === "unknown" ? !power.service.length : power.service.some(s => s[service]));
  return serviceMatch && (hosting === "all" || (hosting === "with") === Boolean(power.street.length));
}
