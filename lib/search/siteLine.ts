import { stageTitle } from "@/lib/labels";

const CITY_LABEL: Record<string, string> = {
  PHX: "Phoenix",
  LAS: "Las Vegas",
  MIA: "Miami",
};

function text(value: string | undefined): string {
  return String(value || "").trim();
}

function place(address: string, city: string): string {
  if (!address) return city;
  if (!city) return address;
  if (address.toLowerCase().includes(city.toLowerCase())) return address;
  return `${address}, ${city}`;
}

/** Second line on a site row: street and city, id, and stage. */
export function siteResultDetail(input: {
  id: string;
  address?: string;
  city?: string;
  stage?: string;
  stageGroup?: string;
  universe?: boolean;
}): string {
  const code = text(input.city).toUpperCase();
  const city = CITY_LABEL[code] || text(input.city);
  const where = place(text(input.address), city);
  let stage = "";
  if (input.universe) stage = "Universe";
  else if (input.stageGroup === "dropped" || /^dropped\b/i.test(text(input.stage))) stage = "Dropped";
  else {
    const named = input.stageGroup ? stageTitle(input.stageGroup) : "";
    const written = text(input.stage).replace(/^(?:dropped|\d+)\b\s*/i, "").trim();
    stage = named && named !== "Deal" ? named : written;
  }
  return [where, text(input.id), stage].filter(Boolean).join(" · ");
}
