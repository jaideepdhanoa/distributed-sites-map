import { formatPacific } from "@/lib/actions/time";

const SNAPSHOT_TYPES = new Set(["new_site", "stage", "verdict", "price", "activity", "materials"]);

function dayOf(at: string): string {
  const match = String(at || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
}

/** How a Review reason is timed. Snapshot rows name the refresh. Real events name their own clock. */
export function reviewWhen(input: { type: string; at: string; source?: string | null }): string {
  const at = String(input.at || "");
  if (input.source === "snapshot" || SNAPSHOT_TYPES.has(input.type)) {
    const day = dayOf(at);
    return day ? `Seen in the ${shortDay(day)} refresh` : "Seen in a refresh";
  }
  if (input.type === "next_proposed" || input.type === "drop_suggested" || input.type === "document_request") {
    return at ? `Proposed at ${formatPacific(at)}` : "Proposed";
  }
  if (input.type === "note" || input.type === "reply" || input.type === "mention") {
    return at ? `Commented at ${formatPacific(at)}` : "Commented";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return shortDay(at);
  return at ? formatPacific(at) : "";
}
