const PACIFIC = "America/Los_Angeles";

export function formatPacific(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("month")} ${part("day")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()} PT`;
}

export function replyCount(count: number): string {
  return count === 1 ? "1 reply" : `${count} replies`;
}
