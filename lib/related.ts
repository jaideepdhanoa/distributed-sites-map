const STREET = /\b(avenue|ave|street|st|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|circle|cir|parkway|pkwy|highway|hwy)\b/g;
const DIR: Record<string, string> = { north: "n", south: "s", east: "e", west: "w", ne: "ne", nw: "nw", se: "se", sw: "sw", n: "n", s: "s", e: "e", w: "w" };

export function parcelKey(value?: string | null): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** House number plus street, so "5020 S 16th St" and "5020 S 16th Street" match. */
export function addressKey(value?: string | null): string {
  let text = String(value || "").toLowerCase();
  text = text.replace(/^(phx|las|mia|sna)\s+/, "");
  text = text.replace(/[^a-z0-9 ]/g, " ");
  text = text.replace(/\b(az|nv|fl|arizona|nevada|florida)\b/g, " ");
  text = text.replace(/\b\d{5}\b/g, " ");
  text = text.replace(STREET, " ");
  text = text.replace(/\s+/g, " ").trim();
  const match = text.match(/(\d+)\s+((?:north|south|east|west|ne|nw|se|sw|n|s|e|w)\s+)?([a-z0-9]+)/);
  if (!match) return "";
  const direction = DIR[(match[2] || "").trim()] || "";
  return `${match[1]} ${direction} ${match[3]}`.replace(/\s+/g, " ").trim();
}

export type RelatedHit = {
  id: string;
  kind: "site" | "deal";
  label: string;
  via: "apn" | "address";
  apn: string;
};

type RelatedRecord = {
  id: string;
  kind: "site" | "deal";
  name?: string | null;
  address?: string | null;
  apn?: string | null;
};

export function relatedRecords(current: RelatedRecord, records: RelatedRecord[]): RelatedHit[] {
  const apn = parcelKey(current.apn);
  const address = addressKey(current.address);
  const hits: RelatedHit[] = [];
  for (const record of records) {
    if (record.id === current.id) continue;
    const otherApn = parcelKey(record.apn);
    const otherAddress = addressKey(record.address);
    const sameApn = Boolean(apn) && apn === otherApn;
    const sameAddress = Boolean(address) && address === otherAddress;
    if (!sameApn && !sameAddress) continue;
    hits.push({
      id: record.id,
      kind: record.kind,
      label: record.name || record.address || record.id,
      via: sameApn ? "apn" : "address",
      apn: otherApn || apn,
    });
  }
  hits.sort((a, b) => a.id.localeCompare(b.id));
  return hits;
}
