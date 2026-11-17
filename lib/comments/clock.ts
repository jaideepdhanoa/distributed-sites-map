/** Local clock as an ISO-8601 timestamp with a numeric zone offset. R-101. */
export function formatZonedTimestamp(date = new Date()): string {
  const pad = (value: number, width = 2) => String(Math.trunc(Math.abs(value))).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.trunc(absolute / 60))}:${pad(absolute % 60)}`;
}
