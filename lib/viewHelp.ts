/** One plain line under a view title. Shortlists are a separate saved view. */
export function viewHelp(view: "review" | "pipeline" | "universe" | "nda"): string {
  if (view === "review") return "Everything waiting on you";
  if (view === "pipeline") return "Deals in this market";
  if (view === "nda") return "Agreements still open";
  return "Sites in this market";
}

/** The full Universe file is for All markets and for a search. A city view uses that city. */
export function fullUniverseNeeded(allMarkets: boolean, query: string): boolean {
  return allMarkets || query.trim().length >= 2;
}
