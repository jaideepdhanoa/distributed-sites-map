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

/** The workbook next step, not the public note that clean_deal_note emptied. */
export function workbookStepFor(snapshot: Pick<OpenLoopsSnapshot, "sites"> | null | undefined, id: string): WorkbookStep | null {
  const wanted = id.trim();
  if (!wanted) return null;
  const site = (snapshot?.sites || []).find((row) => row.site_id === wanted) as StepSite | undefined;
  if (!site) return null;
  const text = clean(site.next_step);
  const owner = clean(site.next_step_owner);
  const due = clean(site.next_step_due);
  if (!text && !owner && !due) return null;
  return { text, owner, due };
}
