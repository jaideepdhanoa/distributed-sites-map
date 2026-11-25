import { evidenceMeasures, type EvidenceRequest, type EvidenceTarget } from "./actions/comparisonEvidence";

export type CitedFigure = EvidenceTarget & { value: string };
export type DecisionDraft = { preferred: string | null; rationale: string; citations: CitedFigure[] };
export type DecisionRecord = Omit<DecisionDraft, "citations"> & {
  version: string; author: string; at: string;
  citations: (CitedFigure & { followUp: EvidenceRequest | null })[];
};
export type DecisionAccess = { editable: boolean; decision: DecisionRecord | null };
export type FigureOption = CitedFigure & { siteName: string };
export function figureKey(figure: EvidenceTarget) {
  return figure.targetId + "|" + figure.measure;
}
export function figureLabel(figure: FigureOption) {
  return figure.siteName + " · " + evidenceMeasures[figure.measure];
}
