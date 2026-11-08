import { claimWord, packageLine, showsFinancials } from "./keyNumbers";
import type { DealProps } from "./types";

export { claimWord, packageLine, showsFinancials };

/** Parent program folder. Package links never use it. */
export const PARENT_FOLDER_ID = "1_oIqMjBJqOj-WApM7xOUz1EWydW3Fydk";

export const CHECKLIST_IDS = ["pl_years", "car_counts", "membership", "payroll", "rent", "water_bills"] as const;
export type ChecklistId = (typeof CHECKLIST_IDS)[number];

const CHECKLIST_LABELS: Record<ChecklistId, string> = {
  pl_years: "Three years of P&Ls plus YTD",
  car_counts: "24 months of car counts",
  membership: "Membership count and monthly revenue",
  payroll: "Payroll summary",
  rent: "Rent or lease terms",
  water_bills: "Water and " + "util" + "ity bills",
};

export function checklistLabel(id: string): string {
  if ((CHECKLIST_IDS as readonly string[]).includes(id)) return CHECKLIST_LABELS[id as ChecklistId];
  return id;
}

export type FigureRow = {
  figure: string;
  period: string;
  periodLabel: string;
  text: string;
  metric: string;
  claim: string;
  sourceName: string;
  sourceHref: string;
  page: string;
  recast: string;
  state: string;
  since: string;
  why: string;
};

export type BridgeRow = {
  figure: string;
  text: string;
  role: string;
  page: string;
  sourceName: string;
  counted: boolean;
};

export type ChecklistRow = {
  id: string;
  state: string;
  since: string;
  why: string;
  period: string;
  href: string;
  owner: string;
  receivedOn: string;
  note: string;
};

export type ClaimRow = { topic: string; broker: string; documents: string };

export type FinancialPanel = {
  open: boolean;
  packageStatus: string;
  packageLine: string;
  packageHref: string;
  headline: { text: string; metric: string; claim: string; packageLine: string };
  figures: FigureRow[];
  bridge: BridgeRow[];
  ending: BridgeRow | null;
  claims: ClaimRow[];
  checklist: ChecklistRow[];
  listed: { name: string; href: string }[];
};

export type DocumentDecision = {
  status: "open" | "accepted" | "rejected" | "applied";
  mode: "request" | "refused" | "package_refused";
  items: string[];
  owner: string;
  askedOn: string;
  reason: string;
};

const CLOSED: FinancialPanel = {
  open: false,
  packageStatus: "",
  packageLine: "",
  packageHref: "",
  headline: { text: "", metric: "", claim: "", packageLine: "" },
  figures: [],
  bridge: [],
  ending: null,
  claims: [],
  checklist: [],
  listed: [],
};

