import { chipFace } from "@/lib/chips";

/**
 * A chip, pill, or badge is a short label on one line (at most 28 characters).
 * More than one word is fine. A sentence, or clauses joined with a middle dot,
 * belongs in the tooltip, on the card, or in a column. The chip does not take
 * the click; a list row still opens the site.
 */
export function ChipFace({
  label,
  className,
  detail,
  testId,
  pending,
}: {
  label: string;
  className: string;
  detail?: string;
  testId?: string;
  pending?: string;
}) {
  const face = chipFace(label);
  const tip = [face.title, (detail || "").replace(/\s+/g, " ").trim()].filter(Boolean).join(" ");
  return (
    <span className="stage-hold">
      <span className={className} data-testid={testId} title={tip || undefined}>
        {face.label}
      </span>
      {pending ? (
        <span className="stage-wait" data-testid="stage-pending" title={pending}>
          waiting
          <span className="sr">{pending}</span>
        </span>
      ) : null}
      {tip ? <span className="stage-tip" role="tooltip" data-testid="stage-decision-tip">{tip}</span> : null}
    </span>
  );
}
