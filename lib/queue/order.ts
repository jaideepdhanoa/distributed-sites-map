export type QueueReason = {
  at: string;
  summary: string;
  type: string;
};

export type QueueRow = {
  siteId: string;
  city: string;
  stage: string;
  stageGroup: string;
  active: boolean;
  reasons: QueueReason[];
  flagged: boolean;
  mentioned: boolean;
  assigned: boolean;
  needsApproval: boolean;
  isNew: boolean;
  newestAt: string;
};

export type QueueFilters = {
  market?: string;
  stage?: string;
  viable?: boolean;
  freshOnly?: boolean;
  flaggedOnly?: boolean;
  approvalOnly?: boolean;
  mentionsOnly?: boolean;
  assignedOnly?: boolean;
};

function rank(row: QueueRow): number {
  if (row.flagged || row.mentioned) return 0;
  if (row.needsApproval) return 1;
  if (row.isNew) return 2;
  return 3;
}

export function compareQueue(a: QueueRow, b: QueueRow): number {
  const byRank = rank(a) - rank(b);
  if (byRank) return byRank;
  return b.newestAt.localeCompare(a.newestAt) || a.siteId.localeCompare(b.siteId);
}

export function queueMembership(input: {
  active: boolean;
  reviewedAt: string | null;
  snoozeUntil: string | null;
  today: string;
  flagged: boolean;
  mentioned: boolean;
  reasons: QueueReason[];
}): boolean {
  const snoozed = Boolean(input.snoozeUntil && input.snoozeUntil > input.today);
  if (snoozed && !input.flagged && !input.mentioned) return false;
  if (input.flagged || input.mentioned) return true;
  if (!input.reviewedAt) return input.active || input.reasons.length > 0;
  return input.reasons.some((reason) => reason.at > input.reviewedAt!);
}

function placeholder(input: { flagged: boolean; mentioned: boolean; assigned: boolean; at: string }): QueueReason {
  if (input.flagged) return { at: input.at, summary: "Flagged for you.", type: "flag" };
  if (input.mentioned) return { at: input.at, summary: "Mentioned you.", type: "mention" };
  if (input.assigned) return { at: input.at, summary: "Assigned to you.", type: "assignment" };
  return { at: input.at, summary: "New pipeline site.", type: "new_site" };
}

export function buildQueue(input: {
  sites: { id: string; city: string; stage: string; stageGroup: string; active: boolean }[];
  reasons: Record<string, QueueReason[]>;
  reviewedAt: Record<string, string>;
  snoozeUntil: Record<string, string>;
  flagged: Set<string>;
  mentioned: Set<string>;
  assigned: Set<string>;
  needsApproval: Set<string>;
  today: string;
  filters: QueueFilters;
}): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const site of input.sites) {
    if (input.filters.market && input.filters.market !== "all" && site.city !== input.filters.market) continue;
    if (input.filters.stage && input.filters.stage !== "any" && site.stageGroup !== input.filters.stage) continue;
    if (input.filters.viable && !site.active) continue;
    const reviewedAt = input.reviewedAt[site.id] || "";
    const reasons = (input.reasons[site.id] || []).filter((reason) => !reviewedAt || reason.at > reviewedAt);
    const flagged = input.flagged.has(site.id);
    const mentioned = input.mentioned.has(site.id);
    const assigned = input.assigned.has(site.id);
    const needsApproval = input.needsApproval.has(site.id);
    const neverReviewed = !reviewedAt;
    const baseline = neverReviewed && site.active && !reasons.some((reason) => reason.type === "new_site")
      ? [{ at: input.today, summary: "New pipeline site.", type: "new_site" }]
      : [];
    const visible = [...baseline, ...reasons];
    const isNew = visible.some((reason) => reason.type === "new_site");
    if (input.filters.freshOnly && !isNew) continue;
    if (input.filters.flaggedOnly && !flagged) continue;
    if (input.filters.approvalOnly && !needsApproval) continue;
    if (input.filters.mentionsOnly && !mentioned) continue;
    if (input.filters.assignedOnly && !assigned) continue;
    const queued = input.filters.assignedOnly || queueMembership({
      active: site.active,
      reviewedAt: reviewedAt || null,
      snoozeUntil: input.snoozeUntil[site.id] || null,
      today: input.today,
      flagged,
      mentioned,
      reasons: visible,
    });
    if (!queued) continue;
    const shown = visible.length ? visible : [placeholder({ flagged, mentioned, assigned, at: input.today })];
    const newestAt = shown.reduce((latest, reason) => (reason.at > latest ? reason.at : latest), reviewedAt || input.today);
    rows.push({
      siteId: site.id,
      city: site.city,
      stage: site.stage,
      stageGroup: site.stageGroup,
      active: site.active,
      reasons: shown,
      flagged,
      mentioned,
      assigned,
      needsApproval,
      isNew,
      newestAt,
    });
  }
  return rows.sort(compareQueue);
}
