/**
 * Structured chips. A chip is a fixed code, a label, and one color tone.
 * Pine is confirmed or clear. Brass is in progress or waiting. Sky is
 * unconfirmed. Sand is stopped or a problem. Stage stays on site_stages.
 */

export const TONES = ["pine", "brass", "sky", "sand"] as const;
export type TagTone = (typeof TONES)[number];

export const OWNING_ROLES = ["muse", "indie", "reviewer", "capture"] as const;
export type OwningRole = (typeof OWNING_ROLES)[number];

export type TagCode = {
  code: string;
  label: string;
  tone: TagTone;
  help: string;
};

export type TagFamily = {
  family: string;
  title: string;
  owning: OwningRole;
  /** Signed-out readers never receive this family. */
  signedIn?: boolean;
  /** Column id on the pipeline sheet. Stage and NDA reuse their columns. */
  column?: string;
  codes: TagCode[];
};

const diligence = (help: string): TagCode[] => [
  { code: "verified", label: "Verified", tone: "pine", help },
  { code: "claimed", label: "Claimed", tone: "brass", help },
  { code: "estimated", label: "Estimated", tone: "sky", help },
  { code: "unknown", label: "Unknown", tone: "sky", help },
  { code: "problem", label: "Problem", tone: "sand", help },
];

export const TAG_FAMILIES: TagFamily[] = [
  {
    family: "waiting_on",
    title: "Waiting on",
    owning: "muse",
    column: "chip_waiting",
    codes: [
      { code: "broker_reply", label: "Broker reply", tone: "brass", help: "Waiting on a reply from the broker." },
      { code: "we_owe", label: "Us/we owe a reply", tone: "brass", help: "A reply is owed from our side." },
      { code: "nda_execution", label: "NDA execution", tone: "brass", help: "The stage is waiting on the NDA." },
      { code: "our_diligence", label: "Our-side diligence", tone: "brass", help: "The stage is waiting on our own checks." },
      { code: "nothing", label: "nothing", tone: "pine", help: "Nothing is blocking the stage." },
    ],
  },
  {
    family: "drop_reason",
    title: "Drop reason",
    owning: "reviewer",
    column: "chip_drop",
    codes: [
      { code: "lot_too_small", label: "Lot too small", tone: "sand", help: "The lot cannot fit the layout." },
      { code: "no_longer_for_sale", label: "No longer for sale", tone: "sand", help: "The seller took it off the market." },
      { code: "outside_service_area", label: "Outside service area", tone: "sand", help: "The site is outside the service area." },
      { code: "business_not_operating", label: "Business not operating", tone: "sand", help: "The business is not operating." },
      { code: "outside_markets", label: "Outside our markets", tone: "sand", help: "The site is outside the markets we cover." },
      { code: "tenant_lease", label: "Tenant lease", tone: "sand", help: "A tenant lease ties up the site." },
      { code: "price_vs_value", label: "Price vs value", tone: "sand", help: "The price does not match the value." },
      { code: "sold_to_another", label: "Sold to another buyer", tone: "sand", help: "Another buyer took the site." },
      { code: "duplicate", label: "Duplicate", tone: "sand", help: "The site repeats one we already have." },
      { code: "numbers_dont_work", label: "Numbers don't work", tone: "sand", help: "The numbers do not clear the screen." },
    ],
  },
  {
    family: "advance_reason",
    title: "Advance reason",
    owning: "reviewer",
    column: "chip_advance",
    codes: [
      { code: "package_received", label: "Package received", tone: "pine", help: "The package is in hand." },
      { code: "numbers_clear", label: "Numbers clear the screen", tone: "pine", help: "The numbers clear the screen." },
      { code: "land_verified", label: "Land verified", tone: "pine", help: "The land check is verified." },
      { code: "power_confirmed", label: "Power confirmed", tone: "pine", help: "Power is confirmed." },
      { code: "broker_engaged", label: "Broker engaged", tone: "pine", help: "A broker is engaged." },
    ],
  },
  { family: "diligence_price", title: "Price check", owning: "capture", column: "chip_price", codes: diligence("Price check.") },
  { family: "diligence_financials", title: "Financials check", owning: "capture", column: "chip_financials", codes: diligence("Financials check.") },
  { family: "diligence_land", title: "Land check", owning: "capture", column: "chip_land", codes: diligence("Land check.") },
  { family: "diligence_power", title: "Power check", owning: "capture", column: "chip_power", codes: diligence("Power check.") },
  { family: "diligence_zoning", title: "Zoning check", owning: "capture", column: "chip_zoning", codes: diligence("Zoning check.") },
  { family: "diligence_title", title: "Title check", owning: "capture", column: "chip_title", codes: diligence("Title check.") },
  { family: "diligence_environmental", title: "Environmental check", owning: "capture", column: "chip_environmental", codes: diligence("Environmental check.") },
  {
    family: "biggest_gap",
    title: "Biggest gap",
    owning: "muse",
    column: "chip_gap",
    codes: [
      { code: "spare_land", label: "Spare land", tone: "brass", help: "Spare land is the open question." },
      { code: "power", label: "Power", tone: "brass", help: "Power is the open question." },
      { code: "financials", label: "Financials", tone: "brass", help: "Financials are the open question." },
      { code: "lease_tenure", label: "Lease or tenure", tone: "brass", help: "Lease or tenure is the open question." },
      { code: "zoning", label: "Zoning", tone: "brass", help: "Zoning is the open question." },
      { code: "title", label: "Title", tone: "brass", help: "Title is the open question." },
      { code: "address", label: "Address", tone: "brass", help: "The address is the open question." },
      { code: "price", label: "Price", tone: "brass", help: "Price is the open question." },
      { code: "business_identity", label: "Business identity", tone: "brass", help: "The business identity is the open question." },
    ],
  },
  {
    family: "next_action",
    title: "Next action",
    owning: "muse",
    column: "chip_next",
    codes: [
      { code: "follow_up", label: "Follow up with broker", tone: "brass", help: "Follow up with the broker." },
      { code: "request_package", label: "Request package", tone: "brass", help: "Ask for the package." },
      { code: "get_nda_signed", label: "Get NDA signed", tone: "brass", help: "Get the NDA signed." },
      { code: "measure_land", label: "Measure land", tone: "brass", help: "Measure the land." },
      { code: "check_power", label: "Check power", tone: "brass", help: "Check power." },
      { code: "review_financials", label: "Review financials", tone: "brass", help: "Review the financials." },
      { code: "decide", label: "Decide", tone: "brass", help: "Make the decision." },
    ],
  },
  {
    family: "package",
    title: "Package",
    owning: "muse",
    column: "chip_package",
    codes: [
      { code: "none", label: "None", tone: "sky", help: "No package is on file." },
      { code: "received", label: "Received", tone: "pine", help: "The package was received." },
      { code: "refused", label: "Refused or unavailable", tone: "sand", help: "The package was refused or is unavailable." },
    ],
  },
  {
    family: "nda",
    title: "NDA",
    owning: "muse",
    signedIn: true,
    codes: [
      { code: "not_required", label: "Not required", tone: "pine", help: "No NDA is required." },
      { code: "moove_sent", label: "Moove form sent", tone: "brass", help: "The Moove form was sent." },
      { code: "their_legal", label: "With their legal", tone: "brass", help: "The NDA is with their legal team." },
      { code: "moove_legal", label: "With Moove legal", tone: "brass", help: "The NDA is with Moove legal." },
    ],
  },
  {
    family: "business_check",
    title: "Business check",
    owning: "capture",
    column: "chip_business",
    codes: [
      { code: "operating_confirmed", label: "Operating, address confirmed", tone: "pine", help: "The business is operating and the address is confirmed." },
      { code: "operating_after_nda", label: "Operating, address after NDA", tone: "brass", help: "The business is operating. The address waits on the NDA." },
      { code: "not_confirmed", label: "Not confirmed", tone: "sky", help: "Operating status is not confirmed." },
      { code: "not_operating", label: "Not operating", tone: "sand", help: "The business is not operating." },
    ],
  },
  {
    family: "listing",
    title: "Listing",
    owning: "muse",
    column: "chip_listing",
    codes: [
      { code: "off_market", label: "Off-market", tone: "sky", help: "The site is off-market." },
      { code: "listed", label: "Listed", tone: "pine", help: "The site is listed." },
      { code: "sold_withdrawn", label: "Sold or withdrawn", tone: "sand", help: "The listing was sold or withdrawn." },
    ],
  },
  {
    family: "lead_source",
    title: "Lead source",
    owning: "muse",
    column: "chip_lead",
    codes: [
      { code: "off_market", label: "Off-market", tone: "sky", help: "We found the site ourselves." },
      { code: "broker", label: "Broker", tone: "brass", help: "A broker brought the site." },
      { code: "listing", label: "Listing", tone: "pine", help: "The site came from a listing." },
    ],
  },
  {
    family: "photos",
    title: "Photos",
    owning: "indie",
    column: "chip_photos",
    codes: [
      { code: "complete", label: "Complete", tone: "pine", help: "The photo set is complete." },
      { code: "deferred", label: "Deferred", tone: "sky", help: "Photos are deferred." },
      { code: "partial", label: "Partial", tone: "brass", help: "The photo set is partial." },
    ],
  },
];

