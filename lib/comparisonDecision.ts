import { evidenceMeasures, type EvidenceRequest, type EvidenceTarget } from "./actions/comparisonEvidence";

export type CitedFigure = EvidenceTarget & { value: string };
export type DecisionDraft = { preferred: string | null; rationale: string; citations: CitedFigure[] };
export type DecisionRecord = Omit<DecisionDraft, "citations"> & {
  version: string; author: string; at: string;
  reviewedChange?: Pick<CitationReview, "version" | "key" | "site" | "measure" | "previous" | "current" | "reason">;
  citations: (CitedFigure & { followUp: EvidenceRequest | null })[];
};
export type DecisionAccess = { editable: boolean; decision: DecisionRecord | null; reviews?: CitationReview[] };
export type FigureOption = CitedFigure & { siteName: string };
export function figureKey(figure: EvidenceTarget) {
  return figure.targetId + "|" + figure.measure;
}
export function figureLabel(figure: FigureOption) {
  return figure.siteName + " · " + evidenceMeasures[figure.measure];
}

export type ReviewEvidence = { value: string; period: string; basis: string; closed: string };
export type CitationReview = {
  key: string; version: string; view: string; name: string; site: string; siteName: string; measure: string;
  href: string; outcome: string; original: string; previous: ReviewEvidence; current: ReviewEvidence;
  source: string; reason: string; token: string; reviewedBy: string; reviewedAt: string;
};

/** Normalize display conventions while preserving signs, units, period and text content. */
export function comparableText(text: string) {
  if (/^(?:—|not on file)$/i.test(text.trim())) return "not on file";
  return text.normalize("NFKC").toLowerCase().trim()
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .replace(/\$\s*([\d.]+)\s*([kmb])\b/g, (_, amount: string, suffix: string) =>
      "$" + Math.round(Number(amount) * ({ k: 1e3, m: 1e6, b: 1e9 }[suffix] || 1)))
    .replace(/(-?\d+\.\d+)\b/g, n => String(Number(n)))
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s*([·|/,:$])\s*/g, "$1").replace(/\s+/g, " ");
}

export function evidenceChanged(a: Pick<CitedFigure, "value" | "period" | "basis">, b: typeof a) {
  return comparableText(a.value) !== comparableText(b.value) || comparableText(a.period) !== comparableText(b.period) ||
    comparableText(a.basis) !== comparableText(b.basis);
}

export function reviewValue(figure: Pick<CitedFigure, "value" | "period" | "basis">) {
  return [figure.value === "—" ? "Not on file" : figure.value, figure.period, figure.basis].filter(Boolean).join(" · ");
}
