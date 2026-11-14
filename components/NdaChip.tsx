import { blockerSentenceForDeal, cardNdaLabel, type NdaMirror } from "@/lib/nda";
import { pacificToday } from "@/lib/queue/today";
import type { DealProps } from "@/lib/types";

export function NdaChip({
  deal,
  text,
  signedIn = true,
}: {
  deal?: Partial<NdaMirror>;
  text?: string;
  signedIn?: boolean;
}) {
  if (!signedIn) return null;
  const label = text ? (text === "Not required" || text.startsWith("NDA:") ? (text === "Not required" ? "" : text) : `NDA: ${text}`) : cardNdaLabel(deal || {}, true);
  if (!label) return null;
  const id = deal?.nda_id || "";
  return (
    <span className="badge quiet nda-chip" data-testid="nda-chip" data-nda-id={id} title={id || undefined}>
      {label}
    </span>
  );
}

export function BlockerLine({
  deal,
  today,
}: {
  deal: Pick<DealProps, "stage" | "stage_group"> & Partial<Pick<DealProps, "stage_blocker" | "stage_blocker_since">>;
  today?: string;
}) {
  const sentence = blockerSentenceForDeal(deal, today || pacificToday());
  if (!sentence) return null;
  return <p className="note stage-blocker" data-testid="stage-blocker">{sentence}</p>;
}
