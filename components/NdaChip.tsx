import { blockerSentenceForDeal, ndaChip, type NdaMirror } from "@/lib/nda";
import { pacificToday } from "@/lib/queue/today";
import type { DealProps } from "@/lib/types";

export function NdaChip({ deal, text }: { deal?: Partial<NdaMirror>; text?: string }) {
  const label = text ?? ndaChip(deal || {});
  const id = deal?.nda_id || "";
  return (
    <span className="badge pending nda-chip" data-testid="nda-chip" data-nda-id={id} title={id || undefined}>
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
