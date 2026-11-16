/** Chart of accounts for a captured car-wash or auto-service P&L. */

export const PNL_LINE_CODES = [
  "revenue_wash",
  "revenue_membership",
  "revenue_retail",
  "revenue_service",
  "revenue_parts",
  "revenue_other",
  "revenue",
  "cogs",
  "labor",
  "utilities",
  "chemicals",
  "occupancy",
  "repairs",
  "marketing",
  "ga",
  "other",
  "ebitda",
  "noi",
  "addback_owner_pay",
  "addback_personal",
  "addback_one_time",
  "addback_other",
] as const;

export type PnlLineCode = (typeof PNL_LINE_CODES)[number];

export const BUSINESS_TYPES = ["car_wash", "auto_service"] as const;

export type PnlBusiness = (typeof BUSINESS_TYPES)[number];

export const LINE_LABELS: Record<PnlLineCode, string> = {
  revenue_wash: "Wash revenue",
  revenue_membership: "Membership revenue",
  revenue_retail: "Retail revenue",
  revenue_service: "Service revenue",
  revenue_parts: "Parts revenue",
  revenue_other: "Other revenue",
  revenue: "Revenue",
  cogs: "COGS",
  labor: "Labor",
  utilities: "Utilities",
  chemicals: "Chemicals",
  occupancy: "Rent and occupancy",
  repairs: "Repairs",
  marketing: "Marketing",
  ga: "G&A",
  other: "Other",
  ebitda: "EBITDA",
  noi: "NOI",
  addback_owner_pay: "Owner pay",
  addback_personal: "Personal expenses",
  addback_one_time: "One-time items",
  addback_other: "Other add-backs",
};

export const BUSINESS_LABELS: Record<PnlBusiness, string> = {
  car_wash: "Car wash",
  auto_service: "Auto service",
};

const REVENUE_LINES: readonly PnlLineCode[] = [
  "revenue_wash",
  "revenue_membership",
  "revenue_retail",
  "revenue_service",
  "revenue_parts",
  "revenue_other",
  "revenue",
];

const COST_LINES: readonly PnlLineCode[] = [
  "cogs",
  "labor",
  "utilities",
  "chemicals",
  "occupancy",
  "repairs",
  "marketing",
  "ga",
  "other",
];

const RESULT_LINES: readonly PnlLineCode[] = ["ebitda", "noi"];

const ADDBACK_LINES: readonly PnlLineCode[] = [
  "addback_owner_pay",
  "addback_personal",
  "addback_one_time",
  "addback_other",
];

export type PnlSection = "revenue" | "costs" | "results" | "addbacks";

export function lineSection(code: PnlLineCode): PnlSection {
  if ((REVENUE_LINES as readonly string[]).includes(code)) return "revenue";
  if ((COST_LINES as readonly string[]).includes(code)) return "costs";
  if ((RESULT_LINES as readonly string[]).includes(code)) return "results";
  return "addbacks";
}

export function sectionOrder(section: PnlSection): readonly PnlLineCode[] {
  if (section === "revenue") return REVENUE_LINES;
  if (section === "costs") return COST_LINES;
  if (section === "results") return RESULT_LINES;
  return ADDBACK_LINES;
}

export function isPnlLineCode(value: string): value is PnlLineCode {
  return (PNL_LINE_CODES as readonly string[]).includes(value);
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