export function safePackageHref(value: string | null | undefined, signedIn: boolean): string {
  if (!signedIn) return "";
  const text = (value || "").trim();
  if (!text.includes("drive.google.com")) return "";
  if (text.includes(PARENT_FOLDER_ID)) return "";
  if (!/\/(?:folders|file\/d)\//.test(text)) return "";
  return text.split("?")[0];
}

export function stateLine(state: string, since = "", why = ""): string {
  if (state === "On file") return "On file";
  if (state === "Some on file, more asked for") return "Some on file, more asked for";
  if (state === "Asked for") return since ? `Asked for, waiting since ${since}` : "Asked for";
  if (state === "Not available") {
    const reason = (why || "").trim();
    return reason ? `Not available, ${reason}` : "Not available";
  }
  if (state === "Not asked yet") return "Not asked yet";
  return state || "Not asked yet";
}

export function shownAmount(text: string, state: string, since = "", why = ""): string {
  const trimmed = (text || "").trim();
  if (!trimmed || trimmed === "$0" || trimmed === "-$0" || trimmed === "0" || trimmed === "—" || trimmed === "-") {
    return stateLine(state, since, why);
  }
  return trimmed;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function checklistFromStatus(status: string, askedOn: string): ChecklistRow[] {
  const lower = status.toLowerCase();
  let state = "Not asked yet";
  let since = "";
  let why = "";
  if (lower.includes("refus") || lower.includes("unavailable")) {
    state = "Not available";
    why = "Refused or unavailable";
  } else if (lower.includes("partial")) {
    state = "Some on file, more asked for";
  } else if (lower === "received") {
    state = "On file";
  } else if (lower.includes("request")) {
    state = "Asked for";
    since = askedOn;
  }
  return CHECKLIST_IDS.map((id) => ({
    id,
    state,
    since,
    why,
    period: "",
    href: "",
    owner: "",
    receivedOn: "",
    note: "",
  }));
}

export function panelFromDeal(deal: DealProps): FinancialPanel {
  if (!showsFinancials(deal)) return { ...CLOSED };
  const line = packageLine(deal);
  const claim = claimWord(deal);
  const status = deal.package_status || "";
  const earnings = (deal.stated_cash_flow_display || "").trim();
  const earningsState = earnings && earnings !== "$0" ? "On file" : stateLine(status.toLowerCase().includes("request") ? "Asked for" : "Not asked yet");
  const figureState = earnings && earnings !== "$0" ? "On file" : (status.toLowerCase().includes("request") ? "Asked for" : "Not asked yet");
  const figures: FigureRow[] = [{
    figure: deal.cash_flow_label || "Earnings",
    period: "Latest",
    periodLabel: "Latest",
    text: earnings === "$0" || earnings === "-$0" ? "" : earnings,
    metric: deal.cash_flow_label || "Earnings",
    claim: earnings ? claim : "",
    sourceName: "",
    sourceHref: "",
    page: "",
    recast: earnings ? "Reported" : "",
    state: figureState,
    since: "",
    why: "",
  }];
  if (deal.stated_revenue_display && deal.stated_revenue_display !== "$0") {
    figures.unshift({
      figure: "Revenue",
      period: "Latest",
      periodLabel: "Latest",
      text: deal.stated_revenue_display,
      metric: "Revenue",
      claim,
      sourceName: "",
      sourceHref: "",
      page: "",
      recast: "",
      state: "On file",
      since: "",
      why: "",
    });
  }
  const brokerEarnings = deal.figures_basis === "Claimed" || claim === "Broker-stated" ? earnings : "";
  const docEarnings = claim === "Documented" || claim === "Verified" || claim === "Normalized" ? earnings : "";
  return {
    open: true,
    packageStatus: status,
    packageLine: line,
    packageHref: "",
    headline: { text: earnings === "$0" ? "" : earnings, metric: deal.cash_flow_label || "", claim, packageLine: line },
    figures,
    bridge: [],
    ending: claim === "Normalized" && earnings ? { figure: "Normalized EBITDA", text: earnings, role: "Normalized result", page: "", sourceName: "", counted: true } : null,
    claims: [
      { topic: "Earnings", broker: brokerEarnings, documents: docEarnings },
      { topic: "Revenue", broker: deal.figures_basis === "Claimed" ? (deal.stated_revenue_display || "") : "", documents: claim === "Documented" || claim === "Verified" ? (deal.stated_revenue_display || "") : "" },
      { topic: "Members", broker: "", documents: "" },
      { topic: "Package contents", broker: "", documents: line || earningsState },
    ],
    checklist: checklistFromStatus(status, ""),
    listed: [],
  };
}

function rowFigure(raw: Record<string, unknown>): FigureRow {
  return {
    figure: textOf(raw.figure),
    period: textOf(raw.period) || "Latest",
    periodLabel: textOf(raw.period_label) || textOf(raw.periodLabel) || textOf(raw.period) || "Latest",
    text: textOf(raw.text),
    metric: textOf(raw.metric),
    claim: textOf(raw.claim),
    sourceName: textOf(raw.source_name) || textOf(raw.sourceName),
    sourceHref: safePackageHref(textOf(raw.source_href) || textOf(raw.sourceHref), true),
    page: textOf(raw.page),
    recast: textOf(raw.recast),
    state: textOf(raw.state) || "Not asked yet",
    since: textOf(raw.since),
    why: textOf(raw.why),
  };
}

export function panelFromStored(raw: Record<string, unknown> | null | undefined, signedIn: boolean): FinancialPanel | null {
  if (!raw || raw.open === false) return raw ? { ...CLOSED } : null;
  const headline = (raw.headline || {}) as Record<string, unknown>;
  const endingRaw = raw.ending as Record<string, unknown> | null;
  return {
    open: true,
    packageStatus: textOf(raw.packageStatus),
    packageLine: textOf(raw.packageLine),
    packageHref: safePackageHref(textOf(raw.packageHref), signedIn),
    headline: {
      text: textOf(headline.text),
      metric: textOf(headline.metric),
      claim: textOf(headline.claim),
      packageLine: textOf(headline.packageLine),
    },
    figures: Array.isArray(raw.figures) ? raw.figures.map((item) => rowFigure(item as Record<string, unknown>)) : [],
    bridge: Array.isArray(raw.bridge) ? raw.bridge.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        figure: textOf(row.figure),
        text: textOf(row.text),
        role: textOf(row.role),
        page: textOf(row.page),
        sourceName: textOf(row.source_name) || textOf(row.sourceName),
        counted: Boolean(row.counted),
      };
    }) : [],
    ending: endingRaw && textOf(endingRaw.text) ? {
      figure: textOf(endingRaw.figure),
      text: textOf(endingRaw.text),
      role: textOf(endingRaw.role) || "Normalized result",
      page: "",
      sourceName: "",
      counted: true,
    } : null,
    claims: Array.isArray(raw.claims) ? raw.claims.map((item) => {
      const row = item as Record<string, unknown>;
      return { topic: textOf(row.topic), broker: textOf(row.broker), documents: textOf(row.documents) };
    }).filter((row) => row.topic !== "Asking" && !/price/i.test(row.topic)) : [],
    checklist: Array.isArray(raw.checklist) ? raw.checklist.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: textOf(row.id),
        state: textOf(row.state) || "Not asked yet",
        since: textOf(row.since),
        why: textOf(row.why),
        period: textOf(row.period),
        href: safePackageHref(textOf(row.href), signedIn),
        owner: textOf(row.owner),
        receivedOn: textOf(row.received_on) || textOf(row.receivedOn),
        note: textOf(row.note),
      };
    }) : [],
    listed: Array.isArray(raw.listed) ? raw.listed.map((item) => {
      const row = item as Record<string, unknown>;
      return { name: textOf(row.name), href: safePackageHref(textOf(row.href), signedIn) };
    }).filter((item) => item.name) : [],
  };
}

