import { readGeneratedOptional } from "../snapshot/read";
import { parseOpportunities } from "./opportunity";

let previous: unknown;
let current: ReturnType<typeof parseOpportunities> | undefined;
export function opportunityRegister() {
  const raw = readGeneratedOptional("opportunity-reviews.json");
  if (previous !== raw) {
    current = raw ? parseOpportunities(raw) : undefined;
    previous = raw;
  }
  return current;
}