const BY_FAMILY = new Map(TAG_FAMILIES.map((family) => [family.family, family]));

export function tagFamily(family: string): TagFamily | null {
  return BY_FAMILY.get(family) || null;
}

export function tagCode(family: string, code: string): TagCode | null {
  return tagFamily(family)?.codes.find((item) => item.code === code) || null;
}

export function tagByLabel(family: string, label: string): TagCode | null {
  const wanted = label.trim().toLowerCase();
  return tagFamily(family)?.codes.find((item) => item.label.toLowerCase() === wanted) || null;
}

export function columnFamily(columnId: string): TagFamily | null {
  if (columnId === "nda") return tagFamily("nda");
  return TAG_FAMILIES.find((family) => family.column === columnId) || null;
}

export const DILIGENCE_FAMILIES = TAG_FAMILIES.filter((family) => family.family.startsWith("diligence_")).map((family) => family.family);

export const HEADER_FAMILIES = ["waiting_on", "biggest_gap"] as const;

/** Quiet defaults stay in the grid and off the card section. */
export const SECTION_HIDDEN: Record<string, string[]> = {
  package: ["none"],
  nda: ["not_required"],
  photos: ["complete"],
  waiting_on: ["nothing"],
};

export function sectionChips<T extends { family: string; code: string }>(chips: T[], families: string[]): T[] {
  const hidden = SECTION_HIDDEN;
  return families
    .map((family) => chips.find((chip) => chip.family === family))
    .filter((chip): chip is T => {
      if (!chip) return false;
      return !(hidden[chip.family] || []).includes(chip.code);
    });
}