export function applyDecisions(panel: FinancialPanel, decisions: DocumentDecision[]): FinancialPanel {
  if (!panel.open) return panel;
  const accepted = decisions.filter((item) => item.status === "accepted" || item.status === "applied");
  if (!accepted.length) return panel;
  let checklist = panel.checklist.map((item) => ({ ...item }));
  let packageStatus = panel.packageStatus;
  let packageLineText = panel.packageLine;
  for (const decision of accepted) {
    if (decision.mode === "package_refused") {
      packageStatus = "Refused or unavailable";
      packageLineText = "";
      checklist = checklist.map((item) => ({ ...item, state: "Not available", why: decision.reason || "Refused or unavailable" }));
      continue;
    }
    if (decision.mode === "refused") {
      checklist = checklist.map((item) => decision.items.includes(item.id) ? { ...item, state: "Not available", why: decision.reason || "Not available" } : item);
      continue;
    }
    const hadFile = packageStatus === "Received" || packageStatus.toLowerCase().includes("partial") || checklist.some((item) => item.state === "On file" || item.state.startsWith("Some on file"));
    checklist = checklist.map((item) => {
      if (!decision.items.includes(item.id) || item.state === "On file") return item;
      return { ...item, state: "Asked for", since: decision.askedOn, owner: decision.owner };
    });
    if (hadFile) {
      packageStatus = "Partial, more requested";
      packageLineText = "Partial package";
    } else {
      packageStatus = "Requested";
      packageLineText = decision.askedOn ? `Package asked for (${decision.askedOn})` : "Package asked for";
    }
  }
  return {
    ...panel,
    packageStatus,
    packageLine: packageLineText,
    checklist,
    headline: { ...panel.headline, packageLine: packageLineText },
  };
}

export function parseDocumentRequest(value: unknown): { mode: DocumentDecision["mode"]; items: string[]; reason: string } | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const mode = row.mode === "refused" || row.mode === "package_refused" ? row.mode : row.mode === "request" ? "request" : null;
  if (!mode) return null;
  const items = Array.isArray(row.items) ? row.items.map((item) => String(item)).filter((item) => (CHECKLIST_IDS as readonly string[]).includes(item)) : [];
  if (mode !== "package_refused" && !items.length) return null;
  const reason = textOf(row.reason);
  if ((mode === "refused" || mode === "package_refused") && !reason) return null;
  return { mode, items, reason };
}

export const PERIODS = ["Latest", "Prior", "Two years prior"] as const;
