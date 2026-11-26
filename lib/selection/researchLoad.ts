import { readGeneratedOptional } from "@/lib/snapshot/read";
import { parseResearch, type SelectionResearch } from "./research";

let previous: unknown;
let rows = new Map<string,SelectionResearch>();
export function selectionResearch() {
  const raw = readGeneratedOptional("selection-evidence.json");
  if (previous !== raw) {
    rows = raw ? parseResearch(raw) : new Map();
    previous = raw;
  }
  return rows;
}
