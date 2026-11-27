import { amounts } from "./model";
import type { ChargingSummary } from "./summary";

export function pipelineCost(charging?: ChargingSummary) {
  if (!charging) return { value: "No charging case", basis: "", amount: null };
  if (charging.stale) return { value: "Needs recalculation", basis: "Site inputs have changed", amount: null };
  const amount = charging.result.siteCost;
  if (amount != null) {
    const scope = charging.energyScope === "excluded" ? " · excludes electricity" : "";
    return { value: amounts(amount, 2), basis: (charging.selected ? "Selected case" : "Planning estimate") + scope, amount };
  }
  const example = charging.screen?.find(scenario => scenario.stalls === 4);
  if (example && charging.screenDepot != null) {
    const estimate = amounts(charging.screenDepot * (1 - example.base), 2);
    return { value: "Site cost pending", basis: "Network example: " + estimate + "/charge at 4 assumed spaces, excluding electricity", amount: null };
  }
  const missing = charging.result.missing?.[0];
  return { value: "Not calculated", basis: missing ? "Needed: " + missing : "Check site inputs and completed charges", amount: null };
}
