import { useEffect, useRef } from "react";
import type { QueueReason } from "@/lib/queue/order";
import { reviewWhen } from "@/lib/queue/when";

export function changeDestination(type: string) {
  if (["note", "reply", "mention"].includes(type)) return { label: "Discussion", panel: "discussion" };
  if (["activity", "bring_back", "stage_repair"].includes(type)) return { label: "Activity", panel: "activity" };
  if (type === "price") return { label: "Site figures", selector: '[data-testid="card-numbers"]' };
  if (type === "materials" || type === "document_request") return { label: "Site documents", selector: ".card-links" };
  if (type === "assignment" || type.startsWith("next_") || type === "drop_suggested") return { label: "Next step", panel: "proposal", selector: ".decision-block" };
  if (["stage", "verdict", "drop", "new_site"].includes(type)) return { label: "Screening decision", selector: ".record-brief" };
  return { label: "Review change" };
}

export default function ReviewEvidence({ reason, onReturn }: { reason: QueueReason; onReturn: () => void }) {
  const heading = useRef<HTMLDivElement>(null);
  const destination = changeDestination(reason.type);
  useEffect(() => {
    const drawer = heading.current?.closest(".drawer");
    const scroll = drawer?.querySelector<HTMLElement>(".drawer-scroll");
    if (!drawer || !scroll) return;
    heading.current?.focus({ preventScroll: true });
    const selector = changeDestination(reason.type).selector;
    if (!selector) return;
    function align() {
      const node = scroll?.querySelector(selector!);
      for (let parent = node?.parentElement; parent && parent !== scroll; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      if (node && scroll) scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 6;
      return Boolean(node);
    }
    if (align()) return;
    const observer = new MutationObserver(() => { if (align()) observer.disconnect(); });
    observer.observe(scroll, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [reason]);
  return (
    <div ref={heading} tabIndex={-1} className="review-evidence" role="region" aria-label="Selected review change">
      <div><strong>{destination.label}</strong> <time dateTime={reason.at}>{reviewWhen(reason)}</time></div>
      <p>{reason.summary}</p>
      <button className="text-link" type="button" onClick={onReturn}>Back to review</button>
    </div>
  );
}
