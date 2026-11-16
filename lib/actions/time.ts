const PACIFIC = "America/Los_Angeles";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function calendarLabel(year: number, month: number, day: number): string {
  const name = MONTHS[month - 1];
  if (!name || !day) return "";
  return `${name} ${day}`;
}

function pacificDay(value: string): string {
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (zoned) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: PACIFIC,
      month: "short",
      day: "numeric",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
    return part("month") && part("day") ? `${part("month")} ${part("day")}` : "";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "";
  return calendarLabel(Number(match[1]), Number(match[2]), Number(match[3]));
}

function wallClockLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.replace(/\s+PT$/i, ""));
  if (!match) return "";
  const day = calendarLabel(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!day) return "";
  const hour = Number(match[4]);
  if (!Number.isFinite(hour) || hour > 23) return "";
  const period = hour >= 12 ? "PM" : "AM";
  const shown = hour % 12 || 12;
  return `${day}, ${shown}:${match[5]} ${period} PT`;
}

/**
 * Activity and comms clock. A zoned instant is shown in Pacific. A workbook
 * stamp that already says PT keeps that wall clock. Approximate stamps keep
 * the date and drop the time. The title is the exact stored stamp.
 */
export function formatActivityWhen(at: string, approximate = false): { label: string; title: string } {
  const title = String(at || "").trim();
  if (!title) return { label: "", title: "" };
  if (approximate) {
    const day = pacificDay(title);
    return { label: day ? `${day} (approx.)` : `${title} (approx.)`, title };
  }
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(title);
  const clock = /[T ]\d{2}:\d{2}/.test(title);
  if (clock && zoned) {
    const formatted = formatPacific(title);
    if (formatted !== title) return { label: formatted, title };
  }
  if (clock) {
    const wall = wallClockLabel(title);
    if (wall) return { label: wall, title };
  }
  const day = pacificDay(title);
  return { label: day || title, title };
}

export function replyCount(count: number): string {
  return count === 1 ? "1 reply" : `${count} replies`;
}
