"use client";

import { useState } from "react";

const inputs = [
  { key: "months", label: "Months from closing to power", min: 0, step: "1" },
  { key: "upfront", label: "Cash required at closing ($)", min: 0, step: "any" },
  { key: "retained", label: "Monthly operating cash after upkeep and staffing ($)", step: "any" },
  { key: "carrying", label: "Monthly financing and other carrying costs ($)", min: 0, step: "any" },
] as const;
type InputKey = typeof inputs[number]["key"];
const dollars = new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0});

export default function PowerDelayTrial() {
  const [raw, setRaw] = useState<Record<InputKey,string>>({months:"",upfront:"",retained:"",carrying:""});
  const ready = inputs.every(({key}) => raw[key].trim() !== "" && Number.isFinite(Number(raw[key])) &&
    (key === "retained" || Number(raw[key]) >= 0)) && Number.isInteger(Number(raw.months));
  const cashAtClosing = Number(raw.upfront);
  const monthlyDraw = Number(raw.carrying) - Number(raw.retained);
  return <details className="disclosure">
    <summary className="disclosure">Test cash needed while waiting for power</summary>
    <p>Enter the cash paid up front, including purchase equity, initial works and deposits. Include each expense once. This trial holds monthly cash constant and assumes zero charging income until opening.</p>
    <div className="visit-trial-inputs">{inputs.map(input =>
      <label key={input.key}>{input.label}<input className="field" type="number" step={input.step}
        min={"min" in input ? input.min : undefined} value={raw[input.key]}
        onChange={e=>setRaw({...raw,[input.key]:e.target.value})}/></label>)}</div>
    {ready ? <div aria-live="polite"><p>Monthly {monthlyDraw < 0 ? "surplus" : "funding gap"} · {dollars.format(Math.abs(monthlyDraw))}</p>
      <table><caption>Peak cash required from closing</caption><thead><tr><th>Power timing</th><th>Peak funding</th></tr></thead>
        <tbody>{[0,6,12].map(delay => <tr key={delay}><th scope="row">{delay ? "+"+delay+" months" : "On time"} · month {Number(raw.months)+delay}</th>
          <td>{dollars.format(cashAtClosing + Math.max(0,monthlyDraw) * (Number(raw.months)+delay))}</td></tr>)}</tbody></table>
    </div> : <p>Enter all four values to compare on-time power with six- and twelve-month delays.</p>}
    <small>Trial values last until this site view closes. Record the supported cash inputs and funding decision with the site evidence.</small>
  </details>;
}
