import { useState } from "react";
import { conversionReturn, edgeFitRange, fitRange, threshold } from "@/lib/spaces/options";
import { SPACE_LAYOUTS, type SpaceLayout } from "@/lib/spaces/vocab";

const fields = {
  length: "Net row length (ft)", depth: "Net depth including aisle (ft)", reserve: "Possible clearance loss per dimension (ft)",
  aisle: "Usable width of adjacent aisle (ft)",
  cost: "Conversion and downtime cost ($)", contribution: "Annual charging contribution ($)",
  lost: "Displaced operating contribution per year ($)", ongoing: "Additional annual operating cost ($)",
} as const;
type Key = keyof typeof fields;
export type Inputs = { layout: SpaceLayout; adjacent?: boolean; values: Partial<Record<Key, string>> };
export const emptyInputs: Inputs = { layout: "stalls_90", values: {} };
function value(inputs: Inputs, key: Key) {
  const raw = inputs.values[key]?.trim();
  return raw ? Number(raw) : NaN;
}
const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
export function scenarioResult(inputs: Inputs) {
  const length = value(inputs, "length"), depth = value(inputs, "depth"), reserve = value(inputs, "reserve");
  const range = inputs.adjacent && inputs.layout !== "pull_through" ? edgeFitRange(length, depth, reserve, value(inputs, "aisle"), inputs.layout) : fitRange(length, depth, reserve, inputs.layout);
  const economics = conversionReturn(value(inputs, "cost"), value(inputs, "contribution"), value(inputs, "lost"), value(inputs, "ongoing"));
  const fit = range ? range[0] + "–" + range[1] + " stalls · " + threshold(...range) : "";
  const returns = economics ? dollars(economics.net) + " net per year · " + (economics.years === null ? "no simple payback" : economics.years.toFixed(1) + " years simple payback") : "";
  return { fit, returns };
}
export function describeInputs(inputs: Inputs) {
  const { fit, returns } = scenarioResult(inputs);
  const adjacent = inputs.adjacent && inputs.layout !== "pull_through";
  const entries = (Object.keys(fields) as Key[]).filter(k => Number.isFinite(value(inputs, k)) && (k !== "aisle" || adjacent)).map(k => (k === "depth" && adjacent ? "Footprint depth excluding aisle (ft)" : fields[k]) + " " + value(inputs, k));
  return entries.length ? [SPACE_LAYOUTS.find(l => l.id === inputs.layout)?.label, adjacent && "One row served by an adjacent aisle", ...entries, fit, returns].filter(Boolean).join(" · ") : "";
}

export default function ScenarioInputs({ inputs, change, dimensions }: { inputs: Inputs; dimensions: [number, number] | null; change: (next: Inputs) => void }) {
  const [open, setOpen] = useState(false);
  const { fit, returns } = scenarioResult(inputs);
  const adjacent = inputs.adjacent && inputs.layout !== "pull_through";
  const input = (key: Key) => <label key={key}>{key === "depth" && adjacent ? "Net footprint depth excluding aisle (ft)" : fields[key]}<input type="number" min="0" step="any" className="field" value={inputs.values[key] || ""} onChange={e => change({ ...inputs, values: { ...inputs.values, [key]: e.target.value } })} /></label>;
  return <div className="layout-model">
    <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Test"} fit and economics</button>
    {open && <div className="layout-model-content">
      <h4>Physical fit</h4><p>Enter a clear rectangle after equipment, turning and retained access. The lower case subtracts the clearance allowance from each dimension.</p>
      {dimensions && <button type="button" className="text-link" onClick={() => change({ ...inputs, values: { ...inputs.values, length: String(dimensions[0]), depth: String(dimensions[1]), reserve: String(Math.min(6,dimensions[1])) } })}>Use aerial outline dimensions</button>}
      <label>Parking arrangement<select className="secondary" value={inputs.layout} onChange={e => change({ ...inputs, layout: e.target.value as SpaceLayout })}>{SPACE_LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
      {inputs.layout !== "pull_through" && <label>Drive aisle<select className="secondary" value={adjacent ? "edge" : "inside"} onChange={e=>change({...inputs,adjacent:e.target.value==="edge"})}><option value="inside">Inside measured rectangle</option><option value="edge">Existing aisle outside one edge</option></select></label>}
      {adjacent && <p>Test one row along an existing aisle. Verify peak access, turning and the right to use that aisle.</p>}
      <div className="layout-inputs">{(["length", "depth", "reserve"] as const).map(input)}{adjacent && input("aisle")}</div>
      <p className="layout-result" aria-live="polite">{fit || (adjacent ? "Enter the net footprint, clearance allowance and usable aisle width." : "Enter both dimensions and a clearance allowance to test the four-stall minimum.")}</p>
      <h4>Conversion economics</h4><p>Use the charging hours this option can deliver. Include the value of any fleet servicing lost. Enter zero for a cost you have ruled out.</p>
      <div className="layout-inputs">{(["cost", "contribution", "lost", "ongoing"] as const).map(input)}</div>
      <p className="layout-result" aria-live="polite">{returns || "Complete the four figures for net annual contribution and simple payback."}</p>
    </div>}
  </div>;
}
