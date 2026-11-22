export type ConflictStatus = "open" | "asked_broker" | "resolved";
export const CONFLICT_SUBJECTS = ["field", "pnl_line", "address", "apn", "lat", "lng", "open_land_sqft", "segment"] as const;
export type ConflictSubject = (typeof CONFLICT_SUBJECTS)[number];

export type ConflictSource = {
  value: string;
  document: string;
  page: string;
};

/** A disagreement between two sources. Signed-in reads only. */
export type DataConflict = {
  id: string;
  siteId: string;
  subject: ConflictSubject;
  field: string;
  period: string;
  sources: [ConflictSource, ConflictSource];
  valueInUse: string;
  status: ConflictStatus;
  resolutionNote: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export function statusLabel(status: ConflictStatus): string {
  if (status === "asked_broker") return "Asked broker";
  if (status === "resolved") return "Resolved";
  return "Open";
}

function source(value: unknown): ConflictSource | null {
  if (!value || typeof value !== "object") return null;
  const row = value as ConflictSource;
  if (typeof row.value !== "string" || typeof row.document !== "string" || typeof row.page !== "string") return null;
  return { value: row.value, document: row.document, page: row.page };
}

/** Drop a payload that is not a conflict. Never throws. */
export function conflictList(value: unknown): DataConflict[] {
  if (!Array.isArray(value)) return [];
  const rows: DataConflict[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as DataConflict;
    if (!(CONFLICT_SUBJECTS as readonly string[]).includes(row.subject)) continue;
    if (row.status !== "open" && row.status !== "asked_broker" && row.status !== "resolved") continue;
    if (typeof row.id !== "string" || typeof row.field !== "string") continue;
    const first = source(row.sources?.[0]);
    const second = source(row.sources?.[1]);
    if (!first || !second) continue;
    rows.push({ ...row, sources: [first, second], period: typeof row.period === "string" ? row.period : "" });
  }
  return rows;
}
