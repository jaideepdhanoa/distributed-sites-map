export const DAILY_CAP = 400;
/** Instant emails per person per Pacific day. Further instant rows roll into the digest. */
export const INSTANT_DAILY_CAP = 6;

/** Oldest unsent instant row waits this long, then the whole batch for that person goes. */
export const DEFAULT_BATCH_MS = 10 * 60 * 1000;

export function batchWindowMs(): number {
  const raw = process.env.ALERT_BATCH_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_BATCH_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_BATCH_MS;
  return parsed;
}

export function losAngelesParts(now = new Date()): { hour: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number(bag.hour),
    day: `${bag.year}-${bag.month}-${bag.day}`,
  };
}

export function stampOf(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : 0;
}

/** Midnight at the start of the Pacific calendar day. DST picks UTC-8 or UTC-7. */
export function pacificDayStart(now = new Date()): Date {
  const day = losAngelesParts(now).day;
  for (const offsetHours of [8, 7]) {
    const start = new Date(`${day}T00:00:00.000Z`);
    start.setUTCHours(offsetHours);
    const parts = losAngelesParts(start);
    if (parts.day === day && parts.hour === 0) return start;
  }
  return new Date(`${day}T08:00:00.000Z`);
}

/**
 * Midnight Pacific on Nov 16. The Nov 15 workbook import is entirely before this.
 * A digest with no later checkpoint does not reach back across it.
 */
export const FIRST_DIGEST_AT = new Date("2026-11-16T08:00:00.000Z");

export function digestWindowStart(now: Date, prior: Date | null): Date {
  const dayStart = pacificDayStart(now);
  const lower = prior && prior.getTime() > 0 ? prior : dayStart;
  if (now.getTime() >= FIRST_DIGEST_AT.getTime() && lower.getTime() < FIRST_DIGEST_AT.getTime()) {
    return FIRST_DIGEST_AT;
  }
  return lower;
}
