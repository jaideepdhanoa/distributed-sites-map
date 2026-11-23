import { ChipFace } from "./ChipFace";
import { chipFace } from "@/lib/chips";
import { blockerSentenceForDeal, cardNdaLabel, courtFromWaiting, courtPill, daysSince, type NdaMirror } from "@/lib/nda";
import { pacificToday } from "@/lib/queue/today";
import type { DealProps } from "@/lib/types";

export function NdaChip({
  deal,
  text,
  signedIn = true,
  showMissing = false,
  onOpen,
}: {
  deal?: Partial<NdaMirror>;
  text?: string;
  signedIn?: boolean;
  showMissing?: boolean;
  onOpen?: (id: string) => void;
}) {
  if (!signedIn) return null;
  const full = text ? (text === "Not required" || text.startsWith("NDA:") ? (text === "Not required" ? "" : text) : `NDA: ${text}`) : cardNdaLabel(deal || {}, true);
  const court = courtPill(courtFromWaiting(deal?.nda_waiting_on || ""), daysSince(deal?.stage_blocker_since || "", pacificToday()));
  const label = court && court.length <= 28 ? court : full;
  if (!label) {
    if (!showMissing) return null;
    return <span className="badge quiet nda-chip" data-testid="nda-chip">No NDA</span>;
  }
  const id = deal?.nda_id || "";
  if (!id || !onOpen) {
    return (
      <span data-nda-id={id || undefined}>
        <ChipFace className="badge quiet nda-chip" testId="nda-chip" label={label} />
      </span>
    );
  }
  const face = chipFace(label);
  return (
    <button
      type="button"
      className="chip nda-chip"
      data-testid="nda-open"
      data-nda-id={id}
      title={face.title || label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(id);
      }}
    >
      {face.label}
    </button>
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
