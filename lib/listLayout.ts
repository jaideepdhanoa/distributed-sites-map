/**
 * Column layout for the list sheet.
 * Sort numbers only when the column already exposes a number.
 * Text facts stay text. Nothing here calls Number() on a cell.
 */

export type SheetSort = { id: string; desc: boolean } | null;

export type ListLayout = {
  order: string[];
  widths: Record<string, number>;
  pinned: string[];
  hidden: string[];
  sort: SheetSort;
  filters: Record<string, string>;
  touched: boolean;
};

export type SheetColumn<Row> = {
  id: string;
  label: string;
  text: (row: Row) => string;
  sortValue?: (row: Row) => number | null;
  /** Chip-set filter. The saved value is the selected codes joined with |. */
  choices?: { code: string; label: string }[];
  /** False when no visible row carries a code for this chip-set. */
  hasValues?: boolean;
  code?: (row: Row) => string;
  private?: boolean;
  className?: string;
};

/** Financials, NDA status, last contact, and next step stay off a signed-out sheet. */
export const PRIVATE_COLUMN_IDS = [
  "asking",
  "perAcre",
  "cashFlow",
  "revenue",
  "askingRevenue",
  "askingCash",
  "businessMultiple",
  "landEstimate",
  "countyValue",
  "listed",
  "nda",
  "lastContact",
  "nextStep",
] as const;

export const LAYOUT_SURFACES = ["pipeline", "universe"] as const;
export type LayoutSurface = (typeof LAYOUT_SURFACES)[number];

const MIN_WIDTH = 96;
const SITE_MIN_WIDTH = 280;
const MAX_WIDTH = 480;

/** Columns that take leftover pane width. The pipeline list adds its power column. */
export const FLEX_COLUMN_IDS = new Set(["site", "asking", "listed", "grade", "traffic", "cashFlow", "type", "spare"]);

/** The Show on map column. It stays this wide so spare pane width does not pool there. */
export const TRAILING_COLUMN_WIDTH = 112;

/** Starting widths so a default sheet does not clip a label mid-word. */
const COLUMN_WIDTH: Record<string, number> = {
  site: 320,
  stage: 148,
  score: 96,
  asking: 168,
  listed: 148,
  type: 120,
  city: 96,
  acres: 104,
  perAcre: 120,
  openLand: 120,
  spare: 120,
  grade: 168,
  traffic: 112,
  cashFlow: 156,
  revenue: 136,
  askingRevenue: 148,
  askingCash: 156,
  businessMultiple: 168,
  landEstimate: 148,
  countyValue: 140,
  depot: 104,
  checked: 104,
  address: 220,
  apn: 140,
  zoning: 148,
  broker: 188,
  area: 156,
  nda: 140,
  lastContact: 124,
  nextStep: 240,
  chip_waiting: 148,
};

export function columnWidth(id: string): number {
  return COLUMN_WIDTH[id] || 148;
}
const FILTER_LIMIT = 80;

export function isLayoutSurface(value: string | null | undefined): value is LayoutSurface {
  return value === "pipeline" || value === "universe";
}

export function defaultLayout(ids: string[], pinned: string[] = ["site"], hidden: string[] = []): ListLayout {
  const order = unique(ids);
  const hide = unique(hidden).filter((id) => order.includes(id) && id !== "site");
  const sortId = order.find((id) => id === "site") || order.find((id) => !hide.includes(id)) || null;
  return {
    order,
    widths: {},
    pinned: pinned.filter((id) => order.includes(id) && !hide.includes(id)),
    hidden: hide,
    sort: sortId ? { id: sortId, desc: false } : null,
    filters: {},
    touched: false,
  };
}

export function phoneColumns(surface: LayoutSurface): string[] {
  if (surface === "pipeline") return ["site", "stage", "score", "openLand"];
  return ["site", "type", "stage", "county", "score"];
}

export function allowedIds(ids: string[], signedIn: boolean): string[] {
  if (signedIn) return unique(ids);
  const blocked = new Set<string>(PRIVATE_COLUMN_IDS);
  return unique(ids).filter((id) => !blocked.has(id));
}

