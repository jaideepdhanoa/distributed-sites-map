"use client";

import type { TagCode } from "@/lib/tags/vocab";

export function ReasonPicker({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: TagCode[];
  value: string;
  onChange: (code: string) => void;
  testId: string;
}) {
  return (
    <div className="type-chips" role="group" aria-label={label} data-testid={testId}>
      {options.map((item) => (
        <button
          key={item.code}
          type="button"
          className={value === item.code ? "chip on" : "chip"}
          aria-pressed={value === item.code}
          onClick={() => onChange(item.code)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
