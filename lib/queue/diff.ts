export type FeedSite = {
  id: string;
  city: string;
  stage: string;
  stageGroup: string;
  verdict: string;
  askingPrice: string;
  askingSource: string;
  active: boolean;
};

export type ActivityMark = {
  id: string;
  siteId: string;
  summary: string;
};

export type MaterialMark = {
  siteId: string;
  category: string;
  label: string;
  count: number;
};

export type ChangeEvent = {
  id: string;
  siteId: string;
  type: "new_site" | "stage" | "verdict" | "activity" | "materials" | "price";
  at: string;
  summary: string;
};

const VERDICT_LABELS: Record<string, string> = {
  PASS: "Cleared",
  MAYBE: "Possible",
  FAIL: "Ruled out",
  NOT_A_WASH: "Not a wash",
  UNRESOLVED: "Unresolved",
};

function verdictLabel(value: string): string {
  return VERDICT_LABELS[value] || value || "Not screened yet";
}

function eventId(type: string, siteId: string, at: string, extra: string): string {
  return `${type}:${siteId}:${at}:${extra}`;
}

export function diffFeed(input: {
  previous: FeedSite[] | null;
  next: FeedSite[];
  previousActivity?: ActivityMark[] | null;
  nextActivity?: ActivityMark[] | null;
  previousMaterials?: MaterialMark[] | null;
  nextMaterials?: MaterialMark[] | null;
  at: string;
}): ChangeEvent[] {
  if (!input.previous) return [];
  const before = new Map(input.previous.map((site) => [site.id, site]));
  const events: ChangeEvent[] = [];
  for (const site of input.next) {
    const prior = before.get(site.id);
    if (!prior) {
      events.push({
        id: eventId("new_site", site.id, input.at, "new"),
        siteId: site.id,
        type: "new_site",
        at: input.at,
        summary: "New pipeline site.",
      });
      continue;
    }
    if (prior.stage !== site.stage) {
      events.push({
        id: eventId("stage", site.id, input.at, site.stage),
        siteId: site.id,
        type: "stage",
        at: input.at,
        summary: `Stage is now ${site.stage}.`,
      });
    }
    if (prior.verdict !== site.verdict) {
      events.push({
        id: eventId("verdict", site.id, input.at, site.verdict),
        siteId: site.id,
        type: "verdict",
        at: input.at,
        summary: `Verdict is now ${verdictLabel(site.verdict)}.`,
      });
    }
    if (prior.askingPrice !== site.askingPrice || prior.askingSource !== site.askingSource) {
      const price = site.askingPrice || "not listed";
      const source = site.askingSource || "source not on file";
      events.push({
        id: eventId("price", site.id, input.at, price),
        siteId: site.id,
        type: "price",
        at: input.at,
        summary: `Asking price is ${price}, from ${source}.`,
      });
    }
  }
  if (input.previousActivity && input.nextActivity) {
    const seen = new Set(input.previousActivity.map((item) => item.id));
    for (const item of input.nextActivity) {
      if (seen.has(item.id)) continue;
      events.push({
        id: eventId("activity", item.siteId, input.at, item.id),
        siteId: item.siteId,
        type: "activity",
        at: input.at,
        summary: item.summary ? `New activity: ${item.summary}` : "New activity on file.",
      });
    }
  }
  if (input.previousMaterials && input.nextMaterials) {
    const seen = new Map(input.previousMaterials.map((item) => [`${item.siteId}:${item.category}`, item.count]));
    for (const item of input.nextMaterials) {
      const prior = seen.get(`${item.siteId}:${item.category}`) || 0;
      if (item.count <= prior) continue;
      events.push({
        id: eventId("materials", item.siteId, input.at, item.category),
        siteId: item.siteId,
        type: "materials",
        at: input.at,
        summary: `${item.label} count is now ${item.count}.`,
      });
    }
  }
  return events;
}