export function sanitizeLayout(input: unknown, allowed: string[]): ListLayout {
  const base = defaultLayout(allowed);
  if (!input || typeof input !== "object") return base;
  const raw = input as Partial<ListLayout>;
  const known = new Set(allowed);
  const order = unique((Array.isArray(raw.order) ? raw.order : []).filter((id): id is string => typeof id === "string" && known.has(id)));
  for (const id of allowed) if (!order.includes(id)) order.push(id);
  const hidden = unique((Array.isArray(raw.hidden) ? raw.hidden : []).filter((id): id is string => typeof id === "string" && known.has(id) && id !== "site"));
  const pinned = unique((Array.isArray(raw.pinned) ? raw.pinned : base.pinned).filter((id): id is string => typeof id === "string" && known.has(id) && !hidden.includes(id)));
  if (!pinned.length && order.includes("site")) pinned.push("site");
  const widths: Record<string, number> = {};
  if (raw.widths && typeof raw.widths === "object") {
    for (const [id, value] of Object.entries(raw.widths)) {
      if (!known.has(id) || typeof value !== "number" || !Number.isFinite(value)) continue;
      const width = clampWidth(value);
      widths[id] = id === "site" ? Math.max(SITE_MIN_WIDTH, width) : width;
    }
  }
  const filters: Record<string, string> = {};
  if (raw.filters && typeof raw.filters === "object") {
    for (const [id, value] of Object.entries(raw.filters)) {
      if (!known.has(id) || typeof value !== "string") continue;
      const text = value.trim().slice(0, FILTER_LIMIT);
      if (text) filters[id] = text;
    }
  }
  return {
    order,
    widths,
    pinned,
    hidden,
    sort: sortOf(raw.sort, known),
    filters,
    touched: raw.touched === true,
  };
}

export function displayIds(layout: ListLayout, allowed: string[], phone: boolean, phoneIds: string[]): string[] {
  const known = new Set(allowed);
  const hidden = new Set(layout.hidden);
  const source = phone && !layout.touched ? phoneIds : layout.order;
  const visible = unique(source).filter((id) => known.has(id) && !hidden.has(id));
  if (!visible.includes("site") && known.has("site") && !hidden.has("site")) visible.unshift("site");
  const pinned = layout.pinned.filter((id) => visible.includes(id));
  const rest = visible.filter((id) => !pinned.includes(id));
  const ordered = [...pinned, ...rest];
  return ordered.length ? ordered : allowed.filter((id) => id === "site").slice(0, 1);
}

export function cycleSort(current: SheetSort, id: string): SheetSort {
  if (!current || current.id !== id) return { id, desc: false };
  if (!current.desc) return { id, desc: true };
  return null;
}

export function sortParam(sort: SheetSort): string | null {
  if (!sort) return "none";
  return `${sort.id}:${sort.desc ? "desc" : "asc"}`;
}

export function sortFromParam(value: string | null, allowed: string[]): SheetSort | undefined {
  if (value == null) return undefined;
  if (value === "none" || value === "") return null;
  const [id, dir] = value.split(":");
  if (!allowed.includes(id)) return undefined;
  return { id, desc: dir === "desc" };
}

export function moveColumn(order: string[], from: string, to: string): string[] {
  if (from === to || !order.includes(from) || !order.includes(to)) return order;
  const next = order.filter((id) => id !== from);
  next.splice(next.indexOf(to), 0, from);
  return next;
}

export function clampWidth(value: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));
}

/**
 * Pixel widths for the visible columns.
 * A default sheet spreads leftover width across the flexible columns, and
 * shrinks those columns (not below the minimum) when the pane is narrower.
 * A saved width stays put. Leftover width goes to flexible columns that were
 * not saved, or to the last flexible column when every one of them was saved.
 */
