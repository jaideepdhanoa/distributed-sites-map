import { stripGmailIds } from "./displayText";
import type { OpenLoopSite, OpenLoopsSnapshot } from "./openLoops";

export type WorkbookStep = {
  text: string;
  owner: string;
  due: string;
};

type StepSite = OpenLoopSite & {
  next_step_owner?: string;
  next_step_due?: string;
};

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const FORBIDDEN_SENTENCE = /\bAVs?\b|\bcharging\b|\bautonomous\b/i;

/** The signed-in next step. Forbidden sentences drop. The note is not cut at 600 characters. */
export function workbookNote(value: string, limit = 8000): string {
  const chunks = String(value || "").replace(/\r/g, "\n").split(/\n+|(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const chunk of chunks) {
    const piece = chunk.replace(/\s+/g, " ").trim().replace(/^[ ;]+|[ ;]+$/g, "");
    if (!piece || FORBIDDEN_SENTENCE.test(piece)) continue;
    kept.push(piece);
  }
  const joined = kept.join(" ").trim();
  if (joined.length <= limit) return joined;
  return `${joined.slice(0, limit - 1).trimEnd()}…`;
}

/** The workbook next step, not the public note that clean_deal_note emptied. */
export function workbookStepFor(snapshot: Pick<OpenLoopsSnapshot, "sites"> | null | undefined, id: string): WorkbookStep | null {
  const wanted = id.trim();
  if (!wanted) return null;
  const site = (snapshot?.sites || []).find((row) => row.site_id === wanted) as StepSite | undefined;
  if (!site) return null;
  const text = stripGmailIds(clean(site.next_step));
  const owner = clean(site.next_step_owner);
  const due = clean(site.next_step_due);
  if (!text && !owner && !due) return null;
  return { text, owner, due };
}
