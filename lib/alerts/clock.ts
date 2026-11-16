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
