"use client";

export default function PnlBasis({
  basis,
  onChange,
}: {
  basis: "stated" | "normalized";
  onChange: (basis: "stated" | "normalized") => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Figure basis" data-testid="pnl-basis">
      <button type="button" className={basis === "stated" ? "segmented on" : "segmented"} aria-pressed={basis === "stated"} onClick={() => onChange("stated")}>Stated</button>
      <button type="button" className={basis === "normalized" ? "segmented on" : "segmented"} aria-pressed={basis === "normalized"} onClick={() => onChange("normalized")}>Normalized</button>
    </div>
  );
}
