/** A seller package is on file. Asked-for, refused, and blank statuses are not. */
export function packageOnFile(status?: string | null, line?: string | null): boolean {
  const text = `${status || ""} ${line || ""}`.toLowerCase();
  if (text.includes("refus") || text.includes("unavailable")) return false;
  return text.includes("received") || text.includes("partial") || text.includes("on file");
}