export function fitColumnWidths(
  ids: string[],
  savedWidths: Record<string, number>,
  paneWidth: number,
  trailing = 0,
  flexIds: ReadonlySet<string> = FLEX_COLUMN_IDS,
): number[] {
  const base = ids.map((id) => {
    const saved = savedWidths[id];
    return typeof saved === "number" && Number.isFinite(saved) ? saved : columnWidth(id);
  });
  if (!ids.length || paneWidth <= 0) return base;
  const siteAt = ids.indexOf("site");
  if (siteAt >= 0) base[siteAt] = Math.max(SITE_MIN_WIDTH, base[siteAt]);
  const target = Math.max(0, Math.floor(paneWidth) - Math.max(0, Math.round(trailing)));
  const sum = base.reduce((total, width) => total + width, 0);
  const delta = target - sum;
  if (delta === 0) return base;
  const flex = ids.flatMap((id, index) => (flexIds.has(id) ? [index] : []));
  const saved = (index: number) => {
    const width = savedWidths[ids[index]];
    return typeof width === "number" && Number.isFinite(width);
  };
  const openFlex = flex.filter((index) => !saved(index));
  if (!flex.length) {
    if (delta > 0) base[base.length - 1] += delta;
    return base;
  }
  if (delta > 0) {
    const grow = openFlex.length ? openFlex : [flex[flex.length - 1]];
    if (grow.length === 1 && !openFlex.length) base[grow[0]] += delta;
    else applyShares(base, grow, shares(delta, grow.map((index) => Math.max(base[index], 1))));
    return base;
  }
  if (!openFlex.length) return base;
  const floor = (index: number) => (ids[index] === "site" ? SITE_MIN_WIDTH : MIN_WIDTH);
  const room = openFlex.map((index) => Math.max(0, base[index] - floor(index)));
  if (room.every((value) => value === 0)) return base;
  const cuts = shares(Math.min(-delta, room.reduce((total, value) => total + value, 0)), room, room);
  openFlex.forEach((index, position) => {
    base[index] -= cuts[position];
  });
  return base;
}

function applyShares(base: number[], indexes: number[], cuts: number[]) {
  indexes.forEach((index, position) => {
    base[index] += cuts[position];
  });
}

/** Whole pixels that sum to `total`, weighted. A cap stops a column from taking more than it can give up. */
function shares(total: number, weights: number[], caps?: number[]): number[] {
  const out = weights.map(() => 0);
  let left = Math.max(0, Math.round(total));
  for (let round = 0; round < weights.length + 2 && left > 0; round += 1) {
    const active = weights.map((weight, index) => {
      const cap = caps ? caps[index] : Number.POSITIVE_INFINITY;
      return { index, weight, room: cap - out[index] };
    }).filter((item) => item.room > 0 && item.weight > 0);
    if (!active.length) break;
    const weight = active.reduce((sum, item) => sum + item.weight, 0);
    let moved = 0;
    active.forEach((item, position) => {
      const raw = position === active.length - 1 ? left - moved : Math.round((left * item.weight) / weight);
      const add = Math.max(0, Math.min(item.room, raw));
      out[item.index] += add;
      moved += add;
    });
    if (moved <= 0) break;
    left -= moved;
  }
  return out;
}

export function prepareRows<Row>(
  rows: Row[],
  columns: SheetColumn<Row>[],
  layout: ListLayout,
  visible: string[],
): Row[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const filtered = rows.filter((row) => {
    for (const [id, query] of Object.entries(layout.filters)) {
      const column = byId.get(id);
      if (!column || !visible.includes(id)) continue;
      if (column.choices) {
        const selected = query.split("|").map((item) => item.trim()).filter(Boolean);
        if (!selected.length) continue;
        const code = column.code ? column.code(row) : column.text(row);
        if (!selected.includes(code)) return false;
        continue;
      }
      const hay = column.text(row).toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  });
  const sort = layout.sort;
  if (!sort || !visible.includes(sort.id)) return filtered;
  const column = byId.get(sort.id);
  if (!column) return filtered;
  const copy = filtered.slice();
  const numeric = column.sortValue
    ? copy.some((row) => {
        const value = column.sortValue?.(row);
        return typeof value === "number" && Number.isFinite(value);
      })
    : false;
  copy.sort((a, b) => {
    if (numeric && column.sortValue) {
      const left = column.sortValue(a);
      const right = column.sortValue(b);
      const leftMissing = typeof left !== "number" || !Number.isFinite(left);
      const rightMissing = typeof right !== "number" || !Number.isFinite(right);
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return 0;
        return leftMissing ? 1 : -1;
      }
      const diff = left - right;
      return sort.desc ? -diff : diff;
    }
    const left = column.text(a).trim();
    const right = column.text(b).trim();
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    const diff = left.localeCompare(right, undefined, { numeric: true });
    return sort.desc ? -diff : diff;
  });
  return copy;
}

export function layoutStorageKey(surface: LayoutSurface, userId: string): string {
  const who = userId.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 80) || "anon";
  return `list-layout:v1:${who}:${surface}`;
}

function sortOf(value: unknown, known: Set<string>): SheetSort {
  if (value == null) return null;
  if (typeof value !== "object") return null;
  const sort = value as { id?: unknown; desc?: unknown };
  if (typeof sort.id !== "string" || !known.has(sort.id)) return null;
  return { id: sort.id, desc: sort.desc === true };
}

function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
