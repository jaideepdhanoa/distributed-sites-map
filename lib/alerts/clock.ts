export const DAILY_CAP = 400;

export function batchWindowMs(): number {
  const raw = process.env.ALERT_BATCH_MS;
  if (raw == null || raw.trim() === "") return 5 * 60 * 1000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 5 * 60 * 1000;
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
